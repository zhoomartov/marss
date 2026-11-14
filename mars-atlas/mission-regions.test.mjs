import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {terrain,plan,graph,coordinates} from './dist/rover-core.js';
const regions=JSON.parse(fs.readFileSync(new URL('./dist/data/mission-regions.json',import.meta.url)));
test('three detailed mission zones have registered, locally bundled imagery',()=>{
 assert.equal(regions.length,3);assert.equal(new Set(regions.map(r=>r.id)).size,3);
 for(const region of regions){
  const dem=JSON.parse(fs.readFileSync(new URL('./dist/'+region.dem,import.meta.url)));
  const png=fs.readFileSync(new URL('./dist/'+region.image,import.meta.url));
  assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);
  assert.equal(png.readUInt32BE(16),region.imageWidth);assert.equal(png.readUInt32BE(20),region.imageHeight);
  assert.ok(region.imageWidth>=2048);assert.ok(region.imageResolutionM<1);
  const expected=[dem.x0-dem.dx/2,dem.y0+(dem.height-.5)*dem.dy,dem.x0+(dem.width-.5)*dem.dx,dem.y0-dem.dy/2];
  expected.forEach((v,i)=>assert.ok(Math.abs(v-region.imageBounds[i])<1e-7));
  assert.ok(Math.abs(region.imageResolutionM*region.imageWidth-dem.dx*dem.width)<1e-7);
  assert.ok(region.imageMissingPercent<1,'Detailed zone should have practically complete image coverage');
  assert.ok(dem.dx<2);assert.ok(dem.values.some(v=>Number.isFinite(v)));
 }
});
for(const region of regions)test(region.name+': route uses measured terrain and verifies the optimum',()=>{
 const dem=JSON.parse(fs.readFileSync(new URL('./dist/'+region.dem,import.meta.url))),t=terrain(dem,dem.routeFactor),r=plan(t,dem.anchors.start,dem.anchors.goal),g=graph(t);
 assert.equal(r.status,'optimal');assert.ok(r.verification.delta<1e-9);assert.ok(r.path.length>2);
 for(let i=1;i<r.path.length;i++)assert.ok(g.edge(r.path[i-1],r.path[i]));
 assert.ok(r.metrics.maxSlopeDeg<=12);assert.ok(r.metrics.energy<=r.energyBudget);assert.ok(r.metrics.hours<=r.timeBudget);
 const nw=coordinates(t,-.5,-.5),nativeNW=coordinates(dem,-.5,-.5);assert.ok(Math.abs(nw.lat-nativeNW.lat)<1e-10);assert.ok(Math.abs(nw.lon-nativeNW.lon)<1e-10);
});
