// Explicit engineering & multi-hazard safety model on measured NASA DEMs; not a certified flight-control system.
export const DEFAULTS = Object.freeze({
  massKg: 1200,
  speedKmh: 5,
  rolling: 0.08,
  efficiency: 0.65,
  hotelW: 600,
  thermalWPerK: 8,
  cabinC: 20,
  ambientC: -60,
  batteryKwh: 20,
  autonomyHours: 8,
  reservePercent: 30,
  stopHours: 0.5,
  maxSlopeDeg: 12,
  roundTrip: true,
  // Multi-hazard & environmental parameters (MCD 6.2 + MSL RAD anchored model)
  pressurePa: 720,
  windMs: 6,
  dustTau: 0.4,
  solarHour: 14,
  gcrBaseUsvH: 27.9,
  speUsvH: 0,
  shieldingGcm2: 8,
  maxDoseUsv: 500,
  maxRoughnessM: 3.5,
  maxWindMs: 35,
  maxDustTau: 2.5,
  maxShelterKm: 25,
  nightPenalty: 0.35,
  weatherEffects: false,
  enforceDose: false,
  enforceShelter: false,
  objective: 'energy',
  wSlope: 1,
  wRoughness: 0.8,
  wRadiation: 1,
  wWeather: 0.7,
  wThermal: 0.5,
  wShelter: 0.6
});

export const PRESETS = Object.freeze({
  'crewed-rover': {
    label: 'Unpressurized Crewed Rover',
    values: { massKg: 1200, speedKmh: 5, rolling: 0.08, efficiency: 0.65, hotelW: 600, thermalWPerK: 8, cabinC: 20, batteryKwh: 20, autonomyHours: 8, reservePercent: 30, stopHours: 0.5, maxSlopeDeg: 12, shieldingGcm2: 8, maxDoseUsv: 500, maxRoughnessM: 2.0, maxShelterKm: 15, weatherEffects: true, enforceDose: true, enforceShelter: true, objective: 'safest' }
  },
  'pressurized-rover': {
    label: 'Pressurized Long-Range Rover',
    values: { massKg: 4200, speedKmh: 8, rolling: 0.07, efficiency: 0.7, hotelW: 1400, thermalWPerK: 14, cabinC: 21, batteryKwh: 85, autonomyHours: 24, reservePercent: 25, stopHours: 1, maxSlopeDeg: 15, shieldingGcm2: 20, maxDoseUsv: 1200, maxRoughnessM: 3.0, maxShelterKm: 40, weatherEffects: true, enforceDose: true, enforceShelter: true, objective: 'balanced' }
  },
  'foot-eva': {
    label: 'Astronaut Foot EVA (Marswalk)',
    values: { massKg: 190, speedKmh: 2.8, rolling: 0.14, efficiency: 0.45, hotelW: 260, thermalWPerK: 3.5, cabinC: 24, batteryKwh: 3.2, autonomyHours: 6, reservePercent: 35, stopHours: 0.4, maxSlopeDeg: 18, shieldingGcm2: 1.5, maxDoseUsv: 250, maxRoughnessM: 1.2, maxShelterKm: 3, weatherEffects: true, enforceDose: true, enforceShelter: true, objective: 'safest' }
  },
  'scout-rover': {
    label: 'Robotic Scout Precursor',
    values: { massKg: 350, speedKmh: 4, rolling: 0.09, efficiency: 0.68, hotelW: 150, thermalWPerK: 2, cabinC: 0, batteryKwh: 8, autonomyHours: 14, reservePercent: 20, stopHours: 0.5, maxSlopeDeg: 20, shieldingGcm2: 4, maxDoseUsv: 5000, maxRoughnessM: 3.0, maxShelterKm: 50, weatherEffects: true, enforceDose: false, enforceShelter: false, objective: 'energy' }
  }
});

export const SOLAR_SCENARIOS = Object.freeze({
  quiet: { label: 'Solar quiet · GCR baseline (RAD ~28 µSv/h)', gcrBaseUsvH: 27.9, speUsvH: 0 },
  elevated: { label: 'Active sun · moderate SEP (+95 µSv/h unshielded)', gcrBaseUsvH: 30.5, speUsvH: 95 },
  spe: { label: 'Solar Particle Event · storm alert (+650 µSv/h unshielded)', gcrBaseUsvH: 32, speUsvH: 650 }
});

const RAD = Math.PI / 180, G = 3.71, SCALE_HEIGHT_M = 11100, REF_COLUMN_GCM2 = 20.5;
const OBJECTIVES = new Set(['energy', 'distance', 'fastest', 'safest', 'balanced']);

export function parameters(input = {}) {
  const p = { ...DEFAULTS, ...input };
  const ranges = {
    massKg: [1, 100000], speedKmh: [0.1, 30], rolling: [0.001, 0.5], efficiency: [0.01, 1],
    hotelW: [0, 100000], thermalWPerK: [0, 1000], cabinC: [-20, 40], ambientC: [-160, 40],
    batteryKwh: [0.01, 10000], autonomyHours: [0.01, 10000], reservePercent: [0, 99],
    stopHours: [0, 10000], maxSlopeDeg: [0.1, 35],
    pressurePa: [50, 2000], windMs: [0, 120], dustTau: [0, 8], solarHour: [0, 24],
    gcrBaseUsvH: [0, 5000], speUsvH: [0, 50000], shieldingGcm2: [0, 100],
    maxDoseUsv: [1, 100000], maxRoughnessM: [0.05, 50], maxWindMs: [1, 150],
    maxDustTau: [0.05, 10], maxShelterKm: [0.1, 1000], nightPenalty: [0, 3],
    wSlope: [0, 10], wRoughness: [0, 10], wRadiation: [0, 10], wWeather: [0, 10], wThermal: [0, 10], wShelter: [0, 10]
  };
  for (const [k, [lo, hi]] of Object.entries(ranges)) {
    if (!Number.isFinite(p[k]) || p[k] < lo || p[k] > hi) throw Error(`Invalid ${k}: expected ${lo}–${hi}`);
  }
  if (typeof p.roundTrip !== 'boolean') throw Error('Invalid return option');
  for (const b of ['weatherEffects', 'enforceDose', 'enforceShelter']) {
    if (typeof p[b] !== 'boolean') throw Error(`Invalid ${b} option`);
  }
  if (!OBJECTIVES.has(p.objective)) throw Error(`Invalid objective: ${p.objective}`);
  return p;
}

