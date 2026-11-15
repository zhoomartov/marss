import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PRESETS, SOLAR_SCENARIOS, parameters, terrain, graph, cellDoseRateUsvH, weatherFactors, plan } from './dist/rover-core.js';

const regions = JSON.parse(fs.readFileSync(new URL('./dist/data/mission-regions.json', import.meta.url)));
const realDelta = JSON.parse(fs.readFileSync(new URL('./dist/' + regions.find(r => r.id === 'jezero-delta').dem, import.meta.url)));

function syntheticBasin(n = 16) {
  const values = Array(n * n).fill(-2500);
  // Create a steep rough ridge down the middle (x = 7, 8) with a gentle safe pass near y = 2
  for (let y = 0; y < n; y++) {
    if (y >= 4) {
      values[y * n + 7] = -2492 + (y % 2 ? 1.8 : -1.8);
      values[y * n + 8] = -2491 + (y % 2 ? -1.6 : 1.6);
    }
  }
  return {
    width: n, height: n, dx: 20, dy: -20, x0: 0, y0: n * 20,
    projection: { radius: 3396190, standardParallel: 18.4663, centralLongitude: 77.45 },
    values
  };
}

test('topographic sky-view and atmospheric column attenuate radiation realistically', () => {
  const d = syntheticBasin(16);
  // Carve a deep sheltered canyon at (4,4) surrounded by higher walls
  for (let yy = 2; yy <= 6; yy++) for (let xx = 2; xx <= 6; xx++) d.values[yy * 16 + xx] = -2440;
  d.values[4 * 16 + 4] = -2560;
  const t = terrain(d, 1);
  const canyonIdx = 4 * 16 + 4, plainIdx = 12 * 16 + 2;
  assert.ok(t.skyView[canyonIdx] < t.skyView[plainIdx], 'canyon floor has lower sky-view factor than open plain');

  const pQuiet = parameters({ ...SOLAR_SCENARIOS.quiet, shieldingGcm2: 2 });
  const pStorm = parameters({ ...SOLAR_SCENARIOS.spe, shieldingGcm2: 2 });
  const pHeavyShield = parameters({ ...SOLAR_SCENARIOS.spe, shieldingGcm2: 25 });

  assert.ok(cellDoseRateUsvH(t, pQuiet, canyonIdx) < cellDoseRateUsvH(t, pQuiet, plainIdx));
  assert.ok(cellDoseRateUsvH(t, pStorm, plainIdx) > cellDoseRateUsvH(t, pQuiet, plainIdx) * 3);
  assert.ok(cellDoseRateUsvH(t, pHeavyShield, plainIdx) < cellDoseRateUsvH(t, pStorm, plainIdx) * 0.35);
});

test('weather model penalizes dust, wind, and night operations and blocks beyond abort limits', () => {
  const clearDay = weatherFactors(parameters({ dustTau: 0.3, windMs: 4, solarHour: 14 }));
  const dustyNight = weatherFactors(parameters({ dustTau: 1.8, windMs: 24, solarHour: 2, nightPenalty: 0.5 }));
  assert.ok(dustyNight.speedFactor < clearDay.speedFactor);
  assert.ok(dustyNight.visibilityKm < clearDay.visibilityKm);
  assert.ok(dustyNight.weatherHazard > clearDay.weatherHazard);

  const t = terrain(syntheticBasin(12), 1);
  const stormGraph = graph(t, { weatherEffects: true, dustTau: 3.2, maxDustTau: 2.5 });
  assert.equal(stormGraph.blocked[5 * 12 + 5], 1);
});

test('safest objective detours around rough steep ridge while shortest cuts closer, with Dijkstra verification', () => {
  const t = terrain(syntheticBasin(16), 1);
  const start = t.coords[10 * 16 + 3], goal = t.coords[10 * 16 + 12];
  const safeRes = plan(t, start, goal, {
    ...PRESETS['crewed-rover'].values,
    maxSlopeDeg: 32,
    maxRoughnessM: 10,
    objective: 'safest',
    wSlope: 2.5,
    wRoughness: 2.5
  });
  const distRes = plan(t, start, goal, {
    ...PRESETS['crewed-rover'].values,
    maxSlopeDeg: 32,
    maxRoughnessM: 10,
    objective: 'distance',
    wSlope: 2.5,
    wRoughness: 2.5
  });
  assert.equal(safeRes.status, 'optimal');
  assert.equal(distRes.status, 'optimal');
  assert.ok(safeRes.verification.delta < 1e-7);
  assert.ok(safeRes.metrics.risk <= distRes.metrics.risk + 1e-9);
  assert.ok(safeRes.metrics.maxSlopeDeg <= distRes.metrics.maxSlopeDeg + 1e-9);
  assert.ok(safeRes.metrics.safetyScore >= distRes.metrics.safetyScore - 1e-9);
});

test('enforceDose triggers constrained Pareto search or infeasibility under Solar Particle Event', () => {
  const t = terrain(realDelta, realDelta.routeFactor);
  const stormTight = plan(t, realDelta.anchors.start, realDelta.anchors.goal, {
    ...PRESETS['foot-eva'].values,
    ...SOLAR_SCENARIOS.spe,
    maxDoseUsv: 5,
    enforceDose: true
  });
  assert.equal(stormTight.status, 'infeasible');

  const stormShielded = plan(t, realDelta.anchors.start, realDelta.anchors.goal, {
    ...PRESETS['pressurized-rover'].values,
    ...SOLAR_SCENARIOS.spe,
    maxDoseUsv: 800,
    enforceDose: true,
    objective: 'safest'
  });
  assert.equal(stormShielded.status, 'optimal');
  assert.ok(stormShielded.metrics.doseUsv <= 800);
  assert.ok(stormShielded.alternatives.safest.path.length > 2);
});
