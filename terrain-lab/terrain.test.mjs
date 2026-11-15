import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeLon,
  computeTerrainBounds,
  canvasPointToLatLon,
  latLonToCanvasPoint,
  buildTerrainGeometryData,
  sampleFeatureElevations,
  sanitizeElevations,
  projectRouteOnTerrain,
  haversineKm,
} from './public/mars-coords.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('normalizeLon converts 0..360 east longitudes (e.g. Olympus Mons 226.2°E) to [-180, 180]', () => {
  assert.ok(Math.abs(normalizeLon(226.2) - -133.8) < 1e-9);
  assert.ok(Math.abs(normalizeLon(77.45) - 77.45) < 1e-9);
  assert.equal(normalizeLon(-180), -180);
  assert.ok(Math.abs(normalizeLon(360) - 0) < 1e-9);
});

test('2D equirectangular canvas <-> Mars geographic coordinates round-trip accurately', () => {
  const w = 720;
  const h = 360;
  for (const sample of [
    { lat: 18.65, lon: -133.8 },
    { lat: 18.44, lon: 77.45 },
    { lat: -42.4, lon: 70.5 },
    { lat: 0, lon: 0 },
  ]) {
    const px = latLonToCanvasPoint(sample.lat, sample.lon, w, h);
    const back = canvasPointToLatLon(px.x, px.y, w, h);
    assert.ok(Math.abs(back.lat - sample.lat) < 0.05);
    assert.ok(Math.abs(back.lon - sample.lon) < 0.05);
  }
});

test('computeTerrainBounds keeps identical valid BBOX for DEM and texture near borders', () => {
  const nearWestEdge = computeTerrainBounds(10, -179, 6);
  assert.equal(nearWestEdge.west, -180);
  assert.equal(nearWestEdge.east, -174);
  assert.equal(nearWestEdge.south, 7);
  assert.equal(nearWestEdge.north, 13);

  const nearNorthPole = computeTerrainBounds(86, 40, 8);
  assert.ok(nearNorthPole.north <= 88);
  assert.ok(nearNorthPole.north > nearNorthPole.south);
});

test('buildTerrainGeometryData generates valid 3D mesh, cos(lat) aspect ratio, normals, and SVG slices', () => {
  const width = 33;
  const height = 33;
  const elevations = new Int16Array(width * height);
  // Synthetic conical volcano peaking at center (~21,000 m) over -1,000 m plain
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const dist = Math.hypot(c - 16, r - 16);
      elevations[r * width + c] = Math.round(Math.max(-1000, 21000 - dist * 1600));
    }
  }

  const bounds = computeTerrainBounds(60, 20, 4); // At 60°N, cos(60°) = 0.5 -> widthKm ~ 0.5 * depthKm
  const clean = sanitizeElevations(elevations, width, height);
  const res = buildTerrainGeometryData({
    elevations: clean,
    width,
    height,
    bounds,
    verticalExaggeration: 4,
    profileMode: 'ew',
  });

  assert.equal(res.positions.length, width * height * 3);
  assert.equal(res.normals.length, width * height * 3);
  assert.equal(res.uvs.length, width * height * 2);
  assert.equal(res.indices.length, (width - 1) * (height - 1) * 6);
  assert.equal(res.stats.minElevM, -1000);
  assert.equal(res.stats.maxElevM, 21000);
  assert.equal(res.stats.reliefM, 22000);
  // Verify cos(60°) parallel compression (~0.5 ratio)
  assert.ok(Math.abs(res.stats.widthKm / res.stats.depthKm - 0.5) < 0.03);
  assert.ok(res.profile.length > 30);

  // Unit normals must be finite and point mostly up
  for (let i = 0; i < res.normals.length; i += 3) {
    const len = Math.hypot(res.normals[i], res.normals[i + 1], res.normals[i + 2]);
    assert.ok(Math.abs(len - 1) < 1e-5);
    assert.ok(res.normals[i + 1] > 0.5);
  }

  const pins = sampleFeatureElevations(
    [{ id: 'summit', name: 'Summit', type: 'Mons', lat: bounds.centerLat, lon: bounds.centerLon, source: 'custom' }],
    clean,
    width,
    height,
    bounds,
    res.stats
  );
  assert.equal(pins.length, 1);
  assert.equal(pins[0].elevM, 21000);
});