export function coordinates(d, x, y) {
  const p = d.projection;
  return {
    lon: p.centralLongitude + (d.x0 + x * d.dx) / (p.radius * Math.cos(p.standardParallel * RAD)) / RAD,
    lat: (d.y0 + y * d.dy) / p.radius / RAD
  };
}

export function gridPosition(d, p) {
  const r = d.projection;
  return {
    x: ((p.lon - r.centralLongitude) * RAD * r.radius * Math.cos(r.standardParallel * RAD) - d.x0) / d.dx,
    y: (p.lat * RAD * r.radius - d.y0) / d.dy
  };
}

export function metres(a, b, r) {
  const h = Math.sin((a.lat - b.lat) * RAD / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin((a.lon - b.lon) * RAD / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function validateDEM(d) {
  if (!Number.isInteger(d.width) || !Number.isInteger(d.height) || d.width < 3 || d.height < 3 || d.width * d.height > 2000000 || d.values?.length !== d.width * d.height) throw Error('Invalid numerical DEM grid');
  if (!(d.dx > 0 && d.dy < 0) || ![d.x0, d.y0, d.dx, d.dy, d.projection?.radius, d.projection?.standardParallel, d.projection?.centralLongitude].every(Number.isFinite) || d.projection.radius <= 0 || Math.abs(d.projection.standardParallel) >= 90) throw Error('Unsupported DEM georeferencing');
  if (d.values.some(v => v !== null && !Number.isFinite(v))) throw Error('Invalid DEM elevations');
  return d;
}

// Max native slope, sub-cell roughness (RMS local relief residual) and topographic sky-view factor.
export function terrain(d, factor = 2) {
  validateDEM(d);
  if (!Number.isInteger(factor) || factor < 1 || factor > 10) throw Error('Invalid aggregation');
  const native = new Float32Array(d.values.length).fill(NaN);
  const roughNative = new Float32Array(d.values.length).fill(NaN);
  const w = d.width, h = d.height;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, z = d.values[i];
    if (z === null) continue;
    const c = coordinates(d, x, y);
    const east = metres(c, coordinates(d, x + 1, y), d.projection.radius);
    const north = metres(c, coordinates(d, x, y + 1), d.projection.radius);
    let max = 0, valid = true, nMean = 0;
    for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
      if (!xx && !yy) continue;
      const v = d.values[i + yy * w + xx];
      if (v === null) { valid = false; continue; }
      nMean += v;
      max = Math.max(max, Math.abs(v - z) / Math.hypot(xx * east, yy * north));
    }
    if (valid) {
      const gx = (d.values[i + 1] - d.values[i - 1]) / (2 * east);
      const gy = (d.values[i + w] - d.values[i - w]) / (2 * north);
      native[i] = Math.atan(Math.max(max, Math.hypot(gx, gy))) / RAD;
      roughNative[i] = Math.abs(z - nMean / 8);
    }
  }
  const out = {
    width: Math.floor(w / factor), height: Math.floor(h / factor),
    dx: d.dx * factor, dy: d.dy * factor,
    x0: d.x0 + (factor - 1) * d.dx / 2, y0: d.y0 + (factor - 1) * d.dy / 2,
    projection: d.projection, provenance: d.provenance, factor
  };
  const len = out.width * out.height;
  out.values = new Float64Array(len).fill(NaN);
  out.slopes = new Float32Array(len).fill(NaN);
  out.roughness = new Float32Array(len).fill(NaN);
  out.skyView = new Float32Array(len).fill(1);
  out.coords = Array.from({ length: len }, (_, i) => coordinates(out, i % out.width, Math.floor(i / out.width)));
  let minZ = Infinity, maxZ = -Infinity;
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    let sum = 0, max = 0, rMax = 0, valid = true;
    const samples = [];
    for (let yy = 0; yy < factor; yy++) for (let xx = 0; xx < factor; xx++) {
      const i = (y * factor + yy) * w + x * factor + xx;
      if (d.values[i] === null || !Number.isFinite(native[i])) valid = false;
      else {
        sum += d.values[i];
        samples.push(d.values[i]);
        max = Math.max(max, native[i]);
        rMax = Math.max(rMax, roughNative[i] || 0);
      }
    }
    if (valid) {
      const idx = y * out.width + x, mean = sum / (factor * factor);
      out.values[idx] = mean;
      out.slopes[idx] = max;
      out.roughness[idx] = rMax;
      if (mean < minZ) minZ = mean;
      if (mean > maxZ) maxZ = mean;
    }
  }
  out.minElevationM = Number.isFinite(minZ) ? minZ : 0;
  out.maxElevationM = Number.isFinite(maxZ) ? maxZ : 0;
  out.meanElevationM = Number.isFinite(minZ) ? (minZ + maxZ) / 2 : 0;
  // Local horizon / sky-view factor across 8 azimuths up to 6 cells away (natural escarpment/crater-wall radiation shielding)
  const step = Math.abs(out.dx);
  const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const idx = y * out.width + x, z0 = out.values[idx];
    if (!Number.isFinite(z0)) continue;
    let horizonSum = 0;
    for (const [dx, dy] of dirs) {
      let maxAngle = 0;
      const unit = Math.hypot(dx, dy) * step;
      for (let k = 1; k <= 6; k++) {
        const nx = x + dx * k, ny = y + dy * k;
        if (nx < 0 || ny < 0 || nx >= out.width || ny >= out.height) break;
        const zn = out.values[ny * out.width + nx];
        if (Number.isFinite(zn) && zn > z0) maxAngle = Math.max(maxAngle, Math.atan2(zn - z0, unit * k));
      }
      horizonSum += Math.cos(maxAngle) ** 2;
    }
    const slopeFactor = (1 + Math.cos(out.slopes[idx] * RAD)) / 2;
    out.skyView[idx] = Math.max(0.55, Math.min(1, 0.5 * (horizonSum / dirs.length) + 0.5 * slopeFactor));
  }
  return out;
}

