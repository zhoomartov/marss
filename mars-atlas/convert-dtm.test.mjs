import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeArrayBuffer } from 'geotiff';
import { convertDTM, resampleBilinear } from './scripts/convert-hirise-dtm.mjs';

test('bilinear interpolation samples pixel centres', () => {
  assert.deepEqual(resampleBilinear([0, 2, 4, 6], 2, 2, 1, 1), [3]);
});
test('Float32 GeoTIFF conversion preserves footprint and planar slopes, fills NoData', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'ares-dtm-test-'));
  try {
    const input = path.join(folder, 'input.tif'), output = path.join(folder, 'terrain.json');
    const width = 1024, height = 1024;
    const data = new Float32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = x * 2 + y * 3 - 3000;
    data[0] = NaN; data[1] = -3.4028234663852886e38;
    const tags = { width, height, ModelPixelScale: [2, 2, 0], ModelTiepoint: [0, 0, 0, 1000, 5000, 0], ProjectedCSTypeGeoKey: 32767, GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjLinearUnitsGeoKey: 9001 };
    await writeFile(input, Buffer.from(writeArrayBuffer(data, structuredClone(tags))));
    const result = await convertDTM({ input, output });
    assert.equal(result.elevation.length, 512 * 512);
    assert.equal(result.metadata.metersPerPixel, 4);
    assert.deepEqual(result.metadata.bounds, [1000, 2952, 3048, 5000]);
    assert.equal(result.metadata.noDataReplacement.count, 2);
    assert.equal((result.elevation[1001] - result.elevation[1000]) / 4, 1);
    assert.equal((result.elevation[1512] - result.elevation[1000]) / 4, 1.5);
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), result);
    tags.ModelPixelScale = [2, 3, 0];
    await writeFile(input, Buffer.from(writeArrayBuffer(data, structuredClone(tags))));
    assert.deepEqual((await convertDTM({ input, output })).metadata.metersPerPixel, { x: 4, y: 6 });
    data.fill(NaN);
    await writeFile(input, Buffer.from(writeArrayBuffer(data, structuredClone(tags))));
    await assert.rejects(convertDTM({ input, output }), /entire raster is NoData/);
    tags.ProjLinearUnitsGeoKey = 9002;
    await writeFile(input, Buffer.from(writeArrayBuffer(data, structuredClone(tags))));
    await assert.rejects(convertDTM({ input, output }), /projected CRS in metres/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});


