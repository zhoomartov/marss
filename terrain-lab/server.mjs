import http from 'node:http';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  normalizeLon,
  clampLat,
  clampSpan,
  computeTerrainBounds,
} from './public/mars-coords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const CACHE_DIR = path.join(__dirname, 'cache');
const CUSTOM_LOCATIONS_FILE = path.join(DATA_DIR, 'locations.json');
const OFFICIAL_CATALOG_FILE = path.join(DATA_DIR, 'mars-nomenclature.json');

const PORT = Number(process.env.PORT || 4174);
const HOST = process.env.HOST || '127.0.0.1';
const ATLAS_URL = process.env.ATLAS_URL || 'http://127.0.0.1:4173';

export const TEXTURE_LAYERS = {
  viking: {
    id: 'viking',
    name: 'Viking Global Color Mosaic (232 m/px)',
    wmsLayer: 'MDIM21_color',
    trekService: 'Mars_Viking_MDIM21_ClrMosaic_global_232m',
  },
  themis: {
    id: 'themis',
    name: 'THEMIS IR + MOLA Blend (100 m/px)',
    wmsLayer: 'MOLA_THEMIS_blend',
    trekService: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
  },
  mola: {
    id: 'mola',
    name: 'MOLA Colorized Laser Altimetry (463 m/px)',
    wmsLayer: 'MOLA_color',
    trekService: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
  },
  hillshade: {
    id: 'hillshade',
    name: 'HRSC + MOLA Blended Hillshade (200 m/px)',
    wmsLayer: 'HRSC_MOLA_Blend_Hillshade',
    trekService: 'Mars_MGS_MOLA_ShadedRelief_merge_global_463m',
  },
};

export const FEATURED_LOCATIONS = [
  { id: 'feat-olympus', name: 'Olympus Mons', type: 'Mons, montes', lat: 18.65, lon: -133.8, spanDeg: 11, diameterKm: 610.13, source: 'featured' },
  { id: 'feat-jezero', name: 'Jezero Crater', type: 'Crater, craters', lat: 18.38, lon: 77.58, spanDeg: 1.5, diameterKm: 47.52, source: 'featured' },
  { id: 'feat-valles', name: 'Valles Marineris (Candor / Coprates)', type: 'Vallis, valles', lat: -11.5, lon: -66.0, spanDeg: 10, diameterKm: 3769, source: 'featured' },
  { id: 'feat-gale', name: 'Gale Crater (Aeolis Mons / Mt. Sharp)', type: 'Crater, craters', lat: -5.08, lon: 137.85, spanDeg: 3.2, diameterKm: 154.0, source: 'featured' },
  { id: 'feat-noctis', name: 'Noctis Labyrinthus', type: 'Labyrinthus', lat: -7.0, lon: -101.2, spanDeg: 6.5, diameterKm: 1190, source: 'featured' },
  { id: 'feat-hellas', name: 'Hellas Planitia Rim', type: 'Planitia, planitiae', lat: -36.5, lon: 55.0, spanDeg: 12, diameterKm: 2300, source: 'featured' },
  { id: 'feat-arsis', name: 'Arsia Mons Caldera', type: 'Mons, montes', lat: -8.35, lon: -120.09, spanDeg: 7.5, diameterKm: 475, source: 'featured' },
  { id: 'feat-kasei', name: 'Kasei Valles', type: 'Vallis, valles', lat: 24.6, lon: -65.0, spanDeg: 7.0, diameterKm: 1580, source: 'featured' },
];

let geoTiffModPromise = null;
async function getGeoTIFF() {
  if (!geoTiffModPromise) {
    geoTiffModPromise = import(path.join(PUBLIC_DIR, 'assets', 'geotiff.js')).then((m) =>
      m.fromArrayBuffer ? m : m.default?.fromArrayBuffer ? m.default : globalThis.GeoTIFF
    );
  }
  return geoTiffModPromise;
}

function diameterToSpanDeg(diameterKm) {
  const d = Number(diameterKm) || 0;
  if (d <= 0) return 2.0;
  const deg = (d / 59.27) * 1.65;
  return Number(clampSpan(Math.max(0.8, Math.min(14, deg))).toFixed(2));
}