export function cellDoseRateUsvH(t, p, i) {
  const z = t.values[i];
  if (!Number.isFinite(z)) return NaN;
  const dz = z - (t.meanElevationM || 0);
  const localPressure = p.pressurePa * Math.exp(-dz / SCALE_HEIGHT_M);
  // 1 Pa / (3.71 m/s^2) = 0.2695 kg/m^2 = 0.02695 g/cm^2 atmospheric column
  const atmColumnGcm2 = (localPressure / G) * 0.1;
  const sky = t.skyView ? t.skyView[i] : 1;
  // GCR: slow exponential attenuation (lambda ~ 155 g/cm^2) scaled from RAD reference column
  const gcr = p.gcrBaseUsvH * Math.exp(-(atmColumnGcm2 - REF_COLUMN_GCM2) / 155) * Math.exp(-p.shieldingGcm2 / 85) * sky;
  // SPE protons: steep attenuation in CO2 atmosphere + rover/suit shielding (lambda ~ 28 g/cm^2)
  const spe = p.speUsvH * Math.exp(-atmColumnGcm2 / 32) * Math.exp(-p.shieldingGcm2 / 14) * sky;
  return Math.max(0, gcr + spe);
}

export function weatherFactors(p) {
  const isNight = p.solarHour < 6 || p.solarHour > 18.5;
  const lowSun = !isNight && (p.solarHour < 7.5 || p.solarHour > 17);
  const visFactor = Math.exp(-0.28 * Math.max(0, p.dustTau - 0.3)); // <= 1 when tau > 0.3
  const illumPenalty = isNight ? p.nightPenalty : lowSun ? p.nightPenalty * 0.4 : 0;
  const windPenalty = 0.18 * (p.windMs / Math.max(1, p.maxWindMs)) ** 2;
  const speedFactor = Math.max(0.25, visFactor / (1 + illumPenalty + windPenalty));
  const weatherHazard = Math.min(1, 0.45 * (p.dustTau / Math.max(0.1, p.maxDustTau)) + 0.35 * (p.windMs / Math.max(1, p.maxWindMs)) + (isNight ? 0.25 : lowSun ? 0.1 : 0));
  const visibilityKm = Math.max(0.15, 18 * Math.exp(-0.85 * p.dustTau) * (isNight ? 0.18 : 1));
  return { isNight, lowSun, speedFactor, weatherHazard, visibilityKm };
}

export function nodeAt(t, p) {
  const q = gridPosition(t, p), x = Math.round(q.x), y = Math.round(q.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= t.width || y >= t.height) {
    throw Error('Point outside the numerical DEM. Choose a location inside the mapped zone.');
  }
  return y * t.width + x;
}

