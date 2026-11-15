import { DEFAULTS, PRESETS, SOLAR_SCENARIOS, parameters, coordinates, gridPosition, metres, cellDoseRateUsvH } from './rover-core.js';
import { validateClimate, sampleClimate, FIELDS } from './environment.js';
import { MapView, bindMap } from './rover-map.js';

const $ = id => document.getElementById(id);
const form = $('rover-form'), canvas = $('terrain-map'), ctx = canvas.getContext('2d');
const fmt = (x, n = 2) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: n, minimumFractionDigits: n }) : '—';

const MAX_ZOOM = 6;
const REGIONAL_CTX_ZONE = {
  id: 'jezero-ctx-basin',
  name: 'Jezero Crater · regional CTX mosaic (10 × 10 km)',
  description: 'Regional NASA Mars 2020 CTX stereo DEM across western Jezero delta, crater rims and floor (20 m native, 40 m route graph). Choose this zone to plan long traverses across the whole crater.',
  dem: './data/jezero-dem.json',
  image: null,
  imageResolutionM: null,
  nativeImageResolutionM: 20,
  imagePageUrl: 'https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic'
};

let dem = null, grid = null, worker = null, workerReady = false, report = null, climate = null;
let start = null, goal = null, exclusions = [], mode = 'pan', epoch = 0, busy = false, elapsedMs = 0;
let climateEpoch = 0, baseImage = null, regions = [], region = null, photo = null, loadEpoch = 0, loadingRegion = false;
const view = new MapView(MAX_ZOOM);

function updateZoomBadge() {
  const badge = $('zoom-level');
  if (badge) badge.textContent = view.zoom.toFixed(1) + '×';
}

function updateWeightLabels() {
  for (const k of ['wSlope', 'wRoughness', 'wRadiation', 'wWeather', 'wThermal', 'wShelter']) {
    const el = form.elements[k], badge = $('val-' + k);
    if (el && badge) badge.textContent = Number(el.value).toFixed(1);
  }
}

function applyPresetValues(presetKey) {
  const preset = PRESETS[presetKey];
  if (!preset) return;
  for (const [k, v] of Object.entries(preset.values)) {
    const el = form.elements[k];
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v);
  }
  updateWeightLabels();
}

function values() {
  const p = { ...DEFAULTS };
  for (const el of form.elements) {
    if (!el.name || !(el.name in p)) continue;
    if (el.type === 'checkbox') p[el.name] = el.checked;
    else if (el.tagName === 'SELECT' && el.name === 'objective') p[el.name] = el.value;
    else p[el.name] = Number(el.value);
  }
  return parameters(p);
}

function safeValuesPreview() {
  try { return values(); } catch { return { ...DEFAULTS, weatherEffects: true, enforceDose: true }; }
}

function pointInputs() {
  if (!start || !goal) return;
  for (const [name, p] of [['start', start], ['goal', goal]]) {
    for (const k of ['lat', 'lon']) $(name + '-' + k).value = p[k].toFixed(5);
  }
  const crowKm = grid ? metres(start, goal, grid.projection.radius) / 1000 : 0;
  $('point-summary').textContent = `① Point A (${start.lat.toFixed(5)}°N, ${start.lon.toFixed(5)}°E) → ② Point B (${goal.lat.toFixed(5)}°N, ${goal.lon.toFixed(5)}°E) · Great-circle ${fmt(crowKm, 2)} km · Exclusions: ${exclusions.length}.`;
}

function clearResults(message) {
  report = null; epoch++;
  $('export').disabled = $('print').disabled = true;
  $('result-title').textContent = 'Recalculation required';
  $('result-description').textContent = message;
  $('metrics').replaceChildren();
  $('comparison').innerHTML = '<tr><td colspan="8">' + message + '</td></tr>';
  $('certificate').textContent = 'Optimality has not been verified for the updated parameters.';
  $('profile').innerHTML = '<text x="20" y="105">Recalculate the route to view telemetry</text>';
  $('risk-breakdown').replaceChildren();
  $('energy-breakdown').replaceChildren();
  baseImage = null;
  draw();
}

function invalidate() {
  updateWeightLabels();
  clearResults('Parameters changed. Click “Calculate safe route” to optimize.');
  $('status').textContent = 'Parameters updated — ready to recalculate.';
  $('calculate').disabled = loadingRegion || !workerReady;
}

async function launchWorker() {
  worker?.terminate();
  workerReady = false;
  const active = worker = new Worker('./rover-worker.js', { type: 'module' });
  return new Promise((resolve, reject) => {
    active.onerror = e => {
      if (worker !== active) return;
      busy = false; workerReady = false;
      $('status').textContent = 'Calculation error: ' + e.message;
      $('retry').hidden = false;
      reject(Error(e.message));
    };
    active.onmessage = ({ data }) => {
      if (worker !== active) return;
      if (data.type === 'ready') {
        grid = data.grid; workerReady = true; resolve();
        draw();
      } else if (data.type === 'error') {
        worker._running = false;
        if (data.id === undefined) { reject(Error(data.message)); return; }
        if (data.id !== epoch) return;
        busy = false; $('calculate').disabled = false;
        $('status').textContent = data.message;
        clearResults('Calculation failed: ' + data.message);
      } else if (data.type === 'result' && data.id === epoch) {
        worker._running = false;
        busy = false; report = data.report; elapsedMs = data.elapsedMs;
        $('calculate').disabled = false;
        renderReport();
        baseImage = null;
        draw();
      }
    };
    active.postMessage({ type: 'init', dem });
  });
}

function syncFormWithClimate() {
  if (!climate) return;
  form.elements.ambientC.value = climate.temperatureC.toFixed(1);
  form.elements.pressurePa.value = Math.round(climate.pressurePa);
  form.elements.windMs.value = climate.windMs.toFixed(1);
  form.elements.dustTau.value = climate.dustTau.toFixed(2);
  form.elements.solarHour.value = String(climate.localSolarHour);
}

