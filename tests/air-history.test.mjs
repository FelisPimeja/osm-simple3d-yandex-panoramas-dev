import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {panoramaHistory} from '../navigation.js';
import {hitAirPanorama,pickAirPanorama,cachedAirPanorama} from '../coverage.js';
const fixture=async name=>JSON.parse(await readFile(new URL(`fixtures/${name}.json`,import.meta.url),'utf8'));

test('balloon hit test matches its real footprint and does not select a nearby balloon outside it',async()=>{
  const {data}=await fixture('air-hotspots');
  assert.equal(hitAirPanorama(data.features,[185,160]).id,'1254584990_626344425_23_1308758582');
  assert.equal(hitAirPanorama(data.features,[-5,-5]),undefined);
});
test('map click uses the correct projection, source zoom, sta version, and exact balloon ID',async()=>{
  const data=await fixture('air-hotspots'),nativeFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async input=>{
    const url=new URL(String(input));requests.push(url);
    return url.pathname==='/2.1/'?new Response('"stv":{"version":"street-v"},"sta":{"version":"air-v"}'):Response.json(data);
  };
  try{
    const result=await pickAirPanorama([30.316198132932028,59.938556652407559],13,new AbortController().signal);
    assert.deepEqual(result,{id:'1254584990_626344425_23_1308758582',layer:'sta'});
    const request=requests.find(u=>u.searchParams.get('l')==='stj');
    assert.equal(request.searchParams.get('z'),'14');assert.equal(request.searchParams.get('v'),'air-v');
    assert.deepEqual(cachedAirPanorama([30.316198132932028,59.938556652407559],13),result);
  }finally{globalThis.fetch=nativeFetch;}
});
test('history includes current capture even if absent in history, sorted newest first without choosing newest automatically',()=>{
  const data={Data:{panoramaId:'current_1609459200',timestamp:1609459200},Annotation:{HistoricalPanoramas:[
    {timestamp:1672531200,Connection:{oid:'newer_1672531200',href:'?l=sta'}},
    {timestamp:1577836800,Connection:{oid:'older_1577836800'}}
  ]}};
  const list=panoramaHistory(data,'sta');
  assert.deepEqual(list.map(x=>x.date),['2023-01-01','2021-01-01','2020-01-01']);
  assert.equal(list.find(x=>x.id===data.Data.panoramaId).date,'2021-01-01');
  assert(list.every(x=>x.layer==='sta'));
});
test('current metadata date wins over ID timestamp and duplicated historical entry',()=>{
  const data={Data:{panoramaId:'current_1609459200',timestamp:1640995200},Annotation:{HistoricalPanoramas:[{timestamp:1577836800,Connection:{oid:'current_1609459200'}}]}};
  assert.deepEqual(panoramaHistory(data).map(x=>x.date),['2022-01-01']);
});
test('history tolerates missing timestamps and malformed IDs',()=>{
  assert.equal(panoramaHistory({Data:{panoramaId:'test'},Annotation:{}})[0].date,'');
  assert.equal(panoramaHistory({Data:{panoramaId:'pano_1609459200'},Annotation:{}})[0].date,'2021-01-01');
});