export function graph(t, input = {}, exclusions = [], anchorNode = null) {
  const p = parameters(input), n = t.values.length;
  const blocked = new Uint8Array(n);
  const doseRate = new Float32Array(n);
  const cellHazard = new Float32Array(n);
  const wf = weatherFactors(p);
  const envBlocked = p.weatherEffects && (p.windMs > p.maxWindMs || p.dustTau > p.maxDustTau);
  const effSpeedKmh = p.weatherEffects ? p.speedKmh * wf.speedFactor : p.speedKmh;
  const thermalDeltaK = Math.max(0, p.cabinC - p.ambientC);
  const hotelW = p.hotelW + p.thermalWPerK * thermalDeltaK + (p.weatherEffects && p.windMs > 8 ? 0.6 * p.thermalWPerK * Math.sqrt(p.windMs - 8) * Math.max(0, thermalDeltaK / 40) : 0);
  const thermalNorm = Math.min(1, (p.thermalWPerK * thermalDeltaK) / Math.max(200, hotelW + 400));
  const refDose = Math.max(10, p.gcrBaseUsvH);
  let minDoseRate = Infinity;

  for (let i = 0; i < n; i++) {
    const rough = t.roughness ? t.roughness[i] : 0;
    const roughBlocked = p.weatherEffects && Number.isFinite(rough) && rough > p.maxRoughnessM;
    blocked[i] = envBlocked || !Number.isFinite(t.values[i]) || !Number.isFinite(t.slopes[i]) || t.slopes[i] > p.maxSlopeDeg || roughBlocked ? 1 : 0;
    for (const zone of exclusions) {
      if (!Number.isFinite(zone.lat) || !Number.isFinite(zone.lon) || !Number.isFinite(zone.radiusM) || zone.radiusM <= 0) throw Error('Invalid exclusion zone');
      if (metres(t.coords[i], zone, t.projection.radius) <= zone.radiusM + Math.hypot(t.dx, t.dy) / 2) blocked[i] = 1;
    }
    if (anchorNode !== null && p.enforceShelter && Number.isFinite(t.values[i])) {
      if (metres(t.coords[i], t.coords[anchorNode], t.projection.radius) / 1000 > p.maxShelterKm) blocked[i] = 1;
    }
    const dr = cellDoseRateUsvH(t, p, i);
    doseRate[i] = dr;
    if (!blocked[i] && Number.isFinite(dr) && dr < minDoseRate) minDoseRate = dr;
    if (Number.isFinite(t.values[i]) && Number.isFinite(t.slopes[i])) {
      const sNorm = Math.min(1.5, (t.slopes[i] / p.maxSlopeDeg) ** 2);
      const rNorm = Math.min(1.5, (rough / Math.max(0.1, p.maxRoughnessM)) ** 1.5);
      const dNorm = Math.min(3, dr / (refDose * 2));
      const shelterKm = anchorNode !== null ? metres(t.coords[i], t.coords[anchorNode], t.projection.radius) / 1000 : 0;
      const shNorm = Math.min(1.5, shelterKm / Math.max(0.5, p.maxShelterKm));
      const wSum = (p.wSlope + p.wRoughness + p.wRadiation + p.wWeather + p.wThermal + p.wShelter) || 1;
      cellHazard[i] = Math.min(1, (p.wSlope * sNorm + p.wRoughness * rNorm + p.wRadiation * dNorm + p.wWeather * wf.weatherHazard + p.wThermal * thermalNorm + p.wShelter * shNorm) / wSum);
    } else cellHazard[i] = 1;
  }
  if (!Number.isFinite(minDoseRate)) minDoseRate = 0;

  const multiplier = p.roundTrip ? 2 : 1;
  const minEnergyPerM = multiplier * (p.massKg * G * p.rolling / p.efficiency / 3600000 + hotelW / 1000 / (effSpeedKmh * 1000));
  const minHoursPerM = multiplier / (effSpeedKmh * 1000);
  // Minimum non-negative risk rate per metre for admissible A* heuristic
  const minRiskPerM = multiplier * (
    p.wWeather * wf.weatherHazard * 0.001 +
    p.wThermal * thermalNorm * 0.0008 +
    p.wRadiation * (minDoseRate * minHoursPerM / multiplier) * 0.025
  );

  function edgeCostByObjective(e, obj = p.objective) {
    if (obj === 'distance') return e.lengthM;
    if (obj === 'fastest') return e.hours;
    if (obj === 'safest') return e.risk;
    if (obj === 'balanced') return 0.55 * e.risk + 0.45 * e.energy;
    return e.energy;
  }

  function edge(a, b) {
    if (blocked[a] || blocked[b]) return null;
    const ax = a % t.width, ay = Math.floor(a / t.width), bx = b % t.width, by = Math.floor(b / t.width), xx = bx - ax, yy = by - ay;
    if (Math.abs(xx) > 1 || Math.abs(yy) > 1 || (!xx && !yy)) return null;
    if (xx && yy && (blocked[ay * t.width + bx] || blocked[by * t.width + ax])) return null;
    const horizontal = metres(t.coords[a], t.coords[b], t.projection.radius);
    const dz = t.values[b] - t.values[a];
    const grade = Math.atan2(Math.abs(dz), horizontal) / RAD;
    if (grade > p.maxSlopeDeg) return null;
    const roughAvg = t.roughness ? 0.5 * (t.roughness[a] + t.roughness[b]) : 0;
    const roughSlowdown = p.weatherEffects ? 0.5 * (roughAvg / Math.max(0.1, p.maxRoughnessM)) ** 2 : 0;
    const length = Math.hypot(horizontal, dz);
    const hours = multiplier * length / (effSpeedKmh * 1000) * (1 + 2 * (grade / p.maxSlopeDeg) ** 2 + roughSlowdown);
    const rolling = p.massKg * G * p.rolling * horizontal * multiplier / p.efficiency / 3600000;
    const climb = p.massKg * G * (p.roundTrip ? Math.abs(dz) : Math.max(0, dz)) / p.efficiency / 3600000;
    const hotel = hotelW * hours / 1000;
    const energy = rolling + climb + hotel;

    const cellSlopeMax = Math.max(grade, t.slopes[a], t.slopes[b]);
    const doseRateAvg = 0.5 * (doseRate[a] + doseRate[b]);
    const doseUsv = doseRateAvg * hours;
    const shelterDistKm = anchorNode !== null ? 0.5 * (metres(t.coords[a], t.coords[anchorNode], t.projection.radius) + metres(t.coords[b], t.coords[anchorNode], t.projection.radius)) / 1000 : 0;

    // Decomposed dimensionless risk penalty units (all strictly >= 0)
    const slopeRisk = p.wSlope * multiplier * (length / 1000) * (0.35 + 4.5 * (cellSlopeMax / p.maxSlopeDeg) ** 3);
    const roughRisk = p.wRoughness * multiplier * (length / 1000) * 2.2 * (roughAvg / Math.max(0.1, p.maxRoughnessM)) ** 2;
    const radRisk = p.wRadiation * doseUsv * 0.025;
    const weatherRisk = p.wWeather * multiplier * length * wf.weatherHazard * 0.001;
    const thermalRisk = p.wThermal * multiplier * length * thermalNorm * 0.0008;
    const shelterRisk = p.wShelter * multiplier * (length / 1000) * 1.4 * (shelterDistKm / Math.max(0.5, p.maxShelterKm)) ** 2;
    const risk = slopeRisk + roughRisk + radRisk + weatherRisk + thermalRisk + shelterRisk + 1e-6 * length;

    return {
      energy, hours, lengthM: length, horizontalM: horizontal,
      ascentM: Math.max(0, dz), descentM: Math.max(0, -dz),
      grade, rolling, climb, hotel,
      doseUsv, roughM: roughAvg, risk,
      slopeRisk, roughRisk, radRisk, weatherRisk, thermalRisk, shelterRisk
    };
  }

  function neighbours(i) {
    const out = [], x = i % t.width, y = Math.floor(i / t.width);
    for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) {
      if ((xx || yy) && x + xx >= 0 && x + xx < t.width && y + yy >= 0 && y + yy < t.height) {
        const j = i + yy * t.width + xx, e = edge(i, j);
        if (e) out.push([j, e]);
      }
    }
    return out;
  }

  const stopEnergy = hotelW * p.stopHours / 1000;
  const stopDoseFor = goalNode => (Number.isFinite(doseRate[goalNode]) ? doseRate[goalNode] : minDoseRate) * p.stopHours;
  const energyBudget = p.batteryKwh * (1 - p.reservePercent / 100);
  const timeBudget = p.autonomyHours * (1 - p.reservePercent / 100);
  const doseBudget = p.maxDoseUsv;
  const enforceDose = p.enforceDose;

  return {
    t, p, blocked, doseRate, cellHazard, weather: wf, effSpeedKmh,
    edge, neighbours, edgeCostByObjective, multiplier,
    stopEnergy, stopDoseFor, energyBudget, timeBudget, doseBudget, enforceDose, hotelW, minDoseRate,
    lowerBound(a, b, obj = 'energy') {
      const d = metres(t.coords[a], t.coords[b], t.projection.radius);
      if (obj === 'distance') return d;
      if (obj === 'fastest') return d * minHoursPerM;
      if (obj === 'safest') return d * minRiskPerM;
      if (obj === 'balanced') return d * (0.55 * minRiskPerM + 0.45 * minEnergyPerM);
      return d * minEnergyPerM;
    },
    minTime(a, b) {
      return metres(t.coords[a], t.coords[b], t.projection.radius) * minHoursPerM;
    },
    minDose(a, b) {
      return metres(t.coords[a], t.coords[b], t.projection.radius) * minHoursPerM * minDoseRate;
    }
  };
}

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(v) {
    const a = this.a; a.push(v); let i = a.length - 1;
    while (i) { const p = (i - 1) >> 1; if (a[p].priority <= v.priority) break; a[i] = a[p]; i = p; }
    a[i] = v;
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      while (i * 2 + 1 < a.length) {
        let c = i * 2 + 1;
        if (c + 1 < a.length && a[c + 1].priority < a[c].priority) c++;
        if (a[c].priority >= last.priority) break;
        a[i] = a[c]; i = c;
      }
      a[i] = last;
    }
    return top;
  }
}