async function loadClimate(syncInputs = true) {
  const token = ++climateEpoch;
  $('climate-context').textContent = 'Loading MCD 6.2…';
  const season = $('season').value, hour = $('hour').value;
  try {
    const r = await fetch(`./data/climate-${season}-${hour}.json`);
    if (!r.ok) throw Error('Climate scenario unavailable');
    const model = validateClimate(await r.json());
    if (token !== climateEpoch || !dem) return;
    const corners = [[0, 0], [dem.width - 1, 0], [0, dem.height - 1], [dem.width - 1, dem.height - 1]].map(([x, y]) => coordinates(dem, x, y));
    const samples = corners.map(p => sampleClimate(model, p.lat, p.lon));
    climate = {
      source: model.source, scenario: model.scenario, retrievedAt: model.retrievedAt,
      solarLongitude: model.solarLongitude, localSolarHour: model.localSolarHour,
      temperatureC: Math.min(...samples.map(s => s.values.airTemperatureK)),
      pressurePa: samples.reduce((a, s) => a + s.values.surfacePressurePa, 0) / samples.length,
      windMs: Math.max(...samples.map(s => s.values.windSpeedMs)),
      dustTau: Math.max(...samples.map(s => s.values.dustOpticalDepth)),
      gridCells: [...new Set(samples.map(s => s.cell))],
      ranges: Object.fromEntries(Object.keys(FIELDS).map(k => [k, { min: Math.min(...samples.map(s => s.values[k])), max: Math.max(...samples.map(s => s.values[k])) }]))
    };
    if (syncInputs) syncFormWithClimate();
    $('climate-context').textContent = `MCD 6.2 · Ls ${season}° · ${hour}:00 LT · Temp ${fmt(climate.temperatureC, 1)} °C · Pressure ${fmt(climate.pressurePa, 0)} Pa · Wind ${fmt(climate.windMs, 1)} m/s · Dust τ ${fmt(climate.dustTau, 2)}. You can override values above to test storm scenarios.`;
    $('calculate').disabled = loadingRegion || !workerReady;
    $('retry').hidden = true;
  } catch (e) {
    if (token !== climateEpoch) return;
    $('climate-context').textContent = e.message + ' (using manual weather inputs).';
    $('calculate').disabled = loadingRegion || !workerReady;
  }
}

async function load() {
  try {
    applyPresetValues('crewed-rover');
    const r = await fetch('./data/mission-regions.json');
    if (!r.ok) throw Error('Mission zone catalogue unavailable');
    const hiRiseRegions = await r.json();
    regions = [...hiRiseRegions, REGIONAL_CTX_ZONE];
    $('mission-region').replaceChildren(...regions.map(reg => {
      const o = document.createElement('option');
      o.value = reg.id;
      o.textContent = reg.name;
      return o;
    }));
    $('mission-region').disabled = false;
    const q = new URLSearchParams(location.search);
    const requested = q.get('region');
    await loadRegion(regions.find(reg => reg.id === requested) || regions[0], true);
  } catch (e) {
    $('status').textContent = 'Data could not be loaded: ' + e.message;
    $('retry').hidden = false;
  }
}

async function loadRegion(selected, useQuery = false) {
  const token = ++loadEpoch;
  loadingRegion = true; epoch++; climateEpoch++;
  worker?.terminate(); worker = null; workerReady = false;
  grid = null; dem = null; photo = null; climate = null; exclusions = [];
  region = selected; view.fit(); updateZoomBadge();

  $('mission-region').value = selected.id;
  $('calculate').disabled = true;
  clearResults('Loading measured NASA DEM…');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $('status').textContent = 'Loading measured NASA elevation grid…';
  $('retry').hidden = true;
  $('region-description').textContent = selected.description;
  $('imagery-status').textContent = selected.image ? 'Loading registered HiRISE orthoimage…' : 'Regional CTX 20 m elevation model (shaded relief & hazard layers active).';

  try {
    const response = await fetch(selected.dem);
    if (!response.ok) throw Error('Terrain file unavailable');
    const data = await response.json();
    if (token !== loadEpoch) return;
    dem = data;
    start = { ...dem.anchors.start };
    goal = { ...dem.anchors.goal };

    if (useQuery) {
      const q = new URLSearchParams(location.search);
      if (q.has('startLat') && q.has('startLon') && q.has('goalLat') && q.has('goalLon')) {
        const qs = { lat: Number(q.get('startLat')), lon: Number(q.get('startLon')) };
        const qg = { lat: Number(q.get('goalLat')), lon: Number(q.get('goalLon')) };
        const inside = p => {
          if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
          const gp = gridPosition(dem, p);
          return gp.x >= 0 && gp.y >= 0 && gp.x < dem.width && gp.y < dem.height;
        };
        if (inside(qs) && inside(qg)) {
          start = qs; goal = qg;
        } else {
          $('region-description').textContent += ' Selected Atlas endpoints lie outside this DEM footprint; default zone anchors are loaded.';
        }
      }
    }

    pointInputs();
    const imageTask = selected.image ? new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        if (token === loadEpoch) {
          photo = img;
          if ($('map-layer').value === 'elevation') $('map-layer').value = 'hybrid-hazard';
          $('imagery-status').textContent = `HiRISE orthorectified image · display ${fmt(selected.imageResolutionM, 2)} m/px · native ${fmt(selected.nativeImageResolutionM, 2)} m/px · co-registered to DEM. `;
          const link = document.createElement('a');
          link.href = selected.imagePageUrl; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'USGS STAC Source ↗';
          $('imagery-status').append(link);
        }
        resolve();
      };
      img.onerror = () => {
        if (token === loadEpoch) $('imagery-status').textContent = 'Orbital image unavailable; shaded elevation & hazard layers remain active.';
        resolve();
      };
      img.src = selected.image;
    }) : Promise.resolve().then(() => {
      if ($('map-layer').value === 'imagery' || $('map-layer').value === 'hybrid') $('map-layer').value = 'hazard';
    });

    await Promise.all([launchWorker(), loadClimate(true), imageTask]);
    if (token !== loadEpoch) return;
    loadingRegion = false;
    $('calculate').disabled = false;
    $('imagery-resolution').textContent = selected.imageResolutionM ? fmt(selected.imageResolutionM, 2) + ' m' : fmt(dem.dx, 0) + ' m DEM';
    $('graph-resolution').textContent = fmt(grid.dx, 1) + ' m';
    const p = dem.provenance;
    $('source-details').textContent = `${p.title}. Native DEM spacing: ${fmt(dem.dx, 2)} m. Route graph: ${grid.width} × ${grid.height} nodes (${fmt(grid.dx, 2)} m step). Elevation range: ${fmt(grid.minElevationM, 1)} m to ${fmt(grid.maxElevationM, 1)} m (MOLA aeroid). Source: ${p.sourceUrl}`;
    baseImage = null;
    draw();
    await calculate();
  } catch (e) {
    if (token !== loadEpoch) return;
    loadingRegion = false;
    $('status').textContent = 'Zone unavailable: ' + e.message;
    $('retry').hidden = false;
  }
}

