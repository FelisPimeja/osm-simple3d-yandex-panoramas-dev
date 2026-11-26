import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPanoramaImage } from '../plugin.js';

test('a failed detail tile falls back to a complete lower-resolution image; cancellation never falls back', async () => {
  const saved={document:globalThis.document,fetch:globalThis.fetch,createImageBitmap:globalThis.createImageBitmap};
  const requests=[],draws=[];
  globalThis.document={createElement(){const canvas={getContext:()=>({fillRect(){},drawImage(...args){draws.push([canvas.width,args]);}})};return canvas;}};
  globalThis.createImageBitmap=async()=>({close(){}});
  const images={imageId:'kqzA51MjGQBt',Tiles:{width:256,height:256}};
  const zooms=[{level:2,width:3584,height:1252},{level:3,width:1792,height:626}];
  try {
    globalThis.fetch=async url=>{requests.push(url);return url.endsWith('/2.3.4')?new Response('',{status:500}):new Response('tile');};
    const result=await loadPanoramaImage(images,zooms,0,new AbortController().signal);
    assert.equal(result.width,1792);
    assert.equal(requests.filter(url=>url.includes('/3.')).length,21);
    assert.ok(requests.some(url=>url.endsWith('/2.3.4')));
    assert.equal(draws.filter(([width])=>width===1792).length,21);
    requests.length=0;
    globalThis.fetch=async url=>{requests.push(url);return new Response('',{status:500});};
    await assert.rejects(loadPanoramaImage(images,zooms,0,new AbortController().signal),/HTTP 500/);
    requests.length=0;
    const controller=new AbortController();
    globalThis.fetch=async url=>{requests.push(url);controller.abort();throw controller.signal.reason;};
    await assert.rejects(loadPanoramaImage(images,zooms,0,controller.signal),{name:'AbortError'});
    assert.ok(requests.every(url=>url.includes('/2.')));
  } finally {
    for(const [key,value] of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;
  }
});