export function metrics(g, path, stops = null) {
  // One surface stop per waypoint; defaults to the single destination stop.
  const stopNodes = stops && stops.length ? stops : (path.length ? [path[path.length - 1]] : []);
  const stopEnergy = g.stopEnergy || 0;
  let stopDose = 0;
  for (const node of stopNodes) stopDose += g.stopDoseFor ? g.stopDoseFor(node) : 0;
  const m = {
    energy: stopEnergy * stopNodes.length, hours: (g.p.stopHours || 0) * stopNodes.length,
    lengthM: 0, ascentM: 0, descentM: 0,
    maxSlopeDeg: 0, maxRoughnessM: 0, rolling: 0, climb: 0, hotel: stopEnergy * stopNodes.length,
    doseUsv: stopDose, stopDoseUsv: stopDose, stops: stopNodes.length, risk: 0,
    slopeRisk: 0, roughRisk: 0, radRisk: 0, weatherRisk: 0, thermalRisk: 0, shelterRisk: 0,
    maxShelterKm: 0
  };
  const startCoord = g.t.coords?.[path[0]];
  for (let i = 0; i < path.length; i++) {
    const node = path[i];
    m.maxSlopeDeg = Math.max(m.maxSlopeDeg, g.t.slopes[node]);
    if (g.t.roughness) m.maxRoughnessM = Math.max(m.maxRoughnessM, g.t.roughness[node] || 0);
    if (startCoord && g.t.coords?.[node]) {
      m.maxShelterKm = Math.max(m.maxShelterKm, metres(startCoord, g.t.coords[node], g.t.projection.radius) / 1000);
    }
    if (!i) continue;
    const e = g.edge(path[i - 1], node);
    if (!e) throw Error('Path crosses blocked terrain');
    for (const k of ['energy', 'hours', 'lengthM', 'ascentM', 'descentM', 'rolling', 'climb', 'hotel', 'doseUsv', 'risk', 'slopeRisk', 'roughRisk', 'radRisk', 'weatherRisk', 'thermalRisk', 'shelterRisk']) {
      if (Number.isFinite(e[k])) m[k] += e[k];
    }
    m.maxSlopeDeg = Math.max(m.maxSlopeDeg, e.grade);
  }
  m.missionKm = m.lengthM * g.multiplier / 1000;
  m.oneWayKm = m.lengthM / 1000;
  m.energyMargin = g.energyBudget - m.energy;
  m.timeMargin = g.timeBudget - m.hours;
  m.doseMarginUsv = (g.doseBudget ?? Infinity) - m.doseUsv;
  // Interpretable 0–100 safety score (100 = flat, smooth, low dose, sheltered, clear weather)
  const riskPerKm = m.missionKm > 0.001 ? m.risk / m.missionKm : 0;
  const slopeRatio = m.maxSlopeDeg / Math.max(0.1, g.p.maxSlopeDeg);
  const doseRatio = g.doseBudget ? m.doseUsv / g.doseBudget : 0;
  m.safetyScore = Math.max(0, Math.min(100, 100 - 14 * Math.min(3.5, riskPerKm) - 22 * slopeRatio ** 2 - 18 * Math.min(1.5, doseRatio)));
  return m;
}

// Scalar graph shortest path; also used as an independent zero-heuristic Dijkstra verifier.
export function shortest(g, start, goal, { objective = 'energy', heuristic = true } = {}) {
  if (g.blocked[start] || g.blocked[goal]) return { status: 'blocked-endpoint', path: [] };
  const n = g.t.values.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), closed = new Uint8Array(n), heap = new Heap();
  dist[start] = 0;
  const h = i => heuristic && g.lowerBound ? g.lowerBound(i, goal, objective) : 0;
  heap.push({ node: start, cost: 0, priority: h(start) });
  let expanded = 0;
  const costFn = g.edgeCostByObjective
    ? e => g.edgeCostByObjective(e, objective)
    : e => (objective === 'distance' ? e.lengthM : objective === 'fastest' ? e.hours : e.energy);
  while (heap.size) {
    const cur = heap.pop(), i = cur.node;
    if (closed[i] || cur.cost !== dist[i]) continue;
    closed[i] = 1; expanded++;
    if (i === goal) {
      const path = [];
      for (let at = i; at !== -1; at = prev[at]) path.push(at);
      path.reverse();
      return { status: 'optimal', path, cost: dist[i], expanded, visited: closed };
    }
    for (const [j, e] of g.neighbours(i)) {
      const value = dist[i] + costFn(e);
      if (value < dist[j]) {
        dist[j] = value; prev[j] = i;
        heap.push({ node: j, cost: value, priority: value + h(j) });
      }
    }
  }
  return { status: 'no-path', path: [], expanded, visited: closed };
}

// Exact multi-resource Pareto labels (objective cost + energy + hours + optional radiation dose).
export function constrained(g, start, goal, { maxLabels = 350000, objective = 'energy' } = {}) {
  if (g.blocked[start] || g.blocked[goal]) return { status: 'blocked-endpoint', path: [] };
  const labels = Array.from({ length: g.t.values.length }, () => []);
  const heap = new Heap(), all = [], visited = new Uint8Array(g.t.values.length);
  let expanded = 0;
  const useDose = Boolean(g.enforceDose);
  const stopDose = g.stopDoseFor ? g.stopDoseFor(goal) : 0;
  const costFn = g.edgeCostByObjective ? e => g.edgeCostByObjective(e, objective) : e => e.energy;
  const baseOffset = objective === 'energy' ? g.stopEnergy : objective === 'fastest' ? g.p.stopHours : 0;
  const lb = i => g.lowerBound ? g.lowerBound(i, goal, objective) : 0;
  const lbEnergy = i => g.lowerBound ? g.lowerBound(i, goal, 'energy') : 0;
  const lbDose = i => (useDose && g.minDose) ? g.minDose(i, goal) : 0;

  const root = {
    node: start, cost: baseOffset, energy: g.stopEnergy, hours: g.p.stopHours, dose: stopDose,
    parent: -1, active: true, id: 0, priority: baseOffset + lb(start)
  };
  all.push(root); labels[start].push(root); heap.push(root);

  while (heap.size) {
    const cur = heap.pop();
    if (!cur.active) continue;
    if (cur.energy > g.energyBudget || cur.hours > g.timeBudget || (useDose && cur.dose > g.doseBudget)) continue;
    visited[cur.node] = 1; expanded++;
    if (cur.node === goal) {
      const path = [];
      for (let at = cur; at; at = at.parent < 0 ? null : all[at.parent]) path.push(at.node);
      return {
        status: 'optimal', path: path.reverse(), cost: cur.cost, expanded,
        labelCount: all.length, visited, lowerBound: cur.cost, gap: 0,
        method: 'Resource-constrained A* / Pareto labels'
      };
    }
    for (const [node, e] of g.neighbours(cur.node)) {
      const energy = cur.energy + e.energy;
      const hours = cur.hours + e.hours;
      const dose = cur.dose + (e.doseUsv || 0);
      const cost = cur.cost + costFn(e);
      const priority = cost + lb(node);
      if (energy + lbEnergy(node) > g.energyBudget || hours + g.minTime(node, goal) > g.timeBudget) continue;
      if (useDose && dose + lbDose(node) > g.doseBudget) continue;
      const list = labels[node];
      if (list.some(l => l.active && l.cost <= cost && l.energy <= energy && l.hours <= hours && (!useDose || l.dose <= dose))) continue;
      for (const l of list) {
        if (l.active && cost <= l.cost && energy <= l.energy && hours <= l.hours && (!useDose || dose <= l.dose)) l.active = false;
      }
      if (all.length >= maxLabels) return { status: 'search-limit', path: [], expanded, labelCount: all.length, visited };
      const next = { node, cost, energy, hours, dose, priority, parent: cur.id, active: true, id: all.length };
      all.push(next); list.push(next); heap.push(next);
    }
  }
  return { status: 'infeasible', path: [], expanded, labelCount: all.length, visited };
}