async function calculate() {
  if (loadingRegion || !dem) return;
  form.querySelectorAll(':invalid').forEach(el => { const det = el.closest('details'); if (det) det.open = true; });
  if (!form.reportValidity()) return;
  try {
    const p = values();
    clearResults('Running multi-hazard A* / Pareto optimization & Dijkstra verification…');
    const id = epoch;
    busy = true;
    $('calculate').disabled = true;
    $('status').textContent = `Optimizing (${p.objective}) across ${grid.width}×${grid.height} NASA terrain graph…`;
    if (!workerReady || (busy && worker._running)) await launchWorker();
    if (id !== epoch) return;
    worker._running = true;
    worker.postMessage({ type: 'plan', id, start, goal, parameters: p, exclusions });
  } catch (e) {
    busy = false;
    $('calculate').disabled = false;
    $('status').textContent = e.message;
  }
}

function heatRamp(t) {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.35) { const f = c / 0.35; return [38 + 42 * f, 148 + 45 * f, 118 - 25 * f]; }
  if (c < 0.7) { const f = (c - 0.35) / 0.35; return [80 + 155 * f, 193 - 25 * f, 93 - 35 * f]; }
  const f = (c - 0.7) / 0.3;
  return [235 + 15 * f, 168 - 115 * f, 58 + 12 * f];
}

function radRamp(t) {
  const c = Math.max(0, Math.min(1, t));
  if (c < 0.5) { const f = c * 2; return [36 + 88 * f, 65 + 45 * f, 150 + 65 * f]; }
  const f = (c - 0.5) * 2;
  return [124 + 125 * f, 110 - 55 * f, 215 - 65 * f];
}

function terrainImage() {
  if (!grid) return null;
  const off = document.createElement('canvas');
  off.width = grid.width; off.height = grid.height;
  const c = off.getContext('2d'), im = c.createImageData(grid.width, grid.height);
  const min = grid.minElevationM, max = grid.maxElevationM;
  const p = safeValuesPreview();
  const layer = $('map-layer').value;

  let minDose = Infinity, maxDose = -Infinity;
  const doses = report?.doseRate || new Float32Array(grid.values.length);
  for (let i = 0; i < grid.values.length; i++) {
    const d = report?.doseRate ? doses[i] : cellDoseRateUsvH(grid, p, i);
    if (!report?.doseRate) doses[i] = d;
    if (Number.isFinite(d)) { if (d < minDose) minDose = d; if (d > maxDose) maxDose = d; }
  }

  for (let y = 0; y < grid.height; y++) for (let x = 0; x < grid.width; x++) {
    const i = y * grid.width + x, z = grid.values[i], k = i * 4;
    let rgb;
    const l = grid.values[i - 1] ?? z, r = grid.values[i + 1] ?? z, u = grid.values[i - grid.width] ?? z, d = grid.values[i + grid.width] ?? z;
    const gx = Number.isFinite(r - l) ? (r - l) / (2 * grid.dx) : 0;
    const gy = Number.isFinite(d - u) ? (d - u) / (2 * Math.abs(grid.dy)) : 0;
    const shade = Math.max(0.35, Math.min(1.25, 0.84 - gx * 1.3 - gy * 0.7));

    if (!Number.isFinite(z)) {
      rgb = [28, 37, 46];
    } else if (layer === 'slope') {
      const f = Math.min(1, grid.slopes[i] / p.maxSlopeDeg);
      rgb = heatRamp(f).map(v => v * shade);
    } else if (layer === 'roughness') {
      const f = Math.min(1, (grid.roughness?.[i] || 0) / p.maxRoughnessM);
      rgb = heatRamp(f).map(v => v * shade);
    } else if (layer === 'radiation') {
      const f = (doses[i] - minDose) / (maxDose - minDose || 1);
      rgb = radRamp(f).map(v => v * (0.65 + 0.35 * shade));
    } else if (layer === 'hazard' || layer === 'hybrid-hazard') {
      const h = report?.cellHazard ? report.cellHazard[i] : Math.min(1, 0.65 * (grid.slopes[i] / p.maxSlopeDeg) ** 2 + 0.35 * ((grid.roughness?.[i] || 0) / p.maxRoughnessM));
      rgb = heatRamp(h).map(v => v * (layer === 'hybrid-hazard' ? 1 : shade));
    } else {
      const f = (z - min) / (max - min || 1);
      rgb = [(94 + 89 * f) * shade, (82 + 70 * f) * shade, (69 + 49 * f) * shade];
      if (Math.abs(z / 20 - Math.round(z / 20)) < 0.035) rgb = rgb.map(v => v * 0.68);
    }

    const blocked = report
      ? report.blocked[i]
      : (!Number.isFinite(z) || grid.slopes[i] > p.maxSlopeDeg ||
        (p.weatherEffects && (grid.roughness?.[i] || 0) > p.maxRoughnessM) ||
        exclusions.some(zone => metres(grid.coords[i], zone, grid.projection.radius) <= zone.radiusM + Math.hypot(grid.dx, grid.dy) / 2));

    if (blocked && $('show-blocked').checked && Number.isFinite(z)) {
      rgb = rgb.map((v, j) => v * 0.32 + [195, 42, 78][j] * 0.68);
    }
    if (report?.visited?.[i] && $('show-search').checked) {
      rgb = rgb.map((v, j) => v * 0.55 + [73, 154, 196][j] * 0.45);
    }

    let alpha = 255;
    if (layer === 'imagery' && photo) {
      alpha = 0;
      if (blocked && $('show-blocked').checked) { rgb = [195, 45, 82]; alpha = 135; }
      if (report?.visited?.[i] && $('show-search').checked) { rgb = [73, 154, 196]; alpha = 120; }
    } else if (layer === 'hybrid-hazard' && photo) {
      alpha = blocked && $('show-blocked').checked ? 165 : 95;
    }
    im.data.set([...rgb.map(v => Math.round(Math.min(255, Math.max(0, v)))), alpha], k);
  }
  c.putImageData(im, 0, 0);
  return off;
}

