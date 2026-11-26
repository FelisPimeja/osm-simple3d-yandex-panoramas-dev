import test from 'node:test';
import assert from 'node:assert/strict';
import { imageTop } from '../plugin.js';

test('Abkhazia aerial capture places the horizon inside its actual image', () => {
  const width=3584, height=1283, latitude=-25.541015625;
  const top=imageTop(latitude,width,height);
  assert.ok(Math.abs(top-508.775)<1e-9);
  // Equator is row 896 on the full sphere, hence row 387.225 in the source.
  assert.ok(Math.abs(width/4-top-387.225)<1e-9);
  assert.ok(top+height<=width/2+1); // rounded image dimensions reach the nadir
});

test('full sphere and top-aligned cropped road imagery retain placement', () => {
  assert.equal(imageTop(0,1024,512),0);
  assert.ok(Math.abs(imageTop(27.106,3584,1252))<1);
});

test('vertical crops can omit either or both poles', () => {
  assert.equal(imageTop(-30,3600,1200),600);
  assert.equal(imageTop(30,3600,1200),0);
  assert.equal(imageTop(0,3600,1200),300);
});

test('attribution omits missing names and raw panorama IDs', async () => {
  const { panoramaName } = await import('../plugin.js');
  const data=name=>({Data:{panoramaId:'1298159727_673223089_23_1681045215',Point:{name}}});
  assert.equal(panoramaName(data('')), '');
  assert.equal(panoramaName(data('   ')), '');
  assert.equal(panoramaName(data('1298159727_673223089_23_1681045215')), '');
  assert.equal(panoramaName(data('Тверская улица')), 'Тверская улица');
});


test('panorama permalink includes the official viewer parameters and longitude-first coordinates', async () => {
  const { panoramaPermalink } = await import('../plugin.js');
  const data={Data:{panoramaId:'1298164343_672508758_23_1754129476',Point:{coordinates:[37.6217567003,55.82139204259997,0]},View:{Direction:[123,-20],Span:[130,80]}}};
  const url=new URL(panoramaPermalink(data)),p=url.searchParams;
  assert.equal(url.origin,'https://yandex.ru');
  assert.equal(p.get('panorama[id]'),data.Data.panoramaId);
  assert.equal(p.get('panorama[point]'),'37.6217567003,55.82139204259997');
  assert.equal(p.get('ll'),p.get('panorama[point]'));
  assert.equal(p.get('panorama[direction]'),'123,-20');
  assert.equal(p.get('panorama[span]'),'130,80');
  assert.equal(p.get('panorama[full]'),'true');
  assert.equal(p.has('panorama[pid]'),false);
});