export function straightPath(t, a, b) {
  const ax = a % t.width, ay = Math.floor(a / t.width), bx = b % t.width, by = Math.floor(b / t.width);
  const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay)), path = [];
  for (let k = 0; k <= steps; k++) {
    const f = steps ? k / steps : 0;
    const i = Math.round(ay + (by - ay) * f) * t.width + Math.round(ax + (bx - ax) * f);
    if (path.at(-1) !== i) path.push(i);
  }
  return path;
}

function withinBudgets(g, m) {
  return m.energy <= g.energyBudget && m.hours <= g.timeBudget && (!g.enforceDose || m.doseUsv <= g.doseBudget);
}

export function plan(t, startPoint, endPoint, input = {}, exclusions = [], options = {}) {
  const start = nodeAt(t, startPoint), goal = nodeAt(t, endPoint);
  const g = graph(t, input, exclusions, start);
  const objective = g.p.objective;
  const base = {
    start, goal, objective, assumptions: g.p,
    energyBudget: g.energyBudget, timeBudget: g.timeBudget, doseBudget: g.doseBudget, enforceDose: g.enforceDose,
    weather: g.weather, effSpeedKmh: g.effSpeedKmh,
    blocked: g.blocked, doseRate: g.doseRate, cellHazard: g.cellHazard,
    domain: { width: t.width, height: t.height, stepM: t.dx },
    snapMetres: { start: metres(startPoint, t.coords[start], t.projection.radius), goal: metres(endPoint, t.coords[goal], t.projection.radius) }
  };
  const direct = straightPath(t, start, goal);
  const bad = direct.findIndex((n, i) => g.blocked[n] || (i && !g.edge(direct[i - 1], n)));
  base.direct = { path: direct, status: bad < 0 ? 'traversable' : 'blocked', metrics: bad < 0 ? metrics(g, direct) : null };

  if (g.blocked[start] || g.blocked[goal]) return { ...base, status: 'blocked-endpoint', path: [] };
  const stopDose = g.stopDoseFor(goal);
  if (g.stopEnergy > g.energyBudget || g.p.stopHours > g.timeBudget || (g.enforceDose && stopDose > g.doseBudget)) {
    return { ...base, status: 'infeasible', path: [], reason: 'Science stop alone exceeds the reserved mission or radiation budget.' };
  }

  // Compute reference routes across criteria on the same graph
  const energyRun = shortest(g, start, goal, { objective: 'energy' });
  const shortRun = shortest(g, start, goal, { objective: 'distance', heuristic: false });
  const safeRun = shortest(g, start, goal, { objective: 'safest' });
  const balancedRun = shortest(g, start, goal, { objective: 'balanced' });
  const fastRun = shortest(g, start, goal, { objective: 'fastest' });

  const packAlt = run => ({ path: run.path, status: run.status, metrics: run.path.length ? metrics(g, run.path) : null });
  base.shortest = packAlt(shortRun);
  base.alternatives = {
    safest: packAlt(safeRun),
    balanced: packAlt(balancedRun),
    energy: packAlt(energyRun),
    fastest: packAlt(fastRun),
    shortest: base.shortest
  };

  if (energyRun.status !== 'optimal') return { ...base, ...energyRun };
  const em = base.alternatives.energy.metrics;
  if (em.energy > g.energyBudget) {
    return { ...base, status: 'infeasible', path: [], reason: 'Even the minimum-energy route exceeds available energy.', minimumRequiredEnergy: em.energy };
  }
  if (fastRun.status === 'optimal' && base.alternatives.fastest.metrics.hours > g.timeBudget) {
    return { ...base, status: 'infeasible', path: [], reason: 'Even the fastest traversable route exceeds available crew time.', minimumRequiredHours: base.alternatives.fastest.metrics.hours };
  }

  const primaryUnconstrained = objective === 'safest' ? safeRun
    : objective === 'balanced' ? balancedRun
    : objective === 'fastest' ? fastRun
    : objective === 'distance' ? shortRun
    : energyRun;

  const pm = primaryUnconstrained.path.length ? metrics(g, primaryUnconstrained.path) : null;
  let result;
  if (pm && withinBudgets(g, pm)) {
    const verifier = shortest(g, start, goal, { objective, heuristic: false });
    if (!Number.isFinite(verifier.cost) || Math.abs(primaryUnconstrained.cost - verifier.cost) > 1e-7) {
      throw Error('Optimality verification failed');
    }
    const baseOffset = objective === 'energy' ? g.stopEnergy : objective === 'fastest' ? g.p.stopHours : 0;
    result = {
      ...primaryUnconstrained,
      method: 'A* + Dijkstra verification',
      verification: {
        objective,
        costAStar: primaryUnconstrained.cost + baseOffset,
        costDijkstra: verifier.cost + baseOffset,
        energyAStar: pm.energy,
        energyDijkstra: objective === 'energy' ? verifier.cost + g.stopEnergy : metrics(g, verifier.path).energy,
        delta: Math.abs(primaryUnconstrained.cost - verifier.cost),
        expandedDijkstra: verifier.expanded
      },
      lowerBound: primaryUnconstrained.cost + baseOffset,
      gap: 0
    };
  } else {
    result = constrained(g, start, goal, { ...options, objective });
  }

  const finalMetrics = result.path.length ? metrics(g, result.path) : null;
  let cumDistM = 0, cumDoseUsv = 0;
  const profile = result.path.map((node, idx) => {
    if (idx > 0) {
      const e = g.edge(result.path[idx - 1], node);
      if (e) { cumDistM += e.lengthM; cumDoseUsv += e.doseUsv; }
    }
    return {
      ...t.coords[node],
      distanceKm: cumDistM / 1000,
      elevationM: t.values[node],
      slopeDeg: t.slopes[node],
      roughnessM: t.roughness ? t.roughness[node] : 0,
      skyView: t.skyView ? t.skyView[node] : 1,
      doseRateUsvH: g.doseRate[node],
      cumDoseUsv,
      hazardIndex: g.cellHazard[node]
    };
  });

  return {
    ...base,
    ...result,
    metrics: finalMetrics,
    profile,
    minimumUnconstrained: em
  };
}

