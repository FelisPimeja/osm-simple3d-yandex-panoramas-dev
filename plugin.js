/** Development-only internal Yandex panorama API adapter.
 * Protocol references: streetlevel (MIT), see THIRD_PARTY_NOTICES.md.
 */
import { coverageTile, pickAirPanorama, cachedAirPanorama, loadAirPoints } from './coverage.js';
import { transitions, layoutTransitions, panoramaHistory } from './navigation.js';

const ENDPOINT = 'https://api-maps.yandex.ru/services/panoramas/1.x/';
export async function metadata(query, signal) {
  const params = new URLSearchParams({ l: 'stv', lang: 'ru_RU', origin: 'userAction', provider: 'streetview', ...query });
  const response = await fetch(`${ENDPOINT}?${params}`, { signal, credentials: 'omit' });
  if (!response.ok) throw new Error(`Panorama API: HTTP ${response.status}`);
  const body = await response.json();
  if (body.status === 'error' || !body.data?.Data) throw new Error('Панорама не найдена / Panorama not found');
  return body.data;
}

// Origin[1] is the centre latitude of the available image, not its top edge.
// Match the official angular bounds: thetaTop = originLatitude + 180 * height / width.
export function imageTop(originLatitude, width, height) {
  return (90 - Number(originLatitude)) * width / 360 - height / 2;
}

export async function loadPanoramaImage(images, zooms, originLatitude, signal) {
  if(!zooms.length)throw new Error('No supported image size');
  let lastError;
  for(const zoom of zooms){
    signal?.throwIfAborted();
    try {
      const image=document.createElement('canvas');image.width=zoom.width;image.height=Math.round(zoom.width/2);
      const ctx=image.getContext('2d');ctx.fillStyle='#222';ctx.fillRect(0,0,image.width,image.height);
      const tw=Number(images.Tiles.width),th=Number(images.Tiles.height);
      if(!(tw>0&&th>0))throw new Error('Invalid tile size');
      const top=imageTop(originLatitude,zoom.width,zoom.height);
      const tiles=[];
      for(let y=0;y<Math.ceil(zoom.height/th);y++)for(let x=0;x<Math.ceil(zoom.width/tw);x++)tiles.push([x,y]);
      // Limit concurrent requests; abort both metadata and tile downloads on navigation/close.
      let next=0,failed=false;
      const results=await Promise.allSettled(Array.from({length:Math.min(6,tiles.length)},async()=>{
        while(next<tiles.length&&!failed){
          signal?.throwIfAborted();
          try {
            const [x,y]=tiles[next++];const res=await fetch(`https://pano.maps.yandex.net/${images.imageId}/${zoom.level}.${x}.${y}`,{signal,credentials:'omit'});
            if(!res.ok)throw new Error(`Tile: HTTP ${res.status}`);
            const bitmap=await createImageBitmap(await res.blob());
            ctx.drawImage(bitmap,0,0,Math.min(tw,zoom.width-x*tw),Math.min(th,zoom.height-y*th),x*tw,top+y*th,Math.min(tw,zoom.width-x*tw),Math.min(th,zoom.height-y*th));bitmap.close();
          } catch(error) { failed=true; throw error; }
        }
      }));
      signal?.throwIfAborted();
      const failure=results.find(result=>result.status==='rejected');
      if(failure)throw failure.reason;
      return image;
    } catch(error) {
      if(signal?.aborted)throw error;
      lastError=error;
    }
  }
  throw lastError;
}

function navigation(host, go, ru) {
  const style=document.createElement('style');
  style.textContent=`
  .yp-nav{position:absolute;left:50%;bottom:20%;width:0;height:0;transform:perspective(420px) rotateX(58deg);transform-style:preserve-3d;pointer-events:none}
  .yp-arrow{position:absolute;left:-36px;top:-36px;width:72px;height:72px;padding:0;border:0;background:none;cursor:pointer;pointer-events:auto;transform-origin:50% 50%;transform-style:preserve-3d}
  .yp-arrow svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
  .yp-arrow .face path{fill:#fff;stroke:#fff}.yp-arrow .side path{fill:#6b7280;stroke:#6b7280}
  .yp-arrow .shadow{filter:blur(4px);opacity:.75}.yp-arrow .shadow path{fill:#000;stroke:#000}
  .yp-arrow:hover .face path{fill:#92b1f5;stroke:#92b1f5}.yp-arrow:hover .side path{fill:#1e3a8a;stroke:#1e3a8a}
  .yp-arrow:focus-visible{outline:3px solid #92b1f5;border-radius:12px}
  `;
  const nav=document.createElement('div');nav.className='yp-nav';host.append(style,nav);
  const layer=(cls,z)=>`<svg class="${cls}" viewBox="-4 -4 48 48" style="transform:translateZ(${z}px)"><path d="M20 6 34 30H6z" stroke-width="7" stroke-linejoin="round"/></svg>`;
  const svg=layer('shadow',-14)+Array.from({length:10},(_,i)=>layer('side',-10+i)).join('')+layer('face',0);
  let buttons=[],yaw=0;
  const update=()=>buttons.forEach(({button,bearing,radius})=>{button.style.transform=`rotate(${bearing-yaw}deg) translateY(-${radius}px)`;});
  return {
    rotate(value){yaw=value;update();},
    set(data,layer){
      nav.replaceChildren();buttons=[];
      for(const link of layoutTransitions(transitions(data,layer))){
        const button=document.createElement('button');button.type='button';button.className='yp-arrow';button.innerHTML=svg;
        button.dataset.panoramaId=link.id;button.dataset.bearing=String(link.bearing);
        const label=link.name||(ru?'Переход к панораме':'Go to panorama');
        button.title=`${label} · ${Math.round(link.bearing)}°`;button.setAttribute('aria-label',button.title);
        button.onpointerdown=e=>e.stopPropagation();button.onclick=()=>go(link);nav.append(button);buttons.push({button,bearing:link.bearing,radius:link.radius});
      }
      update();
    },
    clear(){buttons=[];nav.replaceChildren();}
  };
}

