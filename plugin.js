/** Development-only internal Yandex panorama API adapter.
 * Protocol references: streetlevel (MIT), see THIRD_PARTY_NOTICES.md.
 */
const ENDPOINT = 'https://api-maps.yandex.ru/services/panoramas/1.x/';
export async function metadata(query, signal) {
  const params = new URLSearchParams({ l: 'stv', lang: 'ru_RU', origin: 'userAction', provider: 'streetview', ...query });
  const response = await fetch(`${ENDPOINT}?${params}`, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Panorama API: HTTP ${response.status}`);
  const body = await response.json();
  if (body.status === 'error' || !body.data?.Data) throw new Error('Панорама не найдена / Panorama not found');
  return body.data;
}

function viewer(host, onView) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  host.append(canvas);
  const gl = canvas.getContext('webgl');
  if (!gl) throw new Error('WebGL unavailable');
  const compile = (type, source) => {
    const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const program = gl.createProgram();
  const shaders = [compile(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 v; void main(){v=p;gl_Position=vec4(p,0.,1.);}'), compile(gl.FRAGMENT_SHADER, `precision highp float;
    varying vec2 v; uniform sampler2D image; uniform float yaw,pitch,origin,fov,aspect;
    void main(){
      vec3 r=normalize(vec3(v.x*aspect*tan(fov/2.),v.y*tan(fov/2.),1.));
      r=vec3(r.x,r.y*cos(pitch)+r.z*sin(pitch),r.z*cos(pitch)-r.y*sin(pitch));
      float a=atan(r.x,r.z)+yaw;
      vec2 uv=vec2(fract((a-origin)/6.28318530718+.5),.5-asin(clamp(r.y,-1.,1.))/3.14159265359);
      gl_FragColor=texture2D(image,uv);
    }`)];
  shaders.forEach(s => gl.attachShader(program,s)); gl.linkProgram(program);
  if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  const buffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const p=gl.getAttribLocation(program,'p'); gl.enableVertexAttribArray(p); gl.vertexAttribPointer(p,2,gl.FLOAT,false,0,0);
  const texture=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  let yaw=0,pitch=0,fov=75,origin=0,ready=false;
  const draw=()=>{
    if (!ready) return;
    canvas.width=Math.max(1,Math.round(canvas.clientWidth*devicePixelRatio)); canvas.height=Math.max(1,Math.round(canvas.clientHeight*devicePixelRatio));
    gl.viewport(0,0,canvas.width,canvas.height);
    for(const [key,value] of Object.entries({yaw:yaw*Math.PI/180,pitch:pitch*Math.PI/180,origin:origin*Math.PI/180,fov:fov*Math.PI/180,aspect:canvas.width/canvas.height})) gl.uniform1f(gl.getUniformLocation(program,key),value);
    gl.drawArrays(gl.TRIANGLES,0,6);
    onView((yaw%360+360)%360,2*Math.atan(Math.tan(fov*Math.PI/360)*canvas.width/canvas.height)*180/Math.PI);
  };
  let drag;
  canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId);};
  canvas.onpointermove=e=>{if(!drag)return; const scale=fov/Math.max(1,canvas.clientHeight);yaw-=(e.clientX-drag[0])*scale;pitch=Math.max(-85,Math.min(85,pitch+(e.clientY-drag[1])*scale));drag=[e.clientX,e.clientY];draw();};
  canvas.onpointerup=canvas.onpointercancel=()=>{drag=undefined;};
  canvas.addEventListener('wheel',e=>{e.preventDefault();fov=Math.max(25,Math.min(110,fov+e.deltaY*.05));draw();},{passive:false});
  const observer=new ResizeObserver(draw);observer.observe(host);
  return {
    maxSize:gl.getParameter(gl.MAX_TEXTURE_SIZE),
    set(image, heading){origin=heading;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);ready=true;draw();},
    destroy(){observer.disconnect();gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));canvas.remove();}
  };
}

export function activate(api) {
  const ru=api.lang==='ru';
  let enabled=false,panel,view,controller,current,sequence=0;
  const close=()=>{sequence++;controller?.abort();view?.destroy();view=undefined;current=undefined;const old=panel;panel=undefined;old?.close();api.setViewCone();};
  async function open(query) {
    controller?.abort();controller=new AbortController();const {signal}=controller;const id=++sequence;
    try {
      if(!panel){
        panel=api.openPanel('Yandex Panoramas DEV');panel.onClose(close);
        panel.body.style.background='#222';
        const host=document.createElement('div');host.style.cssText='position:absolute;inset:0 0 58px';panel.body.append(host);
        view=viewer(host,(azimuth,fov)=>{if(current)api.setViewCone({lngLat:current.Data.Point.coordinates.slice(0,2).map(Number),azimuth,fov});});
        const bar=document.createElement('div');bar.className='yp-dev-bar';bar.style.cssText='position:absolute;bottom:0;left:0;right:0;height:58px;overflow:auto;background:#fff;padding:4px;font:12px sans-serif';panel.body.append(bar);
      }
      const bar=panel.body.querySelector('.yp-dev-bar');bar.textContent=ru?'Загрузка…':'Loading…';
      const data=await metadata(query,signal); if(id!==sequence)return;
      const images=data.Data.Images;
      const zooms=images.Zooms.map(z=>({level:Number(z.level),width:Number(z.width),height:Number(z.height)})).filter(z=>z.width>0&&z.height>0&&z.width<=Math.min(4096,view.maxSize)&&z.width/2<=view.maxSize).sort((a,b)=>b.width-a.width);
      const zoom=zooms[0];if(!zoom)throw new Error('No supported image size');
      const image=document.createElement('canvas');image.width=zoom.width;image.height=Math.round(zoom.width/2);
      const ctx=image.getContext('2d');ctx.fillStyle='#222';ctx.fillRect(0,0,image.width,image.height);
      const tw=Number(images.Tiles.width),th=Number(images.Tiles.height);
      if(!(tw>0&&th>0))throw new Error('Invalid tile size');
      const tiles=[];
      for(let y=0;y<Math.ceil(zoom.height/th);y++)for(let x=0;x<Math.ceil(zoom.width/tw);x++)tiles.push([x,y]);
      // Limit concurrent requests; abort both metadata and tile downloads on navigation/close.
      let next=0;
      await Promise.all(Array.from({length:Math.min(6,tiles.length)},async()=>{
        while(next<tiles.length){
          const [x,y]=tiles[next++];const res=await fetch(`https://pano.maps.yandex.net/${images.imageId}/${zoom.level}.${x}.${y}`,{signal,credentials:'omit'});
          if(!res.ok)throw new Error(`Tile: HTTP ${res.status}`);
          const bitmap=await createImageBitmap(await res.blob());
          ctx.drawImage(bitmap,0,0,Math.min(tw,zoom.width-x*tw),Math.min(th,zoom.height-y*th),x*tw,y*th,Math.min(tw,zoom.width-x*tw),Math.min(th,zoom.height-y*th));bitmap.close();
        }
      }));
      if(id!==sequence)return;
      current=data;
      // Streetlevel's heading convention has south at zero; convert to north-based azimuth.
      view.set(image,180-Number(data.Data.EquirectangularProjection.Origin[0]));
      api.markUsed('street','Yandex Panoramas');bar.replaceChildren();
      const link=document.createElement('a');link.textContent='© Яндекс · '+(data.Data.Point.name||data.Data.panoramaId);link.href=`https://yandex.ru/maps/?panorama[pid]=${encodeURIComponent(data.Data.panoramaId)}`;link.target='_blank';link.rel='noopener noreferrer';bar.append(link,document.createElement('br'));
      const ids=new Set([data.Data.panoramaId]);
      const add=(oid,label)=>{if(!oid||ids.has(oid))return;ids.add(oid);const b=document.createElement('button');b.textContent=label;b.onclick=()=>void open({oid});bar.append(b);};
      for(const n of data.Annotation?.Thoroughfares??[]){const url=new URL(n.Connection.href,ENDPOINT);add(url.searchParams.get('oid'),`↗ ${Math.round(Number(n.Direction[0]))}°`);}
      for(const n of data.Annotation?.Graph?.Nodes??[])add(n.panoid,'↗');
      for(const n of data.Annotation?.Connections??[]){const url=new URL(n.href,ENDPOINT);add(url.searchParams.get('oid'),'↗');}
      for(const n of data.Annotation?.HistoricalPanoramas??[])add(n.Connection?.oid,ru?'Архив':'History');
    } catch(error) {
      if(id!==sequence||signal.aborted)return;
      controller.abort();console.error('Yandex DEV:',error);
      const bar=panel?.body.querySelector('.yp-dev-bar');if(bar)bar.textContent=`${error.message} · ${ru?'Подробности в консоли (возможен CORS)':'See console (possibly CORS)'}`;
    }
  }
  api.addPhotoToggle('panoramas-dev','Yandex Panoramas DEV',ru?'Внутренний API: кликните по улице':'Internal API: click a street',v=>{enabled=v;if(!v)close();});
  api.onMapClick((lngLat,{onObject})=>{if(!enabled||onObject)return false;void open({ll:lngLat.join(',')});return true;});
  return close;
}
