import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tilePixel,tileURL} from './dist/wmts.js';
import {distance,routePoints,summarize,analyzeRoute} from './dist/route.js';
const m={id:'7',width:256,height:128,tw:512,th:512};
test('tile coordinates wrap at dateline and clamp south pole',()=>{assert.deepEqual(tilePixel(90,-180,m),{col:0,row:0,x:0,y:0});assert.deepEqual(tilePixel(0,180,m),tilePixel(0,-180,m));assert.equal(tilePixel(-90,0,m).row,127);assert.equal(tilePixel(-90,0,m).y,511);assert.throws(()=>tilePixel(91,0,m));});
test('prime meridian and equator fall on correct tile edges',()=>{assert.deepEqual(tilePixel(0,0,m),{col:128,row:64,x:0,y:0});});
test('uses server template and actual matrix ID',()=>{assert.equal(tileURL({template:'https://x/{TileMatrix}/{TileRow}/{TileCol}',style:'default',set:'eq'},m,3,4),'https://x/7/3/4');});
test('Mars distances and shortest dateline route',()=>{assert.ok(Math.abs(distance({lat:0,lon:179},{lat:0,lon:-179})-118.315)<.01);const p=routePoints({lat:0,lon:179},{lat:0,lon:-179});assert.equal(p.length,65);assert.ok(p.every(x=>Math.abs(x.lon)>=179));});
test('coincident endpoints stay finite; antipodes rejected',()=>{assert.ok(routePoints({lat:90,lon:0},{lat:90,lon:0}).every(p=>Number.isFinite(p.lat)));assert.throws(()=>routePoints({lat:0,lon:0},{lat:0,lon:180}));});
test('opaque RGB never becomes a safe rating',()=>{const s=summarize([{ctx:{valid:true},mola:{valid:true}}],1);assert.equal(s.coverage,1);assert.equal(s.safety,'unknown');});
test('missing layer remains unknown and uncovers samples',async()=>{const report=await analyzeRoute({sample:async key=>{if(key==='mola')throw Error('offline');return {valid:true};}},{lat:0,lon:0},{lat:0,lon:1});assert.equal(report.covered,0);assert.equal(report.total,65);assert.equal(report.safety,'unknown');});
test('cancelled analysis does not return stale results',async()=>{assert.equal(await analyzeRoute({}, {lat:0,lon:0},{lat:0,lon:1},()=>false),null);});

import {planMosaic} from './dist/wmts.js';
const pyramid={matrices:Array.from({length:12},(_,i)=>({id:String(i),width:2**(i+1),height:2**i,tw:512,th:512}))};
test('viewport zoom requests progressively finer real tiles',()=>{const levels=[360,36,3.6,.36].map(span=>+planMosaic(pyramid,[-span/2,-span/4,span/2,span/4],1440).m.id);assert.ok(levels.every((v,i)=>!i||v>levels[i-1]));});
test('high density display requests higher resolution than CSS pixels',()=>{const bounds=[76,17,78,18];assert.ok(+planMosaic(pyramid,bounds,2304).m.id>+planMosaic(pyramid,bounds,1440).m.id);});
test('native maximum is explicit rather than inventing finer data',()=>{const p=planMosaic(pyramid,[77.45,18.44,77.451,18.441],1440);assert.equal(p.m.id,'11');assert.equal(p.sourceLimit,true);assert.ok(p.metresPerPixel>10&&p.metresPerPixel<11);});
test('tile atlas respects GPU and memory budgets',()=>{const p=planMosaic(pyramid,[-180,-90,180,90],8000,2048);assert.ok((p.right-p.left+1)*p.m.tw<=2048);assert.ok((p.bottom-p.top+1)*p.m.th<=2048);assert.equal(p.budgetLimited,true);});
test('exact tile edges never allocate an extra row or column',()=>{const p=planMosaic(pyramid,[-180,0,0,90],512);assert.equal(p.left,0);assert.equal(p.right,0);assert.equal(p.top,0);assert.equal(p.bottom,0);assert.throws(()=>planMosaic(pyramid,[1,0,0,1]));});


import {parseCTXService} from './dist/wmts.js';
test('CTX V01 validates Mars grid and excludes artificial oversampling levels',()=>{const tileInfo={origin:{x:-180,y:90},rows:512,cols:512,spatialReference:{wkid:104971},lods:Array.from({length:18},(_,level)=>({level,resolution:.3515625/2**level}))};const meta=parseCTXService({tileInfo});assert.equal(meta.matrices.length,13);assert.equal(meta.matrices.at(-1).id,'12');assert.equal(meta.radius,3396190);assert.ok(planMosaic(meta,[77.5,18.3,77.5001,18.3001],1440).metresPerPixel<5.1);assert.throws(()=>parseCTXService({tileInfo:{...tileInfo,origin:{x:0,y:90}}}));});

test('recorded CTX service metadata tolerates decimal roundoff',async()=>{const fs=await import('node:fs/promises');const tileInfo=JSON.parse(await fs.readFile(new URL('./dist/data/ctx-v01-tileinfo.json',import.meta.url),'utf8'));const meta=parseCTXService({tileInfo});assert.equal(meta.matrices.at(-1).width,8192);assert.equal(meta.matrices.at(-1).height,4096);});

test('mosaic streams first tile before slow tiles and stops superseded work',async()=>{
 const {TrekClient}=await import('./dist/wmts.js');const previous=globalThis.document;
 globalThis.document={createElement:()=>({getContext:()=>({drawImage(){}})})};
 try{const client=new TrekClient();client.metadataFor=async()=>pyramid;let calls=0,live=true,first=0;client.tile=async()=>{calls++;await new Promise(r=>setTimeout(r,5));return {canvas:{}};};const result=await client.mosaic('ctx',[-180,-90,180,90],4096,()=>live,{onProgress:r=>{first=r.loaded;live=false;}});assert.equal(result,null);assert.equal(first,1);assert.ok(calls<=6);}
 finally{globalThis.document=previous;}
});
test('mosaic reports incremental progress and complete result',async()=>{
 const {TrekClient}=await import('./dist/wmts.js');const previous=globalThis.document;globalThis.document={createElement:()=>({getContext:()=>({drawImage(){}})})};
 try{const client=new TrekClient();client.metadataFor=async()=>pyramid;client.tile=async()=>({canvas:{}});const updates=[];const result=await client.mosaic('ctx',[-180,-90,180,90],2048,()=>true,{onProgress:r=>updates.push(r.loaded)});assert.equal(result.loaded,result.total);assert.equal(updates[0],1);assert.equal(updates.at(-1),result.total);}
 finally{globalThis.document=previous;}
});
test('route reads pixels lazily and reuses the numerical buffer',async()=>{const {TrekClient}=await import('./dist/wmts.js');const client=new TrekClient();client.metadataFor=async()=>({matrices:[{id:'0',width:2,height:1,tw:1,th:1}]});let reads=0;const tile={canvas:{getContext:()=>({getImageData:()=>{reads++;return {data:new Uint8ClampedArray([11,22,33,255])};}})}};client.tile=async()=>tile;assert.equal(reads,0);const first=await client.sample('ctx',0,0);await client.sample('ctx',0,0);assert.equal(reads,1);assert.deepEqual(first.rgba,[11,22,33,255]);});
