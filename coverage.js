/** Yandex raster coverage in EPSG:3395, reprojected to the editor's EPSG:3857. */
const BOOTSTRAP = 'https://api-maps.yandex.ru/2.1/?lang=ru_RU&load=panorama.locate';
const TILES = 'https://core-stv-renderer.maps.yandex.net/2.x/tiles';
let versionPromise;
let versionTime=0;
async function version() {
  if (!versionPromise || Date.now()-versionTime>3600000) {
    versionTime=Date.now();
    versionPromise=fetch(BOOTSTRAP,{credentials:'omit'}).then(async response=>{
      if(!response.ok)throw new Error(`Yandex configuration: HTTP ${response.status}`);
      // Read the published configuration as text. Never execute the bootstrap script.
      const text=await response.text();
      const match=text.match(/"stv":\{"version":"([^"]+)"/);
      if(!match)throw new Error('Yandex coverage version not found');
      return match[1];
    });
    versionPromise.catch(()=>{versionPromise=undefined;});
  }
  return versionPromise;
}
export function sourcePixelY(webPixelY, z) {
  const size=256*2**z;
  const latitude=Math.atan(Math.sinh(Math.PI*(1-2*webPixelY/size)));
  const e=0.08181919084262149;
  const sin=Math.sin(latitude);
  const mercator=Math.log(Math.tan(Math.PI/4+latitude/2)*((1-e*sin)/(1+e*sin))**(e/2));
  return Math.max(0,Math.min(size-1,(1-mercator/Math.PI)*size/2));
}
async function tile(z,x,y,signal) {
  for(let attempt=0;attempt<2;attempt++) {
    const params=new URLSearchParams({l:'stv',x:String(x),y:String(y),z:String(z),lang:'ru_RU',format:'png',v:await version()});
    signal.throwIfAborted();
    const response=await fetch(`${TILES}?${params}`,{signal,credentials:'omit'});
    if(response.status===400&&attempt===0){versionPromise=undefined;continue;}
    if(!response.ok)throw new Error(`Yandex coverage: HTTP ${response.status}`);
    return createImageBitmap(await response.blob());
  }
}
export async function coverageTile(z,x,y,signal) {
  const rows=Array.from({length:256},(_,row)=>sourcePixelY(y*256+row+.5,z));
  const indices=[...new Set(rows.map(py=>Math.floor(py/256)))];
  const images=new Map();
  try {
    // allSettled ensures successful bitmaps are closed even if another request fails.
    const results=await Promise.allSettled(indices.map(async ty=>{
      const image=await tile(z,x,ty,signal);images.set(ty,image);
    }));
    const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
    signal.throwIfAborted();
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');
    rows.forEach((py,row)=>{
      const ty=Math.floor(py/256),image=images.get(ty);
      ctx.drawImage(image,0,Math.min(255,py-ty*256),256,1,0,row,256,1);
    });
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Coverage encoding failed')),'image/png'));
    return blob.arrayBuffer();
  } finally { for(const image of images.values())image.close(); }
}
