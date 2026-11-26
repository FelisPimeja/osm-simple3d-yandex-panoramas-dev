const BASE='https://api-maps.yandex.ru/services/panoramas/1.x/';
const radians=degrees=>degrees*Math.PI/180;
const normalize=degrees=>(degrees%360+360)%360;
const angleBetween=(a,b)=>Math.abs(((a-b+540)%360)-180);

function idOf(connection) {
  if(connection?.oid)return String(connection.oid);
  if(!connection?.href)return undefined;
  try{return new URL(connection.href,BASE).searchParams.get('oid')||undefined;}catch{return undefined;}
}
export function connectionLayer(connection,fallback='stv') {
  try{const layer=new URL(connection?.href,BASE).searchParams.get('l');return ['sta','stv'].includes(layer)?layer:fallback;}catch{return fallback;}
}
function point(coordinates) {
  if(!Array.isArray(coordinates)||coordinates.length<2)return undefined;
  const [lon,lat]=coordinates;
  if(lon==null||lat==null||lon===''||lat==='')return undefined;
  const value=[Number(lon),Number(lat)];
  return value.every(Number.isFinite)&&Math.abs(value[0])<=180&&Math.abs(value[1])<=90?value:undefined;
}
function bearing(from,to) {
  if(!from||!to||from.every((v,i)=>Math.abs(v-to[i])<1e-10))return undefined;
  const delta=radians(to[0]-from[0]),a=radians(from[1]),b=radians(to[1]);
  return normalize(Math.atan2(Math.sin(delta)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(delta))*180/Math.PI);
}

/** Every explicit link and every edge incident to this panorama; never all nearby Graph.Nodes. */
export function transitions(data,defaultLayer='stv') {
  const current=String(data.Data.panoramaId),annotation=data.Annotation??{};
  const position=point(data.Data.Point?.coordinates),links=new Map();
  const add=(id,direction,name,source,layer=defaultLayer)=>{
    if(!id||id===current||links.has(id)||!Number.isFinite(direction))return;
    links.set(id,{id,bearing:normalize(direction),name:typeof name==='string'?name:'',source,layer});
  };
  for(const link of annotation.Thoroughfares??[]){
    const raw=link.Direction?.[0];
    const direction=raw==null||raw===''?undefined:Number(raw);
    add(idOf(link.Connection),direction,link.Connection?.name,'thoroughfare',connectionLayer(link.Connection,defaultLayer));
  }
  for(const connection of annotation.Connections??[]){
    add(idOf(connection),bearing(position,point(connection.Point?.coordinates)),connection.name,'connection',connectionLayer(connection,defaultLayer));
  }
  const graph=annotation.Graph;
  const nodes=new Map((graph?.Nodes??[]).map(node=>[String(node.id),node]));
  const root=(graph?.Nodes??[]).find(node=>String(node.panoid)===current);
  if(root){
    for(const edge of graph.Edges??[]){
      const other=String(edge.src)===String(root.id)?edge.dst:String(edge.dst)===String(root.id)?edge.src:undefined;
      if(other==null)continue;
      const node=nodes.get(String(other));if(!node)continue;
      add(node.panoid?String(node.panoid):idOf(node),bearing(position,point([node.lon,node.lat])),node.name,'graph',connectionLayer(node,defaultLayer));
    }
  }
  return [...links.values()];
}

/** Stagger close bearings radially so fork arrows remain individually clickable. */
export function layoutTransitions(links) {
  const placed=[];
  return links.map(link=>{
    let ring=0;
    while(placed.some(other=>other.ring===ring&&angleBetween(other.bearing,link.bearing)<45))ring++;
    placed.push({...link,ring});
    return {...link,radius:(links.length>2?58:40)+ring*76};
  });
}

/** Include the displayed capture, sort available dates newest first, and keep its actual ID selected. */
export function panoramaHistory(data,layer='stv') {
  const id=String(data.Data.panoramaId),items=new Map();
  const timestampOf=(value,id)=>{
    const explicit=Number(value),suffix=Number(id.split('_').at(-1));
    const timestamp=Number.isFinite(explicit)&&explicit>0?explicit:Number.isFinite(suffix)&&suffix>0?suffix:undefined;
    return timestamp&&Number.isFinite(new Date(timestamp*1000).getTime())?timestamp:undefined;
  };
  for(const item of data.Annotation?.HistoricalPanoramas??[]){
    const target=idOf(item.Connection);if(!target)continue;
    const timestamp=timestampOf(item.timestamp,target);
    items.set(target,{id:target,timestamp,layer:connectionLayer(item.Connection,layer)});
  }
  const previous=items.get(id);
  const timestamp=timestampOf(data.Data.timestamp??previous?.timestamp,id);
  items.set(id,{id,timestamp,layer});
  return [...items.values()].map(item=>({...item,date:item.timestamp?new Date(item.timestamp*1000).toISOString().slice(0,10):''}))
    .sort((a,b)=>(b.timestamp??-Infinity)-(a.timestamp??-Infinity)||a.id.localeCompare(b.id));
}
