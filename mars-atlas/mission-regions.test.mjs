import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {terrain,plan,graph,coordinates} from './dist/rover-core.js';
import {MapView} from './dist/rover-map.js';
const regions=JSON.parse(fs.readFileSync(new URL('./dist/data/mission-regions.json',import.meta.url)));
test('zoom keeps the pointer anchored and clamps panning to the footprint',()=>{
 const v=new MapView(),before=v.point(.4,.3);v.scale(2,.4,.3);assert.deepEqual(v.point(.4,.3),before);
 v.x=-5;v.y=5;v.clamp();assert.equal(v.x,0);assert.equal(v.y,.5);v.scale(100);assert.equal(v.zoom,4);v.fit();assert.deepEqual(v.point(.4,.3),before);
});
test('three detailed mission zones have registered locally bundled imagery',()=>{
 assert.equal(regions.length,3);assert.equal(new Set(regions.map(r=>r.id)).size,3);
 for(const r of regions){
  const d=JSON.parse(fs.readFileSync(new URL('./dist/'+r.dem,import.meta.url))),png=fs.readFileSync(new URL('./dist/'+r.image,import.meta.url));
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(png.readUInt32BE(16),r.imageWidth);assert.equal(png.readUInt32BE(20),r.imageHeight);
  assert.ok(r.imageWidth>=2048);assert.ok(r.imageResolutionM<1);assert.ok(r.imageMissingPercent<1);
  const expected=[d.x0-d.dx/2,d.y0+(d.height-.5)*d.dy,d.x0+(d.width-.5)*d.dx,d.y0-d.dy/2];
  expected.forEach((v,i)=>assert.ok(Math.abs(v-r.imageBounds[i])<1e-7));
  assert.ok(Math.abs(r.imageResolutionM*r.imageWidth-d.dx*d.width)<1e-7);assert.ok(d.dx<2);
 }
});
for(const r of regions)test(r.name+': route follows measured terrain and verifies optimum',()=>{
 const d=JSON.parse(fs.readFileSync(new URL('./dist/'+r.dem,import.meta.url))),t=terrain(d,d.routeFactor),result=plan(t,d.anchors.start,d.anchors.goal),g=graph(t);
 assert.equal(result.status,'optimal');assert.ok(result.verification.delta<1e-9);assert.ok(result.path.length>2);
 for(let i=1;i<result.path.length;i++)assert.ok(g.edge(result.path[i-1],result.path[i]));
 assert.ok(result.metrics.maxSlopeDeg<=12);assert.ok(result.metrics.energy<=result.energyBudget);assert.ok(result.metrics.hours<=result.timeBudget);
 const a=coordinates(t,-.5,-.5),b=coordinates(d,-.5,-.5);assert.ok(Math.abs(a.lat-b.lat)<1e-10);assert.ok(Math.abs(a.lon-b.lon)<1e-10);
});
