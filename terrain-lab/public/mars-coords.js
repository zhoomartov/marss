// Shared Mars coordinate, tile, DEM geometry, and elevation profile utilities.
// Pure ES module (runs in Node.js, Web Workers, and browsers).

export const MARS_EQUATORIAL_RADIUS_KM = 3396.19;
export const MARS_MEAN_RADIUS_KM = 3389.5;
export const DEM_NODATA_THRESHOLD = -30000;

/**
 * Normalizes any longitude (including 0..360 East such as 226.2) into [-180, 180].
 */
export function normalizeLon(lon) {
  const n = Number(lon);
  if (!Number.isFinite(n)) return 0;
  const wrapped = ((((n + 180) % 360) + 360) % 360) - 180;
  return wrapped === -180 && n > 0 ? 180 : wrapped;
}

/**
 * Clamps planetocentric latitude to safe equirectangular bounds.
 */
export function clampLat(lat, maxAbs = 86) {
  const n = Number(lat);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-maxAbs, Math.min(maxAbs, n));
}

/**
 * Clamps requested angular span (degrees) to sensible 3D patch bounds.
 */
export function clampSpan(spanDeg) {
  const n = Number(spanDeg);
  if (!Number.isFinite(n)) return 3;
  return Math.max(0.25, Math.min(20, n));
}

/**
 * Computes a shared [west, south, east, north] bounding box strictly inside [-180, 180] x [-87, 87]
 * so texture imagery and DEM elevation rasters align pixel-for-pixel.
 */
export function computeTerrainBounds(lat, lon, spanDeg = 3) {
  const span = clampSpan(spanDeg);
  const half = span / 2;
  const cLat = clampLat(lat, 87 - half);
  let cLon = normalizeLon(lon);

  let west = cLon - half;
  let east = cLon + half;
  if (west < -180) {
    east += -180 - west;
    west = -180;
  } else if (east > 180) {
    west -= east - 180;
    east = 180;
  }
  cLon = (west + east) / 2;

  const south = Math.max(-87, cLat - half);
  const north = Math.min(87, cLat + half);

  return {
    centerLat: Number(((south + north) / 2).toFixed(5)),
    centerLon: Number(cLon.toFixed(5)),
    spanDeg: Number(span.toFixed(4)),
    west: Number(west.toFixed(5)),
    south: Number(south.toFixed(5)),
    east: Number(east.toFixed(5)),
    north: Number(north.toFixed(5)),
  };
}

/**
 * Converts Mars (lat, lon) into NASA Mars Trek OGC WMTS tile indices { zoom, x, y, bounds }.
 * Note: WMTS REST URLs place row (y) BEFORE col (x): /{zoom}/{y}/{x}.jpg
 */
export function latLonToMarsTile(lat, lon, zoom = 5) {
  const z = Math.max(0, Math.min(7, Math.floor(Number(zoom) || 0)));
  const normLon = normalizeLon(lon);
  const clampedLat = clampLat(lat, 89.9999);

  const numCols = 2 ** (z + 1);
  const numRows = 2 ** z;

  const x = Math.min(numCols - 1, Math.max(0, Math.floor(((normLon + 180) / 360) * numCols)));
  const y = Math.min(numRows - 1, Math.max(0, Math.floor(((90 - clampedLat) / 180) * numRows)));

  const west = -180 + (x * 360) / numCols;
  const east = -180 + ((x + 1) * 360) / numCols;
  const north = 90 - (y * 180) / numRows;
  const south = 90 - ((y + 1) * 180) / numRows;

  return { zoom: z, x, y, numCols, numRows, bounds: { west, south, east, north } };
}

export function getMarsTrekTileUrl(lat, lon, zoom = 5, layer = 'Mars_Viking_MDIM21_ClrMosaic_global_232m') {
  const { zoom: z, x, y } = latLonToMarsTile(lat, lon, zoom);
  return `https://trek.nasa.gov/tiles/Mars/EQ/${layer}/1.0.0/default/default028mm/${z}/${y}/${x}.jpg`;
}

/**
 * 2D Equirectangular Canvas <-> Mars (lat, lon) conversions.
 */
export function canvasPointToLatLon(x, y, canvasWidth, canvasHeight) {
  const lon = (x / canvasWidth) * 360 - 180;
  const lat = 90 - (y / canvasHeight) * 180;
  return {
    lat: Number(clampLat(lat, 86).toFixed(4)),
    lon: Number(normalizeLon(lon).toFixed(4)),
  };
}

export function latLonToCanvasPoint(lat, lon, canvasWidth, canvasHeight) {
  const normLon = normalizeLon(lon);
  const x = ((normLon + 180) / 360) * canvasWidth;
  const y = ((90 - clampLat(lat, 90)) / 180) * canvasHeight;
  return { x, y };
}

/**
 * Cleans raw DEM samples (replaces nodata spikes with nearest valid neighbor or mean).
 */