// Join per-leg node chains into one continuous path (waypoint nodes are shared, never duplicated).
function chainPath(legs) {
  const path = [];
  for (const leg of legs) {
    for (const node of leg.path) {
      if (!path.length || path[path.length - 1] !== node) path.push(node);
    }
  }
  return path;
}

// Ordered multi-stop mission: optimize each leg in sequence. Unbudgeted runs give the reference
// strategies; budgeted runs reserve a provable lower bound for every remaining leg so a greedy
// early leg can never starve the rest of the traverse.
function solveChain(g, nodes, objective, { budgeted = false, options = {} } = {}) {
  const legs = [];
  const paid = { energy: 0, hours: 0, dose: 0 };
  let expanded = 0, labelCount = 0, method = null;
  for (let k = 0; k + 1 < nodes.length; k++) {
    const a = nodes[k], b = nodes[k + 1];
    if (g.blocked[a] || g.blocked[b]) {
      return { status: 'blocked-endpoint', legs, expanded, blockedLeg: k };
    }
    let run;
    if (budgeted) {
      const rest = nodes.slice(k + 1);
      const final = nodes[nodes.length - 1];
      const stopsLeft = rest.length - 1;
      const reserveEnergy = g.lowerBound(b, final, 'energy') + (g.stopEnergy || 0) * stopsLeft;
      // Remaining transit is bounded from this leg's destination, so nothing already paid is reserved twice.
      const reserveHours = g.minTime(b, final) + (g.p.stopHours || 0) * stopsLeft;
      const reserveDose = g.enforceDose ? g.minDose(b, final) + (g.minDoseRate || 0) * g.p.stopHours * stopsLeft : 0;
      const envelope = {
        energy: g.energyBudget - paid.energy - reserveEnergy,
        hours: g.timeBudget - paid.hours - reserveHours,
        dose: g.enforceDose ? g.doseBudget - paid.dose - reserveDose : g.doseBudget
      };
      if (envelope.energy < 0 || envelope.hours < 0 || (g.enforceDose && envelope.dose < 0)) {
        return { status: 'infeasible', legs, expanded, labelCount };
      }
      const scope = Object.create(g);
      scope.energyBudget = envelope.energy;
      scope.timeBudget = envelope.hours;
      scope.doseBudget = Math.max(0, envelope.dose);
      run = constrained(scope, a, b, { ...options, objective });
      labelCount += run.labelCount || 0;
      if (run.method) method = run.method;
    } else {
      run = shortest(g, a, b, { objective, heuristic: objective !== 'distance' });
    }
    expanded += run.expanded || 0;
    if (run.status !== 'optimal') {
      return { status: run.status, legs, expanded, labelCount, blockedLeg: k };
    }
    const legMetrics = metrics(g, run.path);
    paid.energy += legMetrics.energy;
    paid.hours += legMetrics.hours;
    paid.dose += legMetrics.doseUsv;
    legs.push({ start: a, goal: b, from: k, to: k + 1, path: run.path, status: 'optimal', cost: run.cost, expanded: run.expanded || 0 });
  }
  return { status: 'optimal', legs, expanded, labelCount, method };
}

