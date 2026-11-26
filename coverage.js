/** Yandex raster coverage in EPSG:3395, reprojected to the editor's EPSG:3857. */
const BOOTSTRAP = 'https://api-maps.yandex.ru/2.1/?lang=ru_RU&load=panorama.locate';
const hotspots=new Map();
const TILES = 'https://core-stv-renderer.maps.yandex.net/2.x/tiles';
let versionPromise;
let versionTime=0;
async function version(layer) {
  if (!versionPromise || Date.now()-versionTime>3600000) {
    versionTime=Date.now();hotspots.clear();
    versionPromise=fetch(BOOTSTRAP,{credentials:'omit'}).then(async response=>{
      if(!response.ok)throw new Error(`Yandex configuration: HTTP ${response.status}`);
      // Read the published configuration as text. Never execute the bootstrap script.
      const text=await response.text();
      const versions={};
      for(const name of ['stv','sta']){
        const match=text.match(new RegExp('"'+name+'":\\{"version":"([^"]+)"'));
        if(match)versions[name]=match[1];
      }
      return versions;
    });
    versionPromise.catch(()=>{versionPromise=undefined;});
  }
  const versions=await versionPromise;
  if(!versions[layer])throw new Error(`Yandex ${layer} coverage version not found`);
  return versions[layer];
}
export function sourcePixelY(webPixelY, z) {
  const size=256*2**z;
  const latitude=Math.atan(Math.sinh(Math.PI*(1-2*webPixelY/size)));
  const e=0.08181919084262149;
  const sin=Math.sin(latitude);
  const mercator=Math.log(Math.tan(Math.PI/4+latitude/2)*((1-e*sin)/(1+e*sin))**(e/2));
  return Math.max(0,Math.min(size-1,(1-mercator/Math.PI)*size/2));
}
async function tile(z,x,y,signal,layer) {
  for(let attempt=0;attempt<2;attempt++) {
    const params=new URLSearchParams({l:layer,x:String(x),y:String(y),z:String(z),lang:'ru_RU',format:'png',v:await version(layer==='stv,sta'?'stv':layer)});
    signal.throwIfAborted();
    const response=await fetch(`${TILES}?${params}`,{signal,credentials:'omit'});
    if(response.status===400&&attempt===0){versionPromise=undefined;continue;}
    if(!response.ok)throw new Error(`Yandex coverage: HTTP ${response.status}`);
    const blob=await response.blob();
    if(!blob.size){const blank=document.createElement('canvas');blank.width=blank.height=256;return createImageBitmap(blank);}
    try{return await createImageBitmap(blob);}catch(error){throw new Error(`Yandex coverage ${layer} ${z}/${x}/${y}: ${error.message} (${blob.type}, ${blob.size} bytes)`);}
  }
}
export async function coverageTile(z,x,y,signal,layer='stv') {
  if(!['stv','sta','stv,sta'].includes(layer))throw new Error('Unknown panorama coverage layer');
  const rows=Array.from({length:256},(_,row)=>sourcePixelY(y*256+row+.5,z));
  const indices=[...new Set(rows.map(py=>Math.floor(py/256)))];
  const images=new Map();
  try {
    // allSettled ensures successful bitmaps are closed even if another request fails.
    const results=await Promise.allSettled(indices.map(async ty=>{
      const image=await tile(z,x,ty,signal,layer);images.set(ty,image);
    }));
    const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
    if(layer==='stv,sta')await Promise.allSettled(indices.map(ty=>airFeatures(z,x,ty,signal)));
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

/** Match the actual balloon footprint in the provider's hotspot tile, not nearest aerial photo. */
export function hitAirPanorama(features, pixel) {
  const inside=(ring)=>{
    let hit=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [x,y]=ring[i],[px,py]=ring[j];
      if((y>pixel[1])!==(py>pixel[1])&&pixel[0]<(px-x)*(pixel[1]-y)/(py-y)+x)hit=!hit;
    }
    return hit;
  };
  for(const feature of features??[]){
    const meta=feature.properties?.HotspotMetaData,geometry=meta?.RenderedGeometry;
    const polygons=geometry?.type==='MultiPolygon'?geometry.coordinates:geometry?.type==='Polygon'?[geometry.coordinates]:[];
    if(meta?.id&&polygons.some(p=>p[0]?.length&&inside(p[0])&&!p.slice(1).some(inside)))return {id:String(meta.id),layer:'sta'};
  }
}
function hotspotPoint(lngLat,mapZoom) {
  if(!Number.isFinite(mapZoom))return undefined;
  // RasterTileSource rounds its covering zoom; camera zoom uses 512px tiles, this source 256px.
  const z=Math.max(0,Math.min(19,Math.round(mapZoom+1)));
  const size=256*2**z,lon=((lngLat[0]+180)%360+360)%360-180;
  const px=(lon+180)/360*size;
  const latitude=Math.max(-85.05112878,Math.min(85.05112878,lngLat[1]))*Math.PI/180;
  const py=sourcePixelY((1-Math.asinh(Math.tan(latitude))/Math.PI)*size/2,z);
  const x=Math.floor(px/256),y=Math.floor(py/256);
  return {z,x,y,pixel:[px-x*256,py-y*256]};
}
async function airFeatures(z,x,y,signal) {
  const v=await version('sta'),key=`${z}/${x}/${y}`;
  if(hotspots.has(key))return hotspots.get(key);
  const params=new URLSearchParams({l:'stj',x:String(x),y:String(y),z:String(z),lang:'ru_RU',format:'js',v});
  const response=await fetch(`${TILES}?${params}`,{signal,credentials:'omit'});
  let features;
  if(response.status===404||response.status===204)features=[];
  else {
    if(!response.ok)throw new Error(`Yandex balloon hotspots: HTTP ${response.status}`);
    const text=await response.text();
    // Despite format=js, the service returns JSON; do not execute it as JavaScript.
    features=text?JSON.parse(text).data?.features??[]:[];
  }
  if(hotspots.size>=128)hotspots.delete(hotspots.keys().next().value);
  hotspots.set(key,features);
  return features;
}
/** Coverage preloads footprints so a balloon click can take priority over a building below it. */
export function cachedAirPanorama(lngLat,mapZoom) {
  const p=hotspotPoint(lngLat,mapZoom);
  return p?hitAirPanorama(hotspots.get(`${p.z}/${p.x}/${p.y}`),p.pixel):undefined;
}
export async function pickAirPanorama(lngLat,mapZoom,signal) {
  const p=hotspotPoint(lngLat,mapZoom);if(!p)return undefined;
  const features=await airFeatures(p.z,p.x,p.y,signal);
  signal.throwIfAborted();
  return hitAirPanorama(features,p.pixel);
}

const airDetails=new Map();
export function aerialPoint(feature,detail) {
  const id=feature.properties?.HotspotMetaData?.id;
  const coordinate=feature.geometry?.coordinates;
  if(!id||!Array.isArray(coordinate)||coordinate.length<2||coordinate.slice(0,2).some(v=>v==null||v===''))return undefined;
  // The stj service uses [latitude, longitude], unlike GeoJSON.
  let lngLat=[Number(coordinate[1]),Number(coordinate[0])];
  if(!lngLat.every(Number.isFinite)||Math.abs(lngLat[0])>180||Math.abs(lngLat[1])>90)return undefined;
  const point=detail?.Data?.Point,coordinates=point?.coordinates;
  const raw=coordinates?.[2],height=raw==null?undefined:Number(raw);
  const known=Number.isFinite(height)&&height>=0&&height<=10000;
  if(coordinates?.length>=2&&coordinates.slice(0,2).every(v=>v!=null&&Number.isFinite(Number(v))))lngLat=coordinates.slice(0,2).map(Number);
  return {type:'Feature',geometry:{type:'Point',coordinates:lngLat},properties:{
    id:String(id),height:known?height:0,heightKnown:known,name:point?.name||'',
  }};
}
export async function loadAirPoints(bounds,mapZoom,signal,readMetadata) {
  if(!Number.isFinite(mapZoom)||bounds.length!==4||!bounds.every(Number.isFinite))return {type:'FeatureCollection',features:[]};
  const z=Math.max(6,Math.min(17,Math.round(mapZoom+1))),count=2**z;
  const xy=(lon,lat)=>{
    const latitude=Math.max(-85.05112878,Math.min(85.05112878,lat))*Math.PI/180;
    return [(lon+180)/360*count,sourcePixelY((1-Math.asinh(Math.tan(latitude))/Math.PI)*count*128,z)/256];
  };
  let [west,south,east,north]=bounds;
  if(east<west)east+=360;
  // Include ground anchors just beyond the viewport: elevated symbols may project into it.
  const a=xy(west-.004,north+.004),b=xy(east+.004,south-.004),tiles=[];
  const center=[(a[0]+b[0])/2,(a[1]+b[1])/2];
  for(let y=Math.max(0,Math.floor(a[1]),Math.floor(center[1])-32);y<=Math.min(count-1,Math.floor(b[1]),Math.floor(center[1])+32);y++)
    for(let x=Math.max(Math.floor(a[0]),Math.floor(center[0])-32);x<=Math.min(Math.floor(b[0]),Math.floor(center[0])+32);x++)tiles.push({x:((x%count)+count)%count,y,d:(x-center[0])**2+(y-center[1])**2});
  tiles.sort((a,b)=>a.d-b.d);
  const points=new Map();let next=0;
  const selected=tiles.slice(0,64);
  await Promise.all(Array.from({length:Math.min(4,selected.length)},async()=>{
    while(next<selected.length){
      signal.throwIfAborted();const {x,y}=selected[next++];
      for(const feature of await airFeatures(z,x,y,signal)){
        const point=aerialPoint(feature);if(point)points.set(point.properties.id,feature);
      }
    }
  }));
  const features=[...points.values()],result=new Array(features.length);next=0;
  await Promise.all(Array.from({length:Math.min(4,features.length)},async()=>{
    while(next<features.length){
      signal.throwIfAborted();const index=next++,feature=features[index],id=String(feature.properties.HotspotMetaData.id);
      let detail=airDetails.get(id);
      if(!detail){
        try{
          detail=await readMetadata({oid:id,l:'sta'},signal);
          if(airDetails.size>=512)airDetails.delete(airDetails.keys().next().value);
          airDetails.set(id,detail);
        }catch(error){if(signal.aborted)throw error;}
      }
      result[index]=aerialPoint(feature,detail);
    }
  }));
  signal.throwIfAborted();
  return {type:'FeatureCollection',features:result.filter(Boolean)};
}