export function sanitizeElevations(raw, width, height) {
  const out = new Float32Array(width * height);
  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < out.length; i++) {
    const v = raw[i];
    if (Number.isFinite(v) && v > DEM_NODATA_THRESHOLD && v < 30000) {
      out[i] = v;
      sum += v;
      validCount++;
    } else {
      out[i] = NaN;
    }
  }
  const fallback = validCount > 0 ? sum / validCount : 0;
  if (validCount < out.length) {
    let last = fallback;
    for (let i = 0; i < out.length; i++) {
      if (Number.isNaN(out[i])) out[i] = last;
      else last = out[i];
    }
  }
  return out;
}

/**
 * Projects named catalog features onto the generated mesh and samples their DEM elevation.
 */
export function sampleFeatureElevations(features, clean, width, height, bounds, stats) {
  if (!Array.isArray(features) || !features.length) return [];
  const segX = Math.max(1, width - 1);
  const segY = Math.max(1, height - 1);
  const out = [];

  for (const f of features) {
    const u = (f.lon - bounds.west) / Math.max(1e-6, bounds.east - bounds.west);
    const v = (bounds.north - f.lat) / Math.max(1e-6, bounds.north - bounds.south);
    if (u < 0 || u > 1 || v < 0 || v > 1) continue;

    const c = Math.min(segX, Math.max(0, Math.round(u * segX)));
    const r = Math.min(segY, Math.max(0, Math.round(v * segY)));
    const elevM = clean[r * width + c];

    out.push({
      ...f,
      elevM: Math.round(elevM),
      worldX: -stats.meshWidth / 2 + u * stats.meshWidth,
      worldZ: -stats.meshDepth / 2 + v * stats.meshDepth,
      worldY: (elevM - stats.minElevM) * stats.elevScale,
    });
  }
  return out;
}

/**
 * Builds 3D Three.js BufferGeometry typed arrays + physical slope statistics + SVG cross-section profile.
 * Designed to run inside a Web Worker with Transferable ArrayBuffers.
 */
