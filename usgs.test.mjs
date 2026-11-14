import {test} from 'node:test';
import assert from 'node:assert/strict';
import {tileBounds,intersectPixels,USGS_MATRIX} from './dist/usgs-themis.js';
test('USGS grid covers Mars without seam or axis reversal',()=>{const m=USGS_MATRIX.matrices[0];assert.deepEqual(tileBounds(m,0,0),[-180,-90,0,90]);assert.deepEqual(tileBounds(m,0,1),[0,-90,180,90]);});
test('COG intersections retain pixel centres on quadrant boundaries',()=>{const bounds=[0,-90,180,90],a=intersectPixels(bounds,[0,-90,90,90]),b=intersectPixels(bounds,[90,-90,180,90]);assert.equal(a.x0,0);assert.equal(a.x1,128);assert.equal(b.x0,128);assert.equal(b.x1,256);assert.equal(a.bbox[2],b.bbox[0]);});
test('geographic degrees map to Mars metres and north-up rows',()=>{const part=intersectPixels([0,-90,180,90],[0,0,180,90]);assert.equal(part.y0,0);assert.equal(part.y1,128);assert.equal(part.bbox[1],0);assert.ok(Math.abs(part.bbox[3]-Math.PI*3396190/2)<1e-8);});
test('outside coverage produces no pixels, not stretched edge values',()=>{assert.equal(intersectPixels([0,0,45,30],[-90,-60,-45,-30]),null);});