let officialCatalogCache = null;
let catalogLoadPromise = null;
let officialFallbackAt = 0;

export async function ensureOfficialCatalog() {
  if (officialCatalogCache) return officialCatalogCache;
  if (officialFallbackAt && Date.now() - officialFallbackAt < 300000) {
    return FEATURED_LOCATIONS.map((x) => ({ ...x, source: 'usgs' }));
  }
  if (catalogLoadPromise) return catalogLoadPromise;

  catalogLoadPromise = (async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    if (existsSync(OFFICIAL_CATALOG_FILE)) {
      try {
        const raw = await fs.readFile(OFFICIAL_CATALOG_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          officialCatalogCache = parsed;
          return officialCatalogCache;
        }
      } catch {
        // Re-fetch on corrupt cache
      }
    }

    try {
      const wfsUrl =
        'https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_nomen_wfs.map' +
        '&SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ms:MARS_POINT&OUTPUTFORMAT=application/json';
      const res = await fetch(wfsUrl, { signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`USGS WFS status ${res.status}`);
      const geojson = await res.json();
      const features = Array.isArray(geojson.features) ? geojson.features : [];
      const items = [];
      for (const f of features) {
        const coords = f.geometry?.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) continue;
        const lon = normalizeLon(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lat) || Math.abs(lat) > 86.5) continue;
        const props = f.properties || {};
        const name = String(props.clean_feature || props.feature || '').trim();
        if (!name) continue;
        const diameterKm = Number(props.diameter) || 0;
        items.push({
          id: `usgs-${props.feature_id || items.length}`,
          name,
          type: String(props.type || 'Feature'),
          lat: Number(lat.toFixed(4)),
          lon: Number(lon.toFixed(4)),
          diameterKm: Number(diameterKm.toFixed(2)),
          spanDeg: diameterToSpanDeg(diameterKm),
          source: 'usgs',
        });
      }
      items.sort((a, b) => b.diameterKm - a.diameterKm || a.name.localeCompare(b.name));
      if (items.length > 0) {
        await fs.writeFile(OFFICIAL_CATALOG_FILE, JSON.stringify(items), 'utf8');
        officialCatalogCache = items;
        return officialCatalogCache;
      }
    } catch (err) {
      console.warn('[terrain-lab] USGS WFS catalog fallback used:', err.message);
    }

    officialFallbackAt = Date.now();
    return FEATURED_LOCATIONS.map((x) => ({ ...x, source: 'usgs' }));
  })();

  try {
    return await catalogLoadPromise;
  } finally {
    catalogLoadPromise = null;
  }
}

async function readCustomLocations() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(CUSTOM_LOCATIONS_FILE)) {
    await fs.writeFile(CUSTOM_LOCATIONS_FILE, '[]\n', 'utf8');
    return [];
  }
  try {
    const raw = await fs.readFile(CUSTOM_LOCATIONS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeCustomLocations(list) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CUSTOM_LOCATIONS_FILE, JSON.stringify(list, null, 2) + '\n', 'utf8');
}

