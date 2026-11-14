import { fromFile } from 'geotiff';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Pixel-centre bilinear sampling preserves the outer pixel footprint.
export function resampleBilinear(data, width, height, outWidth, outHeight) {
  const output = new Array(outWidth * outHeight);
  for (let y = 0; y < outHeight; y++) {
    const sy = Math.max(0, Math.min(height - 1, (y + 0.5) * height / outHeight - 0.5));
    const y0 = Math.floor(sy), y1 = Math.min(y0 + 1, height - 1), fy = sy - y0;
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.max(0, Math.min(width - 1, (x + 0.5) * width / outWidth - 0.5));
      const x0 = Math.floor(sx), x1 = Math.min(x0 + 1, width - 1), fx = sx - x0;
      const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx;
      const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx;
      output[y * outWidth + x] = top * (1 - fy) + bottom * fy;
    }
  }
  return output;
}

export async function convertDTM({ input = './raw_data/jezero_dtm.tif', output = './public/data/mars_terrain.json', size = 512 } = {}) {
  if (![512, 1024].includes(size)) throw new Error('Size must be 512 or 1024.');
  const tiff = await fromFile(input);
  try {
    const image = await tiff.getImage();
    const width = image.getWidth(), height = image.getHeight();
    if (width < size || height < size) throw new Error('Input is smaller than the requested grid; upsampling is not supported.');
    if (image.getSamplesPerPixel() !== 1 || image.getSampleFormat(0) !== 3 || image.getBitsPerSample(0) !== 32) {
      throw new Error('Expected a single-band Float32 elevation GeoTIFF.');
    }
    const keys = image.getGeoKeys() || {};
    if (keys.GTModelTypeGeoKey !== 1 || keys.ProjLinearUnitsGeoKey !== 9001) {
      throw new Error('Expected a projected CRS in metres (ProjLinearUnitsGeoKey=9001), not degrees or unspecified units.');
    }
    if (keys.VerticalUnitsGeoKey && keys.VerticalUnitsGeoKey !== 9001) throw new Error('Elevation units must be metres.');
    const transform = image.fileDirectory.getValue('ModelTransformation');
    if (transform && (transform[1] !== 0 || transform[4] !== 0)) throw new Error('Rotated/sheared rasters must first be warped to a north-up grid.');
    const [rx, ry] = image.getResolution();
    if (!(rx > 0 && ry < 0)) throw new Error('Expected positive X and negative Y resolution (north-up).');
    let bounds = image.getBoundingBox();
    if (keys.GTRasterTypeGeoKey === 2) {
      // PixelIsPoint: origin refers to a sample centre, not its upper-left corner.
      bounds = [bounds[0] - rx / 2, bounds[1] - ry / 2, bounds[2] - rx / 2, bounds[3] - ry / 2];
    }
    if (!bounds.every(Number.isFinite)) throw new Error('Invalid georeferencing bounds.');
    const data = await image.readRasters({ samples: [0], interleave: true });
    const noData = image.getGDALNoData();
    const invalid = v => !Number.isFinite(v) || v <= -3.0e38 || (noData !== null && v === Math.fround(noData));
    let validMin = Infinity, replaced = 0;
    for (const value of data) if (!invalid(value)) validMin = Math.min(validMin, value);
    if (!Number.isFinite(validMin)) throw new Error('The entire raster is NoData; no minimum valid elevation exists.');
    for (let i = 0; i < data.length; i++) if (invalid(data[i])) { data[i] = validMin; replaced++; }
    const elevation = resampleBilinear(data, width, height, size, size);
    let minElevation = Infinity, maxElevation = -Infinity;
    for (const value of elevation) { minElevation = Math.min(minElevation, value); maxElevation = Math.max(maxElevation, value); }
    const x = rx * width / size, y = Math.abs(ry) * height / size;
    // A scalar cannot represent two unequal physical pixel dimensions.
    const metersPerPixel = Math.abs(x - y) <= 1e-9 * Math.max(x, y) ? x : { x, y };
    const result = { metadata: { width: size, height: size, metersPerPixel, minElevation, maxElevation, bounds, source: 'NASA MRO HiRISE DTM',
      boundsUnits: 'metres in the source projected CRS', geoKeys: keys,
      sourceWidth: width, sourceHeight: height, sourceMetersPerPixel: { x: rx, y: Math.abs(ry) },
      noDataReplacement: { count: replaced, value: validMin }, resampling: 'bilinear, pixel-centre, full pixel footprint',
      elevationUnits: 'metres (input DTM contract)',
      limitation: 'Resampling changes local slopes. Filled NoData is synthetic and must not be treated as measured traversable terrain.' }, elevation };
    await mkdir(path.dirname(path.resolve(output)), { recursive: true });
    await writeFile(output, JSON.stringify(result));
    return result;
  } finally { await tiff.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [input = './raw_data/jezero_dtm.tif', output = './public/data/mars_terrain.json', size = '512'] = process.argv.slice(2);
  convertDTM({ input, output, size: Number(size) }).then(({metadata}) => {
    console.log(JSON.stringify({ output: path.resolve(output), ...metadata }, null, 2));
  }).catch(error => { console.error(`DTM conversion failed: ${error.message}`); process.exitCode = 1; });
}
