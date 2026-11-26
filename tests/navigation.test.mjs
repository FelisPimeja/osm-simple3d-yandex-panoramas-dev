import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {transitions,layoutTransitions} from '../navigation.js';
const fixture=async name=>JSON.parse(await readFile(new URL(`fixtures/${name}.json`,import.meta.url),'utf8'));

test('real straight street has only its two direct links, not every graph node',async()=>{
  const data=await fixture('straight');const links=transitions(data);
  assert.equal(links.length,2);
  assert.deepEqual(new Set(links.map(x=>x.id)),new Set(data.Annotation.Thoroughfares.map(x=>new URL(x.Connection.href).searchParams.get('oid'))));
});
test('real Tverskaya junction exposes all four directions and their street names',async()=>{
  const data=await fixture('crossroads');const links=transitions(data);
  assert.equal(links.length,4);
  assert.deepEqual(links.map(x=>Math.round(x.bearing)),[64,315,133,237]);
  assert.equal(links[0].name,'Бульварное кольцо');
  assert.equal(links[2].name,'Тверская улица');
});
test('graph fallback includes incoming edges, locates current node by pano ID, and excludes disconnected nearby nodes',async()=>{
  const data=await fixture('crossroads');const expected=transitions(data).map(x=>x.id).sort();
  data.Annotation.Thoroughfares=[];
  const graph=data.Annotation.Graph;
  graph.Nodes.forEach(node=>{if(node.id===0)node.id=777;});
  graph.Edges=graph.Edges.map(edge=>({src:edge.dst,dst:edge.src===0?777:edge.src}));
  const links=transitions(data);
  assert.deepEqual(links.map(x=>x.id).sort(),expected);
  assert(links.every(x=>x.source==='graph'&&Number.isFinite(x.bearing)));
  assert.equal(links.length,4);
});
test('explicit connection adds a side link without duplicating official links or adding malformed ones',async()=>{
  const data=await fixture('straight');const existing=transitions(data)[0];
  data.Annotation.Connections=[{oid:'side',name:'Переулок',Point:{coordinates:[37.621,55.7545]}},{oid:existing.id,Point:{coordinates:[37.621,55.7545]}},{href:'http://[bad',Point:{coordinates:[37.621,55.7545]}},{oid:'bad-point',Point:{coordinates:[null,null]}}];
  const links=transitions(data);assert.equal(links.length,3);assert.equal(links.find(x=>x.id==='side').name,'Переулок');
});
test('invalid explicit direction falls back to graph; missing current graph node invents no links',async()=>{
  const data=await fixture('straight');data.Annotation.Thoroughfares.forEach(x=>{x.Direction=[null,0];});
  assert.equal(transitions(data).length,2);
  data.Annotation.Graph.Nodes=data.Annotation.Graph.Nodes.filter(x=>x.panoid!==data.Data.panoramaId);
  assert.equal(transitions(data).length,0);
});
test('arrows across the 360-degree boundary use separate rings when bearings almost overlap',()=>{
  const links=layoutTransitions([{id:'a',bearing:355},{id:'b',bearing:5},{id:'c',bearing:180}]);
  assert.notEqual(links[0].radius,links[1].radius);
  assert.equal(links[0].radius,links[2].radius);
});