function terrainKey(bounds, gridSize) {
  const sig = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}:${gridSize}`;
  return crypto.createHash('sha1').update(sig).digest('hex').slice(0, 16);
}

const inflightTasks = new Map();
function dedupe(key, fn) {
  if (inflightTasks.has(key)) return inflightTasks.get(key);
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inflightTasks.delete(key));
  inflightTasks.set(key, p);
  return p;
}

async function ensureDemCached(bounds, gridSize) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const key = terrainKey(bounds, gridSize);
  const binPath = path.join(CACHE_DIR, `dem_${key}.bin`);
  const metaPath = path.join(CACHE_DIR, `dem_${key}.json`);

  if (existsSync(binPath) && existsSync(metaPath)) {
    const [bin, metaRaw] = await Promise.all([
      fs.readFile(binPath),
      fs.readFile(metaPath, 'utf8'),
    ]);
    return { bin, meta: JSON.parse(metaRaw), cached: true, key };
  }

  return dedupe(`dem:${key}`, async () => {
    const bboxStr = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
    const endpoints = [
      {
        source: 'NASA Mars Trek · HRSC + MOLA Blended DEM (200 m/px, S16)',
        url:
          'https://trek.nasa.gov/mars/trekarcgis/rest/services/' +
          'Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer/exportImage' +
          `?bbox=${bboxStr}&bboxSR=104905&imageSR=104905&size=${gridSize},${gridSize}` +
          '&format=tiff&pixelType=S16&interpolation=RSP_BilinearInterpolation&f=image',
      },
      {
        source: 'NASA Mars Trek · MGS MOLA Global DEM (463 m/px, S16)',
        url:
          'https://trek.nasa.gov/mars/trekarcgis/rest/services/' +
          'mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer/exportImage' +
          `?bbox=${bboxStr}&bboxSR=104905&imageSR=104905&size=${gridSize},${gridSize}` +
          '&format=tiff&pixelType=S16&interpolation=RSP_BilinearInterpolation&f=image',
      },
    ];

    let lastErr = null;
    for (const ep of endpoints) {
      try {
        const res = await fetch(ep.url, { signal: AbortSignal.timeout(25000) });
        if (!res.ok) throw new Error(`DEM HTTP ${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        const GeoTIFF = await getGeoTIFF();
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuf);
        const image = await tiff.getImage();
        const width = image.getWidth();
        const height = image.getHeight();
        const [rasters] = await image.readRasters();

        const int16 = new Int16Array(width * height);
        let minElevM = 32767;
        let maxElevM = -32768;
        let sum = 0;
        let valid = 0;

        for (let i = 0; i < int16.length; i++) {
          const v = rasters[i];
          if (Number.isFinite(v) && v > -30000 && v < 30000) {
            const iv = Math.round(v);
            int16[i] = iv;
            if (iv < minElevM) minElevM = iv;
            if (iv > maxElevM) maxElevM = iv;
            sum += iv;
            valid++;
          } else {
            int16[i] = -32768;
          }
        }
        const meanElevM = valid ? Math.round(sum / valid) : 0;
        if (!valid) minElevM = maxElevM = 0;
        for (let i = 0; i < int16.length; i++) {
          if (int16[i] === -32768) int16[i] = meanElevM;
        }

        const bin = Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength);
        const meta = {
          key,
          width,
          height,
          bounds,
          minElevM,
          maxElevM,
          meanElevM,
          reliefM: maxElevM - minElevM,
          source: ep.source,
          createdAt: new Date().toISOString(),
        };

        await Promise.all([
          fs.writeFile(binPath, bin),
          fs.writeFile(metaPath, JSON.stringify(meta, null, 2)),
        ]);

        return { bin, meta, cached: false, key };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All Mars DEM endpoints failed');
  });
}