function draw() {
  updateZoomBadge();
  if (!grid || !start || !goal) return;
  if (!baseImage) baseImage = terrainImage();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-view.x * canvas.width, -view.y * canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const layer = $('map-layer').value;
  if (photo && (layer === 'imagery' || layer === 'hybrid' || layer === 'hybrid-hazard')) {
    ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
  }
  ctx.globalAlpha = photo && layer === 'hybrid' ? 0.38 : 1;
  ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);
  ctx.globalAlpha = 1;

  const sx = canvas.width / grid.width, sy = canvas.height / grid.height;

  if ($('show-shelter').checked) {
    const p = safeValuesPreview(), qs = gridPosition(grid, start);
    ctx.beginPath();
    ctx.arc((qs.x + 0.5) * sx, (qs.y + 0.5) * sy, (p.maxShelterKm * 1000) / grid.dx * sx, 0, Math.PI * 2);
    ctx.strokeStyle = '#61c9a8cc';
    ctx.lineWidth = 2.5 / view.zoom;
    ctx.setLineDash([10 / view.zoom, 7 / view.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPath(nodes, color, width, dash = []) {
    if (!nodes?.length) return;
    ctx.beginPath();
    nodes.forEach((n, i) => {
      const x = (n % grid.width + 0.5) * sx, y = (Math.floor(n / grid.width) + 0.5) * sy;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = '#071119d8';
    ctx.lineWidth = (width + 3) / view.zoom;
    ctx.setLineDash([]);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = width / view.zoom;
    ctx.setLineDash(dash.map(v => v / view.zoom));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (report) {
    if ($('show-direct').checked) drawPath(report.direct?.path, '#ef8c85', 2, [8, 9]);
    if ($('show-shortest').checked) drawPath(report.shortest?.path, '#73c6ec', 2.8, [12, 7]);
    if ($('show-energy').checked && report.objective !== 'energy') drawPath(report.alternatives?.energy?.path, '#b993ff', 3, [6, 6]);
    if ($('show-safest').checked && report.objective !== 'safest') drawPath(report.alternatives?.safest?.path, '#5ee39c', 3.2, [10, 5]);
    if (report.status === 'optimal') drawPath(report.path, '#ffdd7a', 5.2);
  }

  for (const zone of exclusions) {
    const q = gridPosition(grid, zone);
    ctx.beginPath();
    ctx.arc((q.x + 0.5) * sx, (q.y + 0.5) * sy, zone.radiusM / grid.dx * sx, 0, Math.PI * 2);
    ctx.fillStyle = '#ff6b9a28';
    ctx.fill();
    ctx.strokeStyle = '#ff9abb';
    ctx.lineWidth = 2 / view.zoom;
    ctx.stroke();
  }

  for (const [p, label, color] of [[start, 'A', '#67e8b5'], [goal, 'B', '#ffdc7a']]) {
    const q = gridPosition(grid, p);
    if (q.x < 0 || q.y < 0 || q.x >= grid.width || q.y >= grid.height) continue;
    const x = (q.x + 0.5) * sx, y = (q.y + 0.5) * sy;
    ctx.beginPath();
    ctx.arc(x, y, 14 / view.zoom, 0, 2 * Math.PI);
    ctx.fillStyle = '#0e1b25';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 / view.zoom;
    ctx.stroke();
    ctx.font = 'bold ' + (15 / view.zoom) + 'px Arial';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, y);
  }
  ctx.restore();

  const span = metres(coordinates(grid, 0, grid.height / 2), coordinates(grid, grid.width, grid.height / 2), grid.projection.radius) / view.zoom;
  const target = span * 0.2, power = 10 ** Math.floor(Math.log10(target));
  const distance = [1, 2, 5, 10].map(v => v * power).filter(v => v <= target).at(-1) || power;
  const scale = document.querySelector('.map-scale');
  scale.style.width = (distance / span * 100) + '%';
  scale.textContent = distance >= 1000 ? fmt(distance / 1000, 1) + ' km' : fmt(distance, 0) + ' m';
  scale.style.borderBottom = '2px solid #f2e7d3';
}

function renderReport() {
  const r = report;
  const objNames = {
    safest: 'Safest route found',
    balanced: 'Balanced safety-energy route found',
    energy: 'Minimum-energy route found',
    fastest: 'Fastest transit route found',
    distance: 'Shortest traversable route found'
  };
  const statuses = {
    optimal: objNames[r.objective] || 'Optimal route found',
    infeasible: 'Insufficient mission or dose budget',
    'no-path': 'No traversable corridor in this zone',
    'blocked-endpoint': 'Point A or Point B is on blocked terrain',
    'search-limit': 'Pareto search limit reached'
  };
  $('result-title').textContent = statuses[r.status] || r.status;
  $('status').textContent = `${statuses[r.status] || r.status} · ${fmt(elapsedMs / 1000, 2)} s`;

  $('result-description').textContent = r.status === 'optimal'
    ? `Verified ${r.objective} traverse (${r.assumptions.roundTrip ? 'round trip A→B→A' : 'one-way A→B'} + ${fmt(r.assumptions.stopHours, 1)} h stop). Effective speed under current weather/illumination: ${fmt(r.effSpeedKmh, 2)} km/h (visibility ~${fmt(r.weather?.visibilityKm, 1)} km).`
    : r.reason || (r.status === 'blocked-endpoint'
      ? 'Move Point A or Point B away from steep scarps, excessive roughness, exclusion circles, or weather abort conditions.'
      : r.status === 'no-path'
      ? 'No connected path satisfies the slope, roughness, shelter-range, and weather cutoffs inside this DEM footprint.'
      : 'No path satisfies all active energy, autonomy, and radiation dose budgets simultaneously.');

  const m = r.metrics;
  if (m) {
    const scoreColor = m.safetyScore >= 75 ? '#7ce6b0' : m.safetyScore >= 45 ? '#ebd4a7' : '#f0978b';
    const avgSkyShield = r.profile.length ? (1 - r.profile.reduce((a, p) => a + p.skyView, 0) / r.profile.length) * 100 : 0;
    const cards = [
      ['Composite safety score', `<span style="color:${scoreColor}">${fmt(m.safetyScore, 1)} / 100</span>`, `Hazard index ΣR: ${fmt(m.risk, 2)} · Objective: ${r.objective}`],
      ['Radiation dose', `${fmt(m.doseUsv, 1)} µSv`, `Limit: ${fmt(r.doseBudget, 0)} µSv (${r.enforceDose ? 'enforced' : 'advisory'}) · Terrain sky-block ${fmt(avgSkyShield, 1)}%`],
      ['Mission energy', `${fmt(m.energy, 2)} kWh`, `Usable budget: ${fmt(r.energyBudget, 2)} kWh · Margin: ${fmt(m.energyMargin, 2)} kWh`],
      ['Mission duration', `${fmt(m.hours, 2)} h`, `Usable autonomy: ${fmt(r.timeBudget, 2)} h · Eff. speed: ${fmt(r.effSpeedKmh, 2)} km/h`],
      ['Traverse distance', `${fmt(m.oneWayKm, 2)} km`, `Total ${fmt(m.missionKm, 2)} km · Max shelter dist: ${fmt(m.maxShelterKm, 2)} km`],
      ['Terrain extremes', `${fmt(m.maxSlopeDeg, 1)}° max`, `Max roughness: ${fmt(m.maxRoughnessM, 2)} m · Climb +${fmt(m.ascentM, 0)} / −${fmt(m.descentM, 0)} m`]
    ];
    $('metrics').innerHTML = cards.map(([a, b, c]) => `<div class="metric"><small>${a}</small><strong>${b}</strong><span>${c}</span></div>`).join('');

    drawProfile(r.profile);

    const rTot = (m.slopeRisk + m.roughRisk + m.radRisk + m.weatherRisk + m.thermalRisk + m.shelterRisk) || 1;
    $('risk-breakdown').innerHTML =
      `<div class="risk-bar">` +
      `<i style="width:${100 * m.slopeRisk / rTot}%" title="Slope"></i>` +
      `<i style="width:${100 * m.roughRisk / rTot}%" title="Roughness"></i>` +
      `<i style="width:${100 * m.radRisk / rTot}%" title="Radiation"></i>` +
      `<i style="width:${100 * m.weatherRisk / rTot}%" title="Weather"></i>` +
      `<i style="width:${100 * m.thermalRisk / rTot}%" title="Thermal"></i>` +
      `<i style="width:${100 * m.shelterRisk / rTot}%" title="Shelter"></i>` +
      `</div>` +
      `<b>Hazard breakdown:</b> Slope ${fmt(100 * m.slopeRisk / rTot, 0)}% · Roughness ${fmt(100 * m.roughRisk / rTot, 0)}% · Radiation ${fmt(100 * m.radRisk / rTot, 0)}% · Weather ${fmt(100 * m.weatherRisk / rTot, 0)}% · Thermal ${fmt(100 * m.thermalRisk / rTot, 0)}% · Shelter ${fmt(100 * m.shelterRisk / rTot, 0)}%`;

    const eTot = m.energy || 1;
    $('energy-breakdown').innerHTML =
      `<div class="energy-bar">` +
      `<i style="width:${100 * m.rolling / eTot}%"></i>` +
      `<i style="width:${100 * m.climb / eTot}%"></i>` +
      `<i style="width:${100 * m.hotel / eTot}%"></i>` +
      `</div>` +
      `<b>Energy breakdown:</b> Rolling ${fmt(m.rolling, 2)} · Ascent ${fmt(m.climb, 2)} · Life-support &amp; heating ${fmt(m.hotel, 2)} kWh`;
  } else {
    $('metrics').replaceChildren();
    $('profile').innerHTML = '<text x="20" y="105">No feasible route obtained under current constraints</text>';
    $('risk-breakdown').replaceChildren();
    $('energy-breakdown').replaceChildren();
  }

  const checkFeasible = x => x && x.energy <= r.energyBudget && x.hours <= r.timeBudget && (!r.enforceDose || x.doseUsv <= r.doseBudget);
  const rows = [
    ['Selected (' + r.objective + ')', m, r.status === 'optimal' ? '' : statuses[r.status], r.objective, true],
    ['Safest (unconstrained)', r.alternatives?.safest?.metrics, r.alternatives?.safest?.path?.length ? '' : 'No path', 'safest', false],
    ['Balanced (safety + energy)', r.alternatives?.balanced?.metrics, r.alternatives?.balanced?.path?.length ? '' : 'No path', 'balanced', false],
    ['Minimum energy', r.alternatives?.energy?.metrics, r.alternatives?.energy?.path?.length ? '' : 'No path', 'energy', false],
    ['Fastest transit', r.alternatives?.fastest?.metrics, r.alternatives?.fastest?.path?.length ? '' : 'No path', 'fastest', false],
    ['Shortest traversable', r.shortest?.metrics, r.shortest?.path?.length ? '' : 'No path', 'distance', false],
    ['Direct line A→B', r.direct?.metrics, r.direct?.status === 'blocked' ? 'Blocked hazard' : '', null, false]
  ];

  $('comparison').innerHTML = rows.map(([name, x, error, objKey, isSelected]) => {
    const good = !error && checkFeasible(x);
    return `<tr class="${isSelected ? 'selected' : ''}" ${objKey ? `data-obj="${objKey}" title="Click to optimize for ${objKey}"` : ''}>` +
      `<td>${name}</td>` +
      `<td>${x ? fmt(x.oneWayKm, 2) + ' km' : '—'}</td>` +
      `<td>${x ? fmt(x.energy, 2) + ' kWh' : '—'}</td>` +
      `<td>${x ? fmt(x.hours, 2) + ' h' : '—'}</td>` +
      `<td>${x ? fmt(x.doseUsv, 1) + ' µSv' : '—'}</td>` +
      `<td>${x ? fmt(x.maxSlopeDeg, 1) + '°' : '—'}</td>` +
      `<td>${x ? `<span class="badge-score">${fmt(x.safetyScore, 0)}</span>` : '—'}</td>` +
      `<td class="${good ? 'good' : 'bad'}">${error || (good ? 'Within all limits' : 'Exceeds budget')}</td>` +
      `</tr>`;
  }).join('');

  $('comparison').querySelectorAll('tr[data-obj]').forEach(tr => {
    tr.onclick = () => {
      const obj = tr.dataset.obj;
      if ($('objective-select').value !== obj) {
        $('objective-select').value = obj;
        calculate();
      }
    };
  });

  $('comparison-note').textContent = `Click any strategy row to switch the active optimizer. Grid snap offset: Point A ${fmt(r.snapMetres?.start, 1)} m, Point B ${fmt(r.snapMetres?.goal, 1)} m.`;

  if (r.status === 'optimal') {
    $('certificate').innerHTML =
      `<b>Graph optimality verified (${r.method}).</b><br>` +
      (r.verification
        ? `Objective (${r.verification.objective}) — A*: ${fmt(r.verification.costAStar, 6)} · Zero-heuristic Dijkstra: ${fmt(r.verification.costDijkstra, 6)} · Difference: ${r.verification.delta.toExponential(2)}.`
        : `Exact multi-resource Pareto search over nondominated (cost, energy, time${r.enforceDose ? ', dose' : ''}) labels · Active labels explored: ${r.labelCount?.toLocaleString('en-US')}.`) +
      `<br>Expanded states: ${r.expanded.toLocaleString('en-US')} on ${grid.width} × ${grid.height} NASA DEM graph (${fmt(grid.dx, 1)} m step).`;
  } else {
    $('certificate').textContent = r.status === 'search-limit'
      ? 'Computation cap reached before exhausting Pareto labels; relax budgets or shorten distance.'
      : 'No verified route selected under current mission constraints.';
  }

  $('export').disabled = false;
  $('print').disabled = false;
}

function drawProfile(points) {
  if (!points?.length) return;
  const pMode = $('profile-mode').value;
  const totalKm = points.at(-1).distanceKm || 0.001;
  const xOf = d => 52 + (d / totalKm) * 528;

  if (pMode === 'radiation') {
    const rates = points.map(p => p.doseRateUsvH), lo = Math.min(...rates), hi = Math.max(...rates);
    const maxCum = Math.max(1e-6, points.at(-1).cumDoseUsv);
    const ratePath = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.distanceKm).toFixed(1)},${(168 - (p.doseRateUsvH - lo) / (hi - lo || 1) * 128).toFixed(1)}`).join(' ');
    const cumPath = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.distanceKm).toFixed(1)},${(168 - (p.cumDoseUsv / maxCum) * 128).toFixed(1)}`).join(' ');
    $('profile').innerHTML =
      `<path d="${ratePath} L580,172 L52,172 Z" fill="#a974ff22"/>` +
      `<path d="${ratePath}" fill="none" stroke="#b993ff" stroke-width="2.2"/>` +
      `<path d="${cumPath}" fill="none" stroke="#5ee39c" stroke-width="2" stroke-dasharray="5,4"/>` +
      `<text x="6" y="34">${fmt(hi, 1)} µSv/h</text>` +
      `<text x="6" y="175">${fmt(lo, 1)} µSv/h</text>` +
      `<text x="52" y="204">A (0 km)</text>` +
      `<text x="220" y="204" fill="#5ee39c">--- Cum. transit ${fmt(maxCum, 1)} µSv</text>` +
      `<text x="495" y="204">B (${fmt(totalKm, 2)} km)</text>`;
    return;
  }

  if (pMode === 'terrain') {
    const slopes = points.map(p => p.slopeDeg), hiS = Math.max(safeValuesPreview().maxSlopeDeg, ...slopes);
    const roughs = points.map(p => p.roughnessM), hiR = Math.max(0.5, ...roughs);
    const sPath = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.distanceKm).toFixed(1)},${(168 - (p.slopeDeg / (hiS || 1)) * 128).toFixed(1)}`).join(' ');
    const rPath = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.distanceKm).toFixed(1)},${(168 - (p.roughnessM / (hiR || 1)) * 128).toFixed(1)}`).join(' ');
    $('profile').innerHTML =
      `<path d="${sPath} L580,172 L52,172 Z" fill="#e06d5324"/>` +
      `<path d="${sPath}" fill="none" stroke="#e06d53" stroke-width="2.2"/>` +
      `<path d="${rPath}" fill="none" stroke="#73c6ec" stroke-width="1.8" stroke-dasharray="4,4"/>` +
      `<text x="6" y="34">${fmt(hiS, 1)}°</text>` +
      `<text x="6" y="175">0°</text>` +
      `<text x="52" y="204">A (0 km)</text>` +
      `<text x="215" y="204" fill="#73c6ec">--- Roughness max ${fmt(hiR, 2)} m</text>` +
      `<text x="495" y="204">B (${fmt(totalKm, 2)} km)</text>`;
    return;
  }

  const z = points.map(p => p.elevationM), lo = Math.min(...z), hi = Math.max(...z);
  const elevPath = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.distanceKm).toFixed(1)},${(168 - (p.elevationM - lo) / (hi - lo || 1) * 128).toFixed(1)}`).join(' ');
  const hazDots = points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 45)) === 0).map(p => {
    const cx = xOf(p.distanceKm).toFixed(1), cy = (168 - (p.elevationM - lo) / (hi - lo || 1) * 128).toFixed(1);
    const col = p.hazardIndex > 0.6 ? '#ef6f5e' : p.hazardIndex > 0.3 ? '#f0c96b' : '#5ee39c';
    return `<circle cx="${cx}" cy="${cy}" r="3" fill="${col}"/>`;
  }).join('');
  $('profile').innerHTML =
    `<path d="${elevPath} L580,172 L52,172 Z" fill="#d6bb9122"/>` +
    `<path d="${elevPath}" fill="none" stroke="#e8c47e" stroke-width="2.2"/>` +
    hazDots +
    `<text x="6" y="34">${fmt(hi, 0)} m</text>` +
    `<text x="6" y="175">${fmt(lo, 0)} m</text>` +
    `<text x="52" y="204">Point A</text>` +
    `<text x="235" y="204">● low / med / high hazard</text>` +
    `<text x="485" y="204">B · ${fmt(totalKm, 2)} km</text>`;
}

bindMap(canvas, view, {
  getGrid: () => loadingRegion ? null : grid,
  getMode: () => mode,
  draw,
  pick: q => {
    if (!grid) return;
    const p = coordinates(grid, q.x * grid.width - 0.5, q.y * grid.height - 0.5);
    if (mode === 'zone') {
      if (exclusions.length >= 25) { $('status').textContent = 'Maximum of 25 exclusion zones reached.'; return; }
      exclusions.push({ ...p, radiusM: Math.round(Math.min(400, Math.max(25, grid.width * grid.dx * 0.05))) });
    } else if (mode === 'start') start = p;
    else goal = p;
    pointInputs();
    invalidate();
    calculate();
  },
  hover: q => {
    if (!grid) return;
    const x = Math.min(grid.width - 1, Math.max(0, Math.floor(q.x * grid.width)));
    const y = Math.min(grid.height - 1, Math.max(0, Math.floor(q.y * grid.height)));
    const i = y * grid.width + x;
    const dose = report?.doseRate ? report.doseRate[i] : cellDoseRateUsvH(grid, safeValuesPreview(), i);
    const haz = report?.cellHazard ? report.cellHazard[i] * 100 : NaN;
    $('map-hover').textContent = `${fmt(grid.values[i], 1)} m · slope ${fmt(grid.slopes[i], 1)}° · rough ${fmt(grid.roughness?.[i], 2)} m · ${fmt(dose, 1)} µSv/h${Number.isFinite(haz) ? ' · risk ' + fmt(haz, 0) + '%' : ''}`;
  }
});

function setExpanded(on, persist = true) {
  document.body.classList.toggle('map-expanded', on);
  if (persist) { try { localStorage.setItem('ares-map-expanded', on ? '1' : '0'); } catch {} }
  for (const id of ['expand-map', 'expand-map-nav']) {
    const b = $(id);
    if (!b) continue;
    b.setAttribute('aria-pressed', String(on));
    if (id === 'expand-map') b.textContent = on ? '⤡ Compact layout' : '⤢ Expand map';
  }
  requestAnimationFrame(() => { draw(); updateZoomBadge(); });
}

$('expand-map').onclick = () => setExpanded(!document.body.classList.contains('map-expanded'));
$('expand-map-nav').onclick = () => {
  setExpanded(!document.body.classList.contains('map-expanded'));
  $('map-stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
};
function setMaximized(on) {
  document.body.classList.toggle('map-maximized', on);
  $('fullscreen-map').textContent = on ? '⤡ Exit full screen' : '⛶ Full screen';
  requestAnimationFrame(() => { draw(); updateZoomBadge(); });
}
$('fullscreen-map').onclick = () => {
  const on = !document.body.classList.contains('map-maximized');
  setMaximized(on);
  const stage = $('map-stage');
  if (on) {
    // The CSS overlay always fills the viewport; native fullscreen is a best-effort bonus.
    try { stage.requestFullscreen?.()?.catch?.(() => {}); } catch {}
  } else if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.body.classList.contains('map-maximized')) {
    setMaximized(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }
});
document.addEventListener('fullscreenchange', () => { requestAnimationFrame(() => { draw(); updateZoomBadge(); }); });

$('mission-region').onchange = () => loadRegion(regions.find(r => r.id === $('mission-region').value));

$('preset-select').onchange = () => {
  const key = $('preset-select').value;
  if (key !== 'custom') {
    applyPresetValues(key);
    syncFormWithClimate();
    invalidate();
    calculate();
  }
};

$('solar-scenario').onchange = () => {
  const s = SOLAR_SCENARIOS[$('solar-scenario').value];
  if (s) {
    form.elements.gcrBaseUsvH.value = String(s.gcrBaseUsvH);
    form.elements.speUsvH.value = String(s.speUsvH);
    invalidate();
    calculate();
  }
};

for (const k of ['gcrBaseUsvH', 'speUsvH']) {
  form.elements[k].addEventListener('input', () => { $('solar-scenario').value = 'custom'; });
}

document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
  if (!grid || loadingRegion) return;
  mode = b.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach(el => {
    el.classList.toggle('active', el === b);
    el.setAttribute('aria-pressed', String(el === b));
  });
  canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
  const radM = Math.round(Math.min(400, Math.max(25, grid.width * grid.dx * 0.05)));
  $('pick-help').textContent = mode === 'pan'
    ? `Drag to pan; scroll or use +/− to zoom up to ${MAX_ZOOM}×.`
    : mode === 'zone'
    ? `Click on the map to place a ${radM} m hazard exclusion zone (auto-replans).`
    : `Click anywhere on the NASA terrain to place ${mode === 'start' ? 'Point A (Start)' : 'Point B (Target)'} (${fmt(grid.dx, 1)} m grid snap).`;
});

$('swap-points').onclick = () => {
  if (!start || !goal || loadingRegion) return;
  [start, goal] = [goal, start];
  pointInputs();
  invalidate();
  calculate();
};

form.onsubmit = e => { e.preventDefault(); calculate(); };
form.addEventListener('input', e => {
  if (e.target.id !== 'preset-select' && e.target.id !== 'solar-scenario' && e.target.id !== 'season' && e.target.id !== 'hour') {
    if (e.target.name && e.target.name !== 'objective' && !e.target.name.startsWith('w')) $('preset-select').value = 'custom';
    invalidate();
  }
});
$('objective-select').onchange = () => calculate();

for (const id of ['map-layer', 'show-blocked', 'show-direct', 'show-shortest', 'show-safest', 'show-energy', 'show-shelter', 'show-search']) {
  $(id).onchange = () => { baseImage = null; draw(); };
}
$('profile-mode').onchange = () => { if (report?.profile) drawProfile(report.profile); };

for (const id of ['season', 'hour']) {
  $(id).onchange = async () => {
    try { await loadClimate(true); invalidate(); await calculate(); } catch {}
  };
}
$('sync-climate').onclick = () => { syncFormWithClimate(); invalidate(); calculate(); };

$('apply-points').onclick = () => {
  if (!grid || loadingRegion) return;
  const points = ['start', 'goal'].map(name => ({ lat: Number($(name + '-lat').value), lon: Number($(name + '-lon').value) }));
  if (points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) {
    $('status').textContent = 'Enter valid latitude/longitude coordinates.';
    return;
  }
  [start, goal] = points;
  pointInputs();
  invalidate();
  calculate();
};

$('clear-zones').onclick = () => { exclusions = []; pointInputs(); invalidate(); calculate(); };

$('demo').onclick = async () => {
  if (!dem || loadingRegion) return;
  form.reset();
  $('preset-select').value = 'crewed-rover';
  $('solar-scenario').value = 'quiet';
  applyPresetValues('crewed-rover');
  start = { ...dem.anchors.start };
  goal = { ...dem.anchors.goal };
  exclusions = [];
  pointInputs();
  try { await loadClimate(true); await calculate(); } catch {}
};

$('jury-toggle').onclick = () => {
  const on = document.body.classList.toggle('jury-mode');
  $('jury-toggle').setAttribute('aria-pressed', String(on));
  requestAnimationFrame(() => { draw(); updateZoomBadge(); });
};
$('print').onclick = () => window.print();

$('export').onclick = () => {
  if (!report) return;
  const { visited, blocked, doseRate, cellHazard, ...clean } = report;
  const cleanAlts = report.alternatives
    ? Object.fromEntries(Object.entries(report.alternatives).map(([k, v]) => [k, { status: v.status, metrics: v.metrics, waypointCount: v.path?.length || 0 }]))
    : null;
  const output = {
    schema: 'ares-safe-route/2',
    generatedAt: new Date().toISOString(),
    scope: `Finite 8-neighbour multi-hazard graph at ${fmt(grid.dx, 2)} m spacing on measured NASA DEM. Model optimality verified against Dijkstra / exact Pareto labels; not certified flight software.`,
    region,
    input: { start, goal, exclusions },
    terrain: {
      source: dem.provenance,
      bounds: dem.bounds,
      elevationRangeM: [grid.minElevationM, grid.maxElevationM],
      aggregation: `${grid.factor}x${grid.factor} mean elevation; max native slope; 3x3 Laplacian roughness; 8-azimuth horizon sky-view shielding; strict NoData & diagonal corner blocking`
    },
    climate,
    report: { ...clean, alternatives: cleanAlts },
    elapsedMs
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `ares-safe-route-${region.id}-${report.objective}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

$('retry').onclick = load;
updateZoomBadge();
try { if (localStorage.getItem('ares-map-expanded') === '1') setExpanded(true, false); } catch {}
load();
