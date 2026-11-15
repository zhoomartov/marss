import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { terrain, graph, metrics, coordinates, plan, planRoute } from './dist/rover-core.js';

const dem = JSON.parse(fs.readFileSync(new URL('./dist/data/jezero-dem.json', import.meta.url)));
const terrainGrid = terrain(dem, dem.routeFactor || 2);
const a = dem.anchors.start, b = dem.anchors.goal;
const mid = f => ({ lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f });
const waypoints = [a, mid(0.33), mid(0.66), b];

test('multi-stop mission sums per-leg metrics and verifies every leg', () => {
  const r = planRoute(terrainGrid, waypoints, {});
  assert.equal(r.status, 'optimal');
  assert.equal(r.legs.length, 3);
  assert.equal(r.stopsCount, 3);
  assert.equal(r.verification.perLeg.length, 3);
  assert.ok(r.verification.delta < 1e-7);

  const sum = key => r.legs.reduce((s, leg) => s + leg.metrics[key], 0);
  for (const key of ['oneWayKm', 'energy', 'hours', 'doseUsv']) {
    assert.ok(Math.abs(sum(key) - r.metrics[key]) < 1e-9, `${key} legs must sum to mission total`);
  }
  assert.equal(r.profile.length, r.path.length);
  assert.equal(r.waypointDistancesKm.length, waypoints.length);
  assert.equal(r.waypointDistancesKm[0], 0);
  assert.ok(Math.abs(r.waypointDistancesKm.at(-1) - r.metrics.oneWayKm) < 1e-9);
  for (let i = 1; i < r.waypointDistancesKm.length; i++) {
    assert.ok(r.waypointDistancesKm[i] > r.waypointDistancesKm[i - 1]);
  }
  assert.equal(r.alternatives.energy.status, 'optimal');
  assert.ok(r.direct.path.length > 1);
});

test('two-waypoint missions delegate byte-for-byte to the verified single-leg planner', () => {
  const single = plan(terrainGrid, a, b, {});
  const chain = planRoute(terrainGrid, [a, b], {});
  assert.equal(chain.status, single.status);
  assert.deepEqual(chain.path, single.path);
  assert.deepEqual(chain.metrics, single.metrics);
  assert.equal(chain.legs.length, 1);
  assert.deepEqual(chain.legs[0].metrics, single.metrics);
  assert.deepEqual(chain.snapMetres, [single.snapMetres.start, single.snapMetres.goal]);
  assert.deepEqual(chain.waypoints, [{ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon }]);
});

test('intermediate waypoint on blocked terrain is reported by index', () => {
  const g = graph(terrainGrid);
  const blockedNode = g.blocked.findIndex(v => v);
  const bad = coordinates(dem, blockedNode % dem.width, Math.floor(blockedNode / dem.width));
  const r = planRoute(terrainGrid, [a, bad, b], {});
  assert.equal(r.status, 'blocked-endpoint');
  assert.equal(r.blockedWaypoint, 1);
  assert.equal(r.legs.length, 0);
  assert.match(r.reason, /stop 1/);
});

test('mission whose surface stops exceed the energy budget is infeasible with no legs', () => {
  const r = planRoute(terrainGrid, waypoints, { batteryKwh: 2 });
  assert.equal(r.status, 'infeasible');
  assert.equal(r.legs.length, 0);
  assert.match(r.reason, /surface stops/);
});

test('metrics accounts one surface stop per waypoint by default and on request', () => {
  const g = graph(terrainGrid);
  let i0 = 0;
  for (let i = 0; i + 1 < g.blocked.length; i++) {
    if (!g.blocked[i] && !g.blocked[i + 1] && i % g.t.width !== g.t.width - 1) { i0 = i; break; }
  }
  const single = metrics(g, [i0, i0 + 1]);
  const twoStops = metrics(g, [i0, i0 + 1], [i0, i0 + 1]);
  assert.equal(twoStops.stops, 2);
  assert.ok(Math.abs((twoStops.hours - single.hours) - g.p.stopHours) < 1e-12);
  assert.ok(Math.abs((twoStops.hotel - single.hotel) - g.stopEnergy) < 1e-12);
  assert.equal(single.stops, 1);
  assert.deepEqual(single, metrics(g, [i0, i0 + 1], [i0 + 1]));
});