async function ensureTextureCached(bounds, layerKey = 'viking', texSize = 1024) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const layer = TEXTURE_LAYERS[layerKey] || TEXTURE_LAYERS.viking;
  const key = terrainKey(bounds, texSize);
  const jpgPath = path.join(CACHE_DIR, `tex_${layer.id}_${key}.jpg`);

  if (existsSync(jpgPath)) {
    const buf = await fs.readFile(jpgPath);
    return { buf, cached: true, contentType: 'image/jpeg', layer };
  }

  return dedupe(`tex:${layer.id}:${key}`, async () => {
    const bboxStr = `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
    const urls = [
      // Primary: USGS Astrogeology WMS 1.1.1 (exact lon,lat BBOX cutout)
      'https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=/maps/mars/mars_simp_cyl.map' +
        `&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=${encodeURIComponent(layer.wmsLayer)}` +
        `&STYLES=&SRS=EPSG:4326&BBOX=${bboxStr}&WIDTH=${texSize}&HEIGHT=${texSize}&FORMAT=image/jpeg`,
      // Fallback: NASA Mars Trek ArcGIS ImageServer exportImage for exact same BBOX
      `https://trek.nasa.gov/mars/trekarcgis/rest/services/${layer.trekService}/ImageServer/exportImage` +
        `?bbox=${bboxStr}&bboxSR=104905&imageSR=104905&size=${texSize},${texSize}&format=jpg&f=image`,
    ];

    let lastErr = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(25000) });
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.startsWith('image/')) {
          throw new Error(`Texture HTTP ${res.status} (${ct})`);
        }
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength < 1200) {
          throw new Error('Blank or truncated texture response');
        }
        await fs.writeFile(jpgPath, buf);
        return { buf, cached: false, contentType: 'image/jpeg', layer };
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('All Mars texture endpoints failed');
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new Error('Payload too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export function createTerrainServer() {
  return http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    let url;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      sendJson(res, 400, { error: 'Malformed URL' });
      return;
    }

    const pathname = decodeURIComponent(url.pathname);

    try {
      // 1. Health & configuration
      if (pathname === '/api/health' && req.method === 'GET') {
        sendJson(res, 200, {
          status: 'ok',
          service: 'ares-terrain-lab',
          atlasUrl: ATLAS_URL,
          layers: Object.values(TEXTURE_LAYERS),
        });
        return;
      }

      // 2. Locations catalog (Official USGS 1929 Mars objects + Custom user points)
      if (pathname === '/api/locations' && req.method === 'GET') {
        const [official, custom] = await Promise.all([
          ensureOfficialCatalog(),
          readCustomLocations(),
        ]);
        const q = (url.searchParams.get('q') || '').trim().toLowerCase();
        const typeFilter = (url.searchParams.get('type') || '').trim().toLowerCase();
        const limit = Math.min(2500, Math.max(1, Number(url.searchParams.get('limit') || 2500)));

        let filtered = official;
        if (q) {
          filtered = filtered.filter(
            (item) =>
              item.name.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
          );
        }
        if (typeFilter) {
          filtered = filtered.filter((item) => item.type.toLowerCase().includes(typeFilter));
        }

        sendJson(res, 200, {
          featured: FEATURED_LOCATIONS,
          custom,
          official: filtered.slice(0, limit),
          totalOfficial: official.length,
        });
        return;
      }

      if (pathname === '/api/locations' && req.method === 'POST') {
        const body = await readJsonBody(req);
        const name = String(body.name || '').trim().slice(0, 90);
        const rawLat = Number(body.lat);
        const rawLon = Number(body.lon);
        if (!name) {
          sendJson(res, 400, { error: 'Location name is required' });
          return;
        }
        if (!Number.isFinite(rawLat) || rawLat < -86 || rawLat > 86) {
          sendJson(res, 400, { error: 'Latitude must be between -86° and +86°' });
          return;
        }
        if (!Number.isFinite(rawLon)) {
          sendJson(res, 400, { error: 'Longitude must be a valid number' });
          return;
        }

        const entry = {
          id: `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          name,
          type: String(body.type || 'Custom base / waypoint').trim().slice(0, 48),
          lat: Number(clampLat(rawLat, 86).toFixed(4)),
          lon: Number(normalizeLon(rawLon).toFixed(4)),
          spanDeg: Number(clampSpan(body.spanDeg || 2.5).toFixed(2)),
          diameterKm: 0,
          source: 'custom',
          createdAt: new Date().toISOString(),
        };

        const list = await readCustomLocations();
        list.unshift(entry);
        await writeCustomLocations(list);
        sendJson(res, 201, { location: entry, custom: list });
        return;
      }

      if (pathname.startsWith('/api/locations/') && req.method === 'DELETE') {
        const id = pathname.slice('/api/locations/'.length);
        const list = await readCustomLocations();
        const next = list.filter((item) => item.id !== id);
        if (next.length === list.length) {
          sendJson(res, 404, { error: 'Custom location not found' });
          return;
        }
        await writeCustomLocations(next);
        sendJson(res, 200, { deleted: id, custom: next });
        return;
      }

      // 3. Terrain metadata + nearby features + cached DEM/texture URLs
      if (pathname === '/api/terrain' && req.method === 'GET') {
        const lat = Number(url.searchParams.get('lat') ?? 18.65);
        const lon = Number(url.searchParams.get('lon') ?? -133.8);
        const span = Number(url.searchParams.get('span') ?? 4);
        const layerKey = url.searchParams.get('layer') || 'viking';
        const gridSize = Math.min(385, Math.max(65, Number(url.searchParams.get('grid') || 257)));

        if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
          sendJson(res, 400, { error: 'Valid numeric lat and lon query params are required' });
          return;
        }

        const bounds = computeTerrainBounds(lat, lon, span);
        const layer = TEXTURE_LAYERS[layerKey] || TEXTURE_LAYERS.viking;

        // Warm both DEM and texture into disk cache in parallel
        const [demRes, texRes, official, custom] = await Promise.all([
          ensureDemCached(bounds, gridSize),
          ensureTextureCached(bounds, layer.id, 1024),
          ensureOfficialCatalog(),
          readCustomLocations(),
        ]);

        const inBounds = (item) =>
          item.lon >= bounds.west &&
          item.lon <= bounds.east &&
          item.lat >= bounds.south &&
          item.lat <= bounds.north;

        const nearbyCustom = custom.filter(inBounds);
        const nearbyOfficial = official.filter(inBounds).slice(0, 18);

        const qCommon = new URLSearchParams({
          lat: String(bounds.centerLat),
          lon: String(bounds.centerLon),
          span: String(bounds.spanDeg),
        });

        sendJson(res, 200, {
          key: demRes.key,
          center: { lat: bounds.centerLat, lon: bounds.centerLon },
          bounds,
          spanDeg: bounds.spanDeg,
          gridSize: demRes.meta.width,
          elevation: {
            minElevM: demRes.meta.minElevM,
            maxElevM: demRes.meta.maxElevM,
            meanElevM: demRes.meta.meanElevM,
            reliefM: demRes.meta.reliefM,
            source: demRes.meta.source,
            cached: demRes.cached,
          },
          texture: {
            layer: layer.id,
            layerName: layer.name,
            cached: texRes.cached,
          },
          demUrl: `/api/terrain/dem?${qCommon}&grid=${gridSize}`,
          textureUrl: `/api/terrain/texture?${qCommon}&layer=${layer.id}`,
          nearbyFeatures: [...nearbyCustom, ...nearbyOfficial],
        });
        return;
      }

      // 4. Raw Int16Array binary DEM raster (little-endian metres, width * height * 2 bytes)
      if (pathname === '/api/terrain/dem' && req.method === 'GET') {
        const lat = Number(url.searchParams.get('lat') ?? 18.65);
        const lon = Number(url.searchParams.get('lon') ?? -133.8);
        const span = Number(url.searchParams.get('span') ?? 4);
        const gridSize = Math.min(385, Math.max(65, Number(url.searchParams.get('grid') || 257)));
        const bounds = computeTerrainBounds(lat, lon, span);
        const { bin, meta, cached } = await ensureDemCached(bounds, gridSize);

        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': bin.byteLength,
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Expose-Headers': 'X-DEM-Width, X-DEM-Height, X-Cache',
          'X-DEM-Width': String(meta.width),
          'X-DEM-Height': String(meta.height),
          'X-Cache': cached ? 'HIT' : 'MISS',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(bin);
        return;
      }

      // 5. Satellite / topographic JPEG texture for the exact same BBOX
      if (pathname === '/api/terrain/texture' && req.method === 'GET') {
        const lat = Number(url.searchParams.get('lat') ?? 18.65);
        const lon = Number(url.searchParams.get('lon') ?? -133.8);
        const span = Number(url.searchParams.get('span') ?? 4);
        const layerKey = url.searchParams.get('layer') || 'viking';
        const bounds = computeTerrainBounds(lat, lon, span);
        const { buf, cached, contentType } = await ensureTextureCached(bounds, layerKey, 1024);

        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': buf.byteLength,
          'Access-Control-Allow-Origin': '*',
          'X-Cache': cached ? 'HIT' : 'MISS',
          'Cache-Control': 'public, max-age=86400',
        });
        res.end(buf);
        return;
      }

      // 6. Static frontend files from public/
      let filePath = path.resolve(PUBLIC_DIR, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
        res.writeHead(403).end('Forbidden');
        return;
      }
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const data = await fs.readFile(filePath);
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(data);
    } catch (err) {
      console.error('[terrain-lab] Request error:', err);
      sendJson(res, 502, { error: err.message || 'Upstream Mars API failure' });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createTerrainServer();
  server.listen(PORT, HOST, () => {
    console.log(`ARES 3D Terrain Lab: http://${HOST}:${PORT} (linked Atlas: ${ATLAS_URL})`);
    ensureOfficialCatalog()
      .then((items) => console.log(`[terrain-lab] Mars nomenclature ready (${items.length} named features)`))
      .catch(() => {});
  });
}