export function buildTerrainGeometryData({
  elevations,
  width,
  height,
  bounds,
  verticalExaggeration = 4,
  profileMode = 'ew', // 'ew' (West->East center), 'ns' (North->South center), 'diag' (SW->NE)
  worldSize = 120,
}) {
  const clean = elevations instanceof Float32Array ? elevations : sanitizeElevations(elevations, width, height);
  const count = width * height;

  let minElevM = Infinity;
  let maxElevM = -Infinity;
  let sumElevM = 0;
  for (let i = 0; i < count; i++) {
    const v = clean[i];
    if (v < minElevM) minElevM = v;
    if (v > maxElevM) maxElevM = v;
    sumElevM += v;
  }
  if (!Number.isFinite(minElevM)) minElevM = maxElevM = 0;
  const meanElevM = count ? sumElevM / count : 0;
  const reliefM = maxElevM - minElevM;

  const degToRad = Math.PI / 180;
  const midLatRad = ((bounds.south + bounds.north) / 2) * degToRad;
  const cosLat = Math.max(0.08, Math.cos(midLatRad));
  const widthKm = Math.max(0.1, (bounds.east - bounds.west) * degToRad * MARS_EQUATORIAL_RADIUS_KM * cosLat);
  const depthKm = Math.max(0.1, (bounds.north - bounds.south) * degToRad * MARS_EQUATORIAL_RADIUS_KM);

  const maxSpanKm = Math.max(widthKm, depthKm);
  const unitsPerKm = worldSize / maxSpanKm;
  const meshWidth = widthKm * unitsPerKm;
  const meshDepth = depthKm * unitsPerKm;

  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  const segX = width - 1;
  const segY = height - 1;
  const dxScene = meshWidth / Math.max(1, segX);
  const dzScene = meshDepth / Math.max(1, segY);
  const dxMeters = (widthKm * 1000) / Math.max(1, segX);
  const dzMeters = (depthKm * 1000) / Math.max(1, segY);
  const elevScale = (unitsPerKm / 1000) * verticalExaggeration;

  for (let r = 0; r < height; r++) {
    const vRatio = r / Math.max(1, segY);
    const z = -meshDepth / 2 + vRatio * meshDepth;
    const uvY = 1 - vRatio;
    for (let c = 0; c < width; c++) {
      const uRatio = c / Math.max(1, segX);
      const x = -meshWidth / 2 + uRatio * meshWidth;
      const idx = r * width + c;
      const y = (clean[idx] - minElevM) * elevScale;

      const p3 = idx * 3;
      positions[p3] = x;
      positions[p3 + 1] = y;
      positions[p3 + 2] = z;

      const p2 = idx * 2;
      uvs[p2] = uRatio;
      uvs[p2 + 1] = uvY;
    }
  }

  let maxSlopeDeg = 0;
  let sumSlopeDeg = 0;

  for (let r = 0; r < height; r++) {
    const rPrev = Math.max(0, r - 1);
    const rNext = Math.min(height - 1, r + 1);
    const spanZ = (rNext - rPrev) || 1;

    for (let c = 0; c < width; c++) {
      const cPrev = Math.max(0, c - 1);
      const cNext = Math.min(width - 1, c + 1);
      const spanX = (cNext - cPrev) || 1;
      const idx = r * width + c;

      const hL = clean[r * width + cPrev];
      const hR = clean[r * width + cNext];
      const hN = clean[rPrev * width + c];
      const hS = clean[rNext * width + c];

      const dhdxPhys = (hR - hL) / (spanX * dxMeters);
      const dhdzPhys = (hS - hN) / (spanZ * dzMeters);
      const slopeDeg = Math.atan(Math.hypot(dhdxPhys, dhdzPhys)) * (180 / Math.PI);
      if (slopeDeg > maxSlopeDeg) maxSlopeDeg = slopeDeg;
      sumSlopeDeg += slopeDeg;

      const yL = positions[(r * width + cPrev) * 3 + 1];
      const yR = positions[(r * width + cNext) * 3 + 1];
      const yN = positions[(rPrev * width + c) * 3 + 1];
      const yS = positions[(rNext * width + c) * 3 + 1];

      const dydx = (yR - yL) / (spanX * dxScene);
      const dydz = (yS - yN) / (spanZ * dzScene);

      const nx = -dydx;
      const ny = 1;
      const nz = -dydz;
      const len = Math.hypot(nx, ny, nz) || 1;

      const p3 = idx * 3;
      normals[p3] = nx / len;
      normals[p3 + 1] = ny / len;
      normals[p3 + 2] = nz / len;
    }
  }

  const quadCount = segX * segY;
  const indices = new Uint32Array(quadCount * 6);
  let ptr = 0;
  for (let r = 0; r < segY; r++) {
    for (let c = 0; c < segX; c++) {
      const a = r * width + c;
      const b = a + 1;
      const d = (r + 1) * width + c;
      const e = d + 1;
      indices[ptr++] = a;
      indices[ptr++] = d;
      indices[ptr++] = b;
      indices[ptr++] = b;
      indices[ptr++] = d;
      indices[ptr++] = e;
    }
  }

  // Build elevation cross-section profile + 3D world coordinates along slice
  const profileSamples = profileMode === 'ns' ? height : width;
  const profile = [];
  let totalDistKm = widthKm;
  if (profileMode === 'ns') totalDistKm = depthKm;
  else if (profileMode === 'diag') totalDistKm = Math.hypot(widthKm, depthKm);

  for (let s = 0; s < profileSamples; s++) {
    const t = s / Math.max(1, profileSamples - 1);
    let r;
    let c;
    if (profileMode === 'ns') {
      r = s;
      c = Math.floor(segX / 2);
    } else if (profileMode === 'diag') {
      r = Math.round((1 - t) * segY); // SW -> NE
      c = Math.round(t * segX);
    } else {
      r = Math.floor(segY / 2);
      c = s;
    }
    const idx = r * width + c;
    const p3 = idx * 3;
    const elevM = clean[idx];
    const lat = bounds.north - (r / Math.max(1, segY)) * (bounds.north - bounds.south);
    const lon = bounds.west + (c / Math.max(1, segX)) * (bounds.east - bounds.west);
    const distKm = t * totalDistKm;

    let stepSlopeDeg = 0;
    if (s > 0) {
      const prev = profile[s - 1];
      const dMeters = (distKm - prev.distKm) * 1000;
      if (dMeters > 0) {
        stepSlopeDeg = Math.atan(Math.abs(elevM - prev.elevM) / dMeters) * (180 / Math.PI);
      }
    }

    profile.push({
      distKm: Number(distKm.toFixed(2)),
      elevM: Math.round(elevM),
      slopeDeg: Number(stepSlopeDeg.toFixed(1)),
      lat: Number(lat.toFixed(4)),
      lon: Number(lon.toFixed(4)),
      worldX: positions[p3],
      worldY: positions[p3 + 1],
      worldZ: positions[p3 + 2],
    });
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    profile,
    stats: {
      width,
      height,
      minElevM: Math.round(minElevM),
      maxElevM: Math.round(maxElevM),
      meanElevM: Math.round(meanElevM),
      reliefM: Math.round(reliefM),
      meanSlopeDeg: Number((sumSlopeDeg / count).toFixed(2)),
      maxSlopeDeg: Number(maxSlopeDeg.toFixed(2)),
      widthKm: Number(widthKm.toFixed(1)),
      depthKm: Number(depthKm.toFixed(1)),
      meshWidth,
      meshDepth,
      unitsPerKm,
      elevScale,
    },
  };
}