test('REST API server serves locations CRUD, live/cached S16 DEM, and aligned satellite texture', async (t) => {
  const testPort = 4289;
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(testPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    proc.kill('SIGTERM');
  });

  // Wait for server readiness
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 15000);
    proc.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`127.0.0.1:${testPort}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });

  const base = `http://127.0.0.1:${testPort}`;

  // 1. Health check
  const health = await fetch(`${base}/api/health`).then((r) => r.json());
  assert.equal(health.status, 'ok');
  assert.ok(Array.isArray(health.layers) && health.layers.length >= 4);

  // 2. Locations GET + POST + DELETE
  const initLocs = await fetch(`${base}/api/locations`).then((r) => r.json());
  assert.ok(Array.isArray(initLocs.featured) && initLocs.featured.length >= 6);
  assert.ok(Array.isArray(initLocs.official) && initLocs.official.length >= 6);
  assert.equal(typeof initLocs.totalOfficial, 'number');

  const createRes = await fetch(`${base}/api/locations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Alpha Outpost',
      lat: 18.65,
      lon: 226.2, // 0..360 input must normalize to -133.8
      spanDeg: 4,
      type: 'Test Station',
    }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  try {
    assert.equal(created.location.name, 'Test Alpha Outpost');
    assert.ok(Math.abs(created.location.lon - -133.8) < 1e-6);

    const delRes = await fetch(`${base}/api/locations/${encodeURIComponent(created.location.id)}`, {
      method: 'DELETE',
    });
    assert.equal(delRes.status, 200);
    const deleted = await delRes.json();
    assert.equal(deleted.deleted, created.location.id);
  } finally {
    await fetch(`${base}/api/locations/${encodeURIComponent(created.location.id)}`, {
      method: 'DELETE',
    }).catch(() => {});
  }

  // 3. Terrain DEM + Texture on Olympus Mons (18.65°N, -133.8°E)
  const meta1 = await fetch(
    `${base}/api/terrain?lat=18.65&lon=-133.8&span=10&grid=65&layer=viking`
  ).then((r) => r.json());

  assert.equal(meta1.gridSize, 65);
  assert.ok(meta1.elevation.maxElevM > 19000, `Expected Olympus Mons peak > 19km, got ${meta1.elevation.maxElevM}`);

  const demBuf = await fetch(`${base}${meta1.demUrl}`).then((r) => r.arrayBuffer());
  assert.equal(demBuf.byteLength, 65 * 65 * 2);
  const demSamples = new Int16Array(demBuf);
  assert.ok(Math.max(...demSamples) > 19000);

  const texRes = await fetch(`${base}${meta1.textureUrl}`);
  assert.equal(texRes.status, 200);
  const texBytes = new Uint8Array(await texRes.arrayBuffer());
  assert.ok(texBytes.byteLength > 1000, 'Expected non-empty satellite texture image');

  // 4. Second call must hit disk cache immediately
  const meta2 = await fetch(
    `${base}/api/terrain?lat=18.65&lon=-133.8&span=10&grid=65&layer=viking`
  ).then((r) => r.json());
  assert.equal(meta2.elevation.cached, true);
  assert.equal(meta2.texture.cached, true);
});

test('projectRouteOnTerrain drapes a GPS line onto the DEM and computes ascent/length', () => {
  const width = 33;
  const height = 33;
  const elevations = new Int16Array(width * height);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) elevations[r * width + c] = r * 200;
  }
  const bounds = { west: -2, east: 2, south: -2, north: 2, centerLat: 0, centerLon: 0 };
  const clean = sanitizeElevations(elevations, width, height);
  const mesh = buildTerrainGeometryData({
    elevations: clean,
    width,
    height,
    bounds,
    verticalExaggeration: 2,
    profileMode: 'ns',
  });

  const route = [
    { lat: -1.5, lon: 0 },
    { lat: 0, lon: 0 },
    { lat: 1.5, lon: 0 },
  ];
  const { points, stats } = projectRouteOnTerrain(route, clean, width, height, bounds, mesh.stats);

  assert.equal(points.length, 3);
  assert.ok(points.every((p) => Number.isFinite(p.elevM) && Number.isFinite(p.worldY)));
  assert.ok(points[0].elevM > points[2].elevM, 'south (high row) → north (low row) descends');
  assert.ok(stats.ascentM + stats.descentM > 0);
  assert.ok(stats.lengthKm > 100, `Expected Mars-scale distance, got ${stats.lengthKm}`);
  assert.ok(stats.maxSlopeDeg >= 0);
  assert.ok(points.every((p) => p.inside));

  const glab = haversineKm({ lat: 0, lon: 0 }, { lat: 0, lon: 90 });
  assert.ok(Math.abs(glab - (Math.PI / 2) * 3389.5) < 1);
});

test('REST API serves mission regions, region DEMs, GPX routes, and surface refresh', async (t) => {
  const testPort = 4291;
  const proc = spawn(process.execPath, ['server.mjs'], {
    cwd: __dirname,
    env: { ...process.env, PORT: String(testPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    proc.kill('SIGTERM');
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server start timeout')), 15000);
    proc.stdout.on('data', (chunk) => {
      if (String(chunk).includes(`127.0.0.1:${testPort}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    proc.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });

  const base = `http://127.0.0.1:${testPort}`;

  const regions = await fetch(`${base}/api/regions`).then((r) => r.json());
  assert.ok(Array.isArray(regions.regions) && regions.regions.length >= 1);
  const jezero = regions.regions.find((r) => r.id === 'jezero-delta');
  assert.ok(jezero, 'Expected jezero-delta mission region');
  assert.ok(jezero.bounds.west < jezero.bounds.east);
  assert.ok(jezero.demUrl.includes('/api/regions/'));

  const demRes = await fetch(`${base}${jezero.demUrl}`);
  assert.equal(demRes.status, 200);
  const gw = Number(demRes.headers.get('X-Grid-Width'));
  const gh = Number(demRes.headers.get('X-Grid-Height'));
  const demBuf = await demRes.arrayBuffer();
  assert.ok(gw > 0 && gh > 0);
  assert.equal(demBuf.byteLength, gw * gh * 4);

  const imgRes = await fetch(`${base}${jezero.surfaceUrl}`);
  assert.equal(imgRes.status, 200);
  assert.ok(Number(imgRes.headers.get('content-length') || 0) > 1000);

  const badRoute = await fetch(`${base}/api/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Broken', points: [{ lat: 0, lon: 0 }] }),
  });
  assert.equal(badRoute.status, 400);

  const createRes = await fetch(`${base}/api/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test GPS Route',
      source: 'unit-test',
      region: jezero.name,
      points: [
        { lat: 18.4, lon: 77.4, elevM: -2600 },
        { lat: 18.42, lon: 77.42, elevM: -2550 },
        { lat: 18.44, lon: 77.45, elevM: -2500 },
      ],
      direct: [
        { lat: 18.4, lon: 77.4 },
        { lat: 18.44, lon: 77.45 },
      ],
      metrics: { oneWayKm: 0.6, energy: 0.12, maxSlopeDeg: 4.2 },
    }),
  });
  assert.equal(createRes.status, 201);
  const created = await createRes.json();
  const route = created.route;

  try {
    assert.equal(route.name, 'Test GPS Route');
    assert.equal(route.pointCount, 3);
    assert.ok(route.center.lat > 18.4 && route.center.lat < 18.44);

    const fetched = await fetch(`${base}/api/routes/${encodeURIComponent(route.id)}`).then((r) => r.json());
    assert.equal(fetched.route.id, route.id);

    const gpxRes = await fetch(`${base}/api/routes/${encodeURIComponent(route.id)}/gpx`);
    assert.equal(gpxRes.status, 200);
    const gpx = await gpxRes.text();
    assert.ok(gpx.includes('<trkpt lat="18.4"'));
    assert.ok(gpx.includes('<ele>-2600</ele>'));

    const refreshRes = await fetch(`${base}/api/surface/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ region: 'jezero-delta' }),
    });
    assert.equal(refreshRes.status, 200);
    const refreshed = await refreshRes.json();
    assert.equal(typeof refreshed.removed, 'number');
  } finally {
    await fetch(`${base}/api/routes/${encodeURIComponent(route.id)}`, { method: 'DELETE' }).catch(() => {});
  }
});