// Ordered waypoint mission planner. Two waypoints delegate to the verified single-leg planner.
export function planRoute(t, waypoints, input = {}, exclusions = [], options = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) throw Error('At least two waypoints are required');
  const points = waypoints.map(p => ({ lat: Number(p.lat), lon: Number(p.lon) }));
  if (points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) {
    throw Error('Invalid waypoint coordinates');
  }
  if (points.length === 2) {
    const single = plan(t, points[0], points[1], input, exclusions, options);
    return {
      ...single,
      snapMetres: [single.snapMetres?.start ?? 0, single.snapMetres?.goal ?? 0],
      waypoints: points,
      nodes: [single.start, single.goal],
      stopsCount: 1,
      legs: single.path?.length ? [{ start: single.start, goal: single.goal, from: 0, to: 1, path: single.path, status: single.status, metrics: single.metrics, expanded: single.expanded }] : []
    };
  }

  const nodes = points.map(p => nodeAt(t, p));
  const g = graph(t, input, exclusions, nodes[0]);
  const objective = g.p.objective;
  const last = nodes.length - 1;
  const stopNodes = nodes.slice(1);
  const base = {
    start: nodes[0], goal: nodes[last], nodes,
    waypoints: points,
    objective, assumptions: g.p,
    energyBudget: g.energyBudget, timeBudget: g.timeBudget, doseBudget: g.doseBudget, enforceDose: g.enforceDose,
    weather: g.weather, effSpeedKmh: g.effSpeedKmh,
    blocked: g.blocked, doseRate: g.doseRate, cellHazard: g.cellHazard,
    domain: { width: t.width, height: t.height, stepM: t.dx },
    snapMetres: points.map((p, i) => metres(p, t.coords[nodes[i]], t.projection.radius)),
    legs: []
  };

  // Reference "direct" line visiting every waypoint in order.
  const directPath = [];
  let directBlocked = -1;
  for (let k = 0; k + 1 < nodes.length; k++) {
    const seg = straightPath(t, nodes[k], nodes[k + 1]);
    const bad = seg.findIndex((n, i) => g.blocked[n] || (i && !g.edge(seg[i - 1], n)));
    if (bad >= 0 && directBlocked < 0) directBlocked = k;
    for (const n of seg) if (directPath[directPath.length - 1] !== n) directPath.push(n);
  }
  base.direct = {
    path: directPath,
    status: directBlocked < 0 ? 'traversable' : 'blocked',
    blockedLeg: directBlocked,
    metrics: directBlocked < 0 ? metrics(g, directPath, stopNodes) : null
  };

  const blockedWaypoint = nodes.findIndex(n => g.blocked[n]);
  if (blockedWaypoint >= 0) {
    return {
      ...base, status: 'blocked-endpoint', path: [], blockedWaypoint,
      reason: `Waypoint ${blockedWaypoint === 0 ? 'A' : blockedWaypoint === last ? 'B' : 'stop ' + blockedWaypoint} lies on blocked terrain.`
    };
  }

  const stopsCount = nodes.length - 1;
  if (g.stopEnergy * stopsCount > g.energyBudget) {
    return { ...base, status: 'infeasible', path: [], reason: `${stopsCount} surface stops alone exceed the reserved mission energy budget.` };
  }
  if (g.p.stopHours * stopsCount > g.timeBudget) {
    return { ...base, status: 'infeasible', path: [], reason: `${stopsCount} surface stops alone exceed the available crew time.` };
  }

  const runOf = key => solveChain(g, nodes, key, { budgeted: false });
  const runs = { energy: runOf('energy'), distance: runOf('distance'), safest: runOf('safest'), balanced: runOf('balanced'), fastest: runOf('fastest') };
  const packChain = run => {
    const path = run.legs.length ? chainPath(run.legs) : [];
    return { status: run.status, path, legs: run.legs, metrics: run.status === 'optimal' ? metrics(g, path, stopNodes) : null };
  };
  const alternatives = {
    safest: packChain(runs.safest),
    balanced: packChain(runs.balanced),
    energy: packChain(runs.energy),
    fastest: packChain(runs.fastest),
    shortest: packChain(runs.distance)
  };
  base.shortest = alternatives.shortest;
  base.alternatives = alternatives;

  if (runs.energy.status !== 'optimal') {
    return { ...base, status: runs.energy.status, path: [], reason: 'No continuous corridor connects every waypoint.' };
  }
  const em = alternatives.energy.metrics;
  if (em.energy > g.energyBudget) {
    return { ...base, status: 'infeasible', path: [], reason: 'Even the minimum-energy route through all stops exceeds available energy.', minimumRequiredEnergy: em.energy };
  }
  if (alternatives.fastest.metrics && alternatives.fastest.metrics.hours > g.timeBudget) {
    return { ...base, status: 'infeasible', path: [], reason: 'Even the fastest traversable route through all stops exceeds available crew time.', minimumRequiredHours: alternatives.fastest.metrics.hours };
  }

  const primaryRun = runs[objective] || runs.energy;
  const primaryPath = packChain(primaryRun).path;
  const pm = primaryPath.length ? metrics(g, primaryPath, stopNodes) : null;
  let result;
  if (pm && withinBudgets(g, pm)) {
    let costAStar = 0, costDijkstra = 0, expandedDijkstra = 0, maxDelta = 0;
    const perLeg = [];
    for (const leg of primaryRun.legs) {
      const verifier = shortest(g, leg.start, leg.goal, { objective, heuristic: false });
      if (verifier.status !== 'optimal' || Math.abs(leg.cost - verifier.cost) > 1e-7) throw Error('Optimality verification failed');
      const delta = Math.abs(leg.cost - verifier.cost);
      maxDelta = Math.max(maxDelta, delta);
      costAStar += leg.cost;
      costDijkstra += verifier.cost;
      expandedDijkstra += verifier.expanded;
      perLeg.push({ from: leg.from, to: leg.to, costAStar: leg.cost, costDijkstra: verifier.cost, delta, expanded: verifier.expanded });
    }
    result = {
      status: 'optimal',
      path: primaryPath,
      legs: primaryRun.legs,
      expanded: primaryRun.expanded + expandedDijkstra,
      method: 'A* + Dijkstra verification per leg',
      verification: {
        objective, perLeg,
        costAStar, costDijkstra, delta: maxDelta,
        expandedDijkstra,
        energyAStar: pm.energy
      },
      lowerBound: costAStar,
      gap: 0
    };
  } else {
    const bounded = solveChain(g, nodes, objective, { budgeted: true, options });
    result = {
      ...bounded,
      path: bounded.status === 'optimal' ? chainPath(bounded.legs) : [],
      method: bounded.method || 'Sequential resource-constrained A* / Pareto labels'
    };
  }

  const finalMetrics = result.path?.length ? metrics(g, result.path, stopNodes) : null;
  const legReports = (result.legs || []).map((leg, index) => ({
    index, from: leg.from ?? index, to: leg.to ?? index + 1,
    status: leg.path?.length ? 'optimal' : 'no-path',
    waypointCount: leg.path?.length || 0,
    metrics: leg.path?.length ? metrics(g, leg.path) : null
  }));

  const waypointDistancesKm = [0];
  for (const leg of legReports) waypointDistancesKm.push(waypointDistancesKm[waypointDistancesKm.length - 1] + (leg.metrics ? leg.metrics.oneWayKm : 0));

  let cumDistM = 0, cumDoseUsv = 0;
  const profile = (result.path || []).map((node, idx) => {
    if (idx > 0) {
      const e = g.edge(result.path[idx - 1], node);
      if (e) { cumDistM += e.lengthM; cumDoseUsv += e.doseUsv; }
    }
    return {
      ...t.coords[node],
      distanceKm: cumDistM / 1000,
      elevationM: t.values[node],
      slopeDeg: t.slopes[node],
      roughnessM: t.roughness ? t.roughness[node] : 0,
      skyView: t.skyView ? t.skyView[node] : 1,
      doseRateUsvH: g.doseRate[node],
      cumDoseUsv,
      hazardIndex: g.cellHazard[node]
    };
  });

  return {
    ...base,
    ...result,
    metrics: finalMetrics,
    profile,
    legs: legReports,
    waypointDistancesKm,
    stopsCount,
    minimumUnconstrained: em
  };
}