function viewer(host, onView) {
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:grab';
  host.prepend(canvas);
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
      vec2 uv=vec2(fract((a-origin)/6.28318530718),.5-asin(clamp(r.y,-1.,1.))/3.14159265359);
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
    set(image, heading, direction){
      if(direction?.length===2&&direction.every(Number.isFinite)){yaw=direction[0];pitch=Math.max(-85,Math.min(85,direction[1]));}
      origin=heading;gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);ready=true;draw();},
    destroy(){observer.disconnect();gl.deleteTexture(texture);gl.deleteBuffer(buffer);gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));canvas.remove();}
  };
}

export function activate(api) {
  const ru=api.lang==='ru';
  let enabled=false,panel,view,nav,controller,pickController,current,currentLayer,sequence=0;
  const airPoints=api.addPointOverlay?.({
    attribution:'<a href="https://yandex.ru/maps/" target="_blank" rel="noopener">© Яндекс</a>',minzoom:6,
    iconSvg:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><circle cx="32" cy="32" r="29" fill="#766af0" stroke="white" stroke-width="3"/><g stroke="white" stroke-width="2.5" fill="none" stroke-linejoin="round"><path d="M32 11C12 11 12 31 26 41h12C52 31 52 11 32 11Z"/><path d="M32 11c-9 5-9 19-3 30m3-30c9 5 9 19 3 30M19 30h26M26 41l3 5m9-5-3 5"/></g><rect x="27" y="46" width="10" height="7" rx="2" fill="white"/></svg>',
    loadPoints:(bounds,zoom,signal)=>loadAirPoints(bounds,zoom,signal,metadata),
    onClick:oid=>{if(enabled){pickController?.abort();void open({oid,l:'sta'});}},
  });
  const coverage=api.addRasterOverlay?.({
    attribution:'<a href="https://yandex.ru/maps/" target="_blank" rel="noopener">© Яндекс</a>',
    minzoom:0,maxzoom:19,loadTile:(z,x,y,signal)=>coverageTile(z,x,y,signal,airPoints?'stv':'stv,sta'),
  });
  if(!coverage)console.warn('Yandex DEV: map coverage needs editor PluginApi.addRasterOverlay');
  const layerName=layer=>layer==='sta'?(ru?'Яндекс Панорамы с воздуха':'Yandex Aerial Panoramas'):'Yandex Panoramas';
  const close=()=>{sequence++;pickController?.abort();controller?.abort();view?.destroy();view=undefined;current=undefined;currentLayer=undefined;const old=panel;panel=undefined;old?.close();api.setViewCone();};
  async function open(query) {
    const layer=query.l??'stv';query={...query,l:layer};
    controller?.abort();controller=new AbortController();const {signal}=controller;const id=++sequence;
    try {
      if(!panel){
        panel=api.openPanel('Yandex Panoramas DEV');panel.onClose(close);
        panel.body.style.background='#222';
        const host=document.createElement('div');host.style.cssText='position:absolute;inset:0 0 26px';panel.body.append(host);
        nav=navigation(host,link=>void open({oid:link.id,l:link.layer}),ru);
        view=viewer(host,(azimuth,fov)=>{nav.rotate(azimuth);if(current)api.setViewCone({lngLat:current.Data.Point.coordinates.slice(0,2).map(Number),azimuth,fov});});
        const bar=document.createElement('div');bar.className='yp-dev-bar';bar.style.cssText='position:absolute;bottom:0;left:0;right:0;height:26px;box-sizing:border-box;display:flex;align-items:center;gap:8px;overflow:hidden;background:#fff;padding:3px 6px;font:12px sans-serif';panel.body.append(bar);
      }
      const bar=panel.body.querySelector('.yp-dev-bar');nav.clear();bar.textContent=ru?'Загрузка…':'Loading…';
      panel.setTitle?.(`${layerName(layer)} DEV`);
      const data=await metadata(query,signal); if(id!==sequence)return;
      const images=data.Data.Images;
      const zooms=images.Zooms.map(z=>({level:Number(z.level),width:Number(z.width),height:Number(z.height)})).filter(z=>z.width>0&&z.height>0&&z.width<=Math.min(4096,view.maxSize)&&z.width/2<=view.maxSize).sort((a,b)=>b.width-a.width);
      const image=await loadPanoramaImage(images,zooms,data.Data.EquirectangularProjection.Origin[1],signal);
      if(id!==sequence)return;
      const resetDirection=!current||currentLayer!==layer;
      current=data;currentLayer=layer;
      // Yandex Origin[0] is phiLeft: the compass azimuth of the LEFT image edge.
      // Texture u = wrap((view azimuth - phiLeft) / 360), as in the official player.
      view.set(image,Number(data.Data.EquirectangularProjection.Origin[0]),resetDirection?data.Data.View?.Direction?.map(Number):undefined);
      api.markUsed('street','Yandex Panoramas');bar.replaceChildren();
      const link=document.createElement('a');link.textContent='© Яндекс · '+(data.Data.Point.name||(ru?'Открыть в Яндекс Картах':'Open in Yandex Maps'));link.href=`https://yandex.ru/maps/?panorama[pid]=${encodeURIComponent(data.Data.panoramaId)}`;link.target='_blank';link.rel='noopener noreferrer';link.style.cssText='flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';bar.append(link);
      if(layer==='sta'){
        const height=Number(data.Data.Point.coordinates[2]);
        if(Number.isFinite(height))bar.append(document.createTextNode(` · ${Number(height.toFixed(1))} ${ru?'м':'m'}`));
      }
      if(layer==='sta')nav.clear();else nav.set(data,layer);
      const history=panoramaHistory(data,layer);
      const select=document.createElement('select');select.setAttribute('aria-label',ru?'Дата панорамы':'Panorama date');
      select.title=ru?'Дата открытой панорамы; выберите другую дату съёмки':'Displayed panorama date; select another capture';
      select.style.cssText='margin-left:auto;flex:0 0 auto;max-width:160px;font:inherit';
      for(const item of history){const option=document.createElement('option');option.value=item.id;option.textContent=item.date||(ru?'Дата неизвестна':'Unknown date');select.append(option);}
      select.value=data.Data.panoramaId;select.disabled=history.length<2;
      select.onchange=()=>{
        const item=history.find(item=>item.id===select.value);if(!item)return;
        void open({oid:item.id,l:item.layer,...(item.timestamp?{connectionsTimestamp:String(item.timestamp)}:{})});
      };
      bar.append(select);
    } catch(error) {
      if(id!==sequence||signal.aborted)return;
      controller.abort();console.error('Yandex DEV:',error);
      const bar=panel?.body.querySelector('.yp-dev-bar');if(bar)bar.textContent=`${error.message} · ${ru?'Подробности в консоли (возможен CORS)':'See console (possibly CORS)'}`;
    }
  }
  async function openAt(lngLat,zoom) {
    controller?.abort();pickController?.abort();pickController=new AbortController();
    const {signal}=pickController,ticket=++sequence;
    try{
      const balloon=await pickAirPanorama(lngLat,zoom,signal);
      if(ticket!==sequence||signal.aborted)return;
      void open(balloon?{oid:balloon.id,l:'sta'}:{ll:lngLat.join(','),l:'stv'});
    }catch(error){
      if(ticket!==sequence||signal.aborted)return;
      console.warn('Yandex balloon lookup:',error);
      void open({ll:lngLat.join(','),l:'stv'});
    }
  }
  api.addPhotoToggle('panoramas-dev','Yandex Panoramas DEV',ru?'Уличные панорамы и панорамы с воздуха: кликните по улице или значку шара':'Street and aerial panoramas: click a street or balloon',v=>{enabled=v;coverage?.setVisible(v);airPoints?.setVisible(v);if(!v)close();});
  api.onMapClick((lngLat,{onObject,zoom})=>{
    if(!enabled)return false;
    const balloon=airPoints?undefined:cachedAirPanorama(lngLat,zoom);
    if(balloon){pickController?.abort();void open({oid:balloon.id,l:'sta'});return true;}
    if(onObject)return false;
    if(airPoints)void open({ll:lngLat.join(','),l:'stv'});else void openAt(lngLat,zoom);return true;
  });
  return ()=>{airPoints?.setVisible(false);coverage?.setVisible(false);close();};
}
