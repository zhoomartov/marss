import { DEFAULTS, PRESETS, SOLAR_SCENARIOS, parameters, coordinates, gridPosition, metres, cellDoseRateUsvH } from './rover-core.js';
import { validateClimate, sampleClimate, FIELDS } from './environment.js';
import { MapView, bindMap } from './rover-map.js';

const TERRAIN_LAB_URL=(typeof localStorage!=='undefined'&&localStorage.getItem('ares-terrain-lab-url'))||'http://127.0.0.1:4174';
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
let waypoints = [], pickIndex = null, exclusions = [], mode = 'pan', epoch = 0, busy = false, elapsedMs = 0;
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

function waypointName(i, count = waypoints.length) {
  return i === 0 ? 'Point A' : i === count - 1 ? 'Point B' : 'Stop ' + i;
}

function waypointBadge(i, count = waypoints.length) {
  return i === 0 ? 'A' : i === count - 1 ? 'B' : String(i);
}

function chainKm() {
  if (!grid || waypoints.length < 2) return 0;
  let km = 0;
  for (let i = 1; i < waypoints.length; i++) km += metres(waypoints[i - 1], waypoints[i], grid.projection.radius);
  return km / 1000;
}

function updatePointSummary() {
  const start = waypoints[0];
  if (start) $('terrain-lab-link').href = TERRAIN_LAB_URL + '/?' + new URLSearchParams({lat:start.lat.toFixed(4),lon:start.lon.toFixed(4),span:'1',name:region?.name || 'Jezero Mission Zone'});

  const stops = Math.max(0, waypoints.length - 2);
  $('point-summary').textContent = waypoints.length < 2
    ? 'Add at least Point A and Point B.'
    : `Ordered mission: A → ${stops} intermediate stop${stops === 1 ? '' : 's'} → B · ${waypoints.length - 1} optimized leg${waypoints.length === 2 ? '' : 's'} · Great-circle chain ${fmt(chainKm(), 2)} km · Exclusions: ${exclusions.length}.`;
}

function renderWaypoints() {
  const list = $('waypoint-list');
  if (!list) return;
  const last = waypoints.length - 1;
  list.innerHTML = waypoints.map((p, i) => {
    const name = waypointName(i), badge = waypointBadge(i), intermediate = i > 0 && i < last;
    return `<div class="waypoint-row${i === pickIndex ? ' picking' : ''}" data-index="${i}">` +
      `<span class="wp-badge${intermediate ? ' wp-stop' : ''}" title="${name}">${badge}</span>` +
      `<span class="wp-role">${i === 0 ? 'Start' : i === last ? 'Destination' : 'Stop ' + i}</span>` +
      `<label>Lat °N<input type="number" step="0.0001" data-wp="${i}" data-k="lat" value="${p.lat.toFixed(7)}" aria-label="${name} latitude"></label>` +
      `<label>Lon °E<input type="number" step="0.0001" data-wp="${i}" data-k="lon" value="${p.lon.toFixed(7)}" aria-label="${name} longitude"></label>` +
      `<button type="button" class="wp-pick" data-pick="${i}" title="Place ${name} on the map">◎ Pick</button>` +
      `<button type="button" class="wp-remove" data-remove="${i}" title="Remove this stop"${intermediate ? '' : ' disabled'}>✕</button>` +
      `</div>`;
  }).join('');
  updatePointSummary();
}

function clearResults(message) {
  report = null; epoch++;
  $('export').disabled = $('print').disabled = $('open-3d').disabled = true;
  $('result-title').textContent = 'Recalculation required';
  $('result-description').textContent = message;
  $('metrics').replaceChildren();
  $('comparison').innerHTML = '<tr><td colspan="8">' + message + '</td></tr>';
  $('certificate').textContent = 'Optimality has not been verified for the updated parameters.';
  $('profile').innerHTML = '<text x="20" y="105">Recalculate the route to view telemetry</text>';
  $('legs').innerHTML = '<tr><td colspan="8">Awaiting calculation…</td></tr>';
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
        updatePointSummary();
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
    waypoints = [{ ...dem.anchors.start }, { ...dem.anchors.goal }];
    pickIndex = null;

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
          waypoints = [qs, qg];
        } else {
          $('region-description').textContent += ' Selected Atlas endpoints lie outside this DEM footprint; default zone anchors are loaded.';
        }
      }
    }

    renderWaypoints();
    activateMode('pan');
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
    const stops = Math.max(0, waypoints.length - 2);
    $('status').textContent = `Optimizing (${p.objective}) across ${stops ? stops + ' stops / ' : ''}${waypoints.length - 1} legs on ${grid.width}×${grid.height} NASA terrain graph…`;
    if (!workerReady || (busy && worker._running)) await launchWorker();
    if (id !== epoch) return;
    worker._running = true;
    worker.postMessage({ type: 'plan', id, waypoints: waypoints.map(w => ({ lat: w.lat, lon: w.lon })), parameters: p, exclusions });
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
  if (!grid || waypoints.length < 2) return;
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
    const p = safeValuesPreview(), qs = gridPosition(grid, waypoints[0]);
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

  waypoints.forEach((p, i) => {
    const q = gridPosition(grid, p);
    if (q.x < 0 || q.y < 0 || q.x >= grid.width || q.y >= grid.height) return;
    const x = (q.x + 0.5) * sx, y = (q.y + 0.5) * sy;
    const intermediate = i > 0 && i < waypoints.length - 1;
    const color = i === 0 ? '#67e8b5' : i === waypoints.length - 1 ? '#ffdc7a' : '#73c6ec';
    const radius = (intermediate ? 12 : 15) / view.zoom;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = '#0e1b25';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 / view.zoom;
    ctx.stroke();
    ctx.font = 'bold ' + ((intermediate ? 12 : 15) / view.zoom) + 'px Arial';
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(waypointBadge(i), x, y);
  });
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
    'blocked-endpoint': 'A waypoint lies on blocked terrain',
    'search-limit': 'Pareto search limit reached'
  };
  $('result-title').textContent = statuses[r.status] || r.status;
  $('status').textContent = `${statuses[r.status] || r.status} · ${fmt(elapsedMs / 1000, 2)} s`;

  const legCount = r.legs?.length || 1;
  const stopCount = Math.max(0, (r.waypoints?.length || waypoints.length) - 2);
  $('result-description').textContent = r.status === 'optimal'
    ? `Verified ${r.objective} traverse through ${(r.waypoints?.length || waypoints.length)} ordered waypoints (${legCount} leg${legCount === 1 ? '' : 's'}, ${stopCount} intermediate stop${stopCount === 1 ? '' : 's'}) · ${r.assumptions.roundTrip ? 'round trip B→A' : 'one-way A→B'} + ${fmt(r.assumptions.stopHours, 1)} h per surface stop. Effective speed under current weather/illumination: ${fmt(r.effSpeedKmh, 2)} km/h (visibility ~${fmt(r.weather?.visibilityKm, 1)} km).`
    : r.reason || (r.status === 'blocked-endpoint'
      ? 'Move the affected waypoint away from steep scarps, excessive roughness, exclusion circles, or weather abort conditions.'
      : r.status === 'no-path'
      ? 'No connected corridor satisfies the slope, roughness, shelter-range, and weather cutoffs through every waypoint inside this DEM footprint.'
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
    ['Direct line via waypoints', r.direct?.metrics, r.direct?.status === 'blocked' ? 'Blocked hazard' : '', null, false]
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

  $('comparison-note').textContent = `Click any strategy row to switch the active optimizer. Grid snap offsets across ${r.waypoints?.length || waypoints.length} waypoints: worst ${fmt(Math.max(0, ...(r.snapMetres || [])), 1)} m.`;

  if (r.status === 'optimal') {
    const v = r.verification, perLeg = v?.perLeg || [];
    $('certificate').innerHTML =
      `<b>Graph optimality verified (${r.method}).</b><br>` +
      (v && perLeg.length > 1
        ? `Objective (${v.objective}) across ${perLeg.length} legs — A* total: ${fmt(v.costAStar, 6)} · zero-heuristic Dijkstra total: ${fmt(v.costDijkstra, 6)} · worst per-leg gap: ${v.delta.toExponential(2)}.`
        : v
        ? `Objective (${v.objective}) — A*: ${fmt(v.costAStar, 6)} · Zero-heuristic Dijkstra: ${fmt(v.costDijkstra, 6)} · Difference: ${v.delta.toExponential(2)}.`
        : `Sequential resource-constrained search over nondominated (cost, energy, time${r.enforceDose ? ', dose' : ''}) labels with a lower-bound reserve for every remaining leg · Active labels explored: ${r.labelCount?.toLocaleString('en-US')}.`) +
      `<br>Expanded states: ${r.expanded.toLocaleString('en-US')} on ${grid.width} × ${grid.height} NASA DEM graph (${fmt(grid.dx, 1)} m step).`;
  } else {
    $('certificate').textContent = r.status === 'search-limit'
      ? 'Computation cap reached before exhausting Pareto labels; relax budgets or shorten the mission.'
      : 'No verified route selected under current mission constraints.';
  }

  const legs = r.legs || [];
  const nodeCount = r.waypoints?.length || waypoints.length;
  $('legs').innerHTML = legs.length ? legs.map((leg, i) => {
    const x = leg.metrics, ok = leg.status === 'optimal' && x;
    return `<tr>` +
      `<td>${i + 1}</td>` +
      `<td>${waypointName(leg.from ?? i, nodeCount)} → ${waypointName(leg.to ?? i + 1, nodeCount)}</td>` +
      `<td>${x ? fmt(x.oneWayKm, 2) + ' km' : '—'}</td>` +
      `<td>${x ? fmt(x.energy, 2) + ' kWh' : '—'}</td>` +
      `<td>${x ? fmt(x.hours, 2) + ' h' : '—'}</td>` +
      `<td>${x ? fmt(x.doseUsv, 1) + ' µSv' : '—'}</td>` +
      `<td>${x ? fmt(x.maxSlopeDeg, 1) + '°' : '—'}</td>` +
      `<td class="${ok ? 'good' : 'bad'}">${ok ? 'Optimal' : 'No path'}</td>` +
      `</tr>`;
  }).join('') : '<tr><td colspan="8">No legs available for this waypoint chain.</td></tr>';

  const sumOf = key => legs.reduce((s, leg) => s + (leg.metrics?.[key] || 0), 0);
  const missionComplete = r.status === 'optimal' && legs.length === nodeCount - 1;
  $('legs-note').textContent = missionComplete
    ? `Sum of ${legs.length} leg${legs.length === 1 ? '' : 's'}: ${fmt(sumOf('oneWayKm'), 2)} km · ${fmt(sumOf('energy'), 2)} kWh · ${fmt(sumOf('hours'), 2)} h · ${fmt(sumOf('doseUsv'), 1)} µSv — equal to mission totals. Each leg ends with a ${fmt(r.assumptions.stopHours, 1)} h surface stop; the final leg’s stop is the destination.`
    : legs.length
    ? `Only ${legs.length} of ${nodeCount - 1} legs were solved before the mission became ${r.status === 'infeasible' ? 'infeasible' : 'untraversable'}; these partial totals are not a complete mission.`
    : 'Each leg is optimized independently in waypoint order; per-leg energy, time, and dose include that leg’s destination surface stop, so they sum to the mission totals.';

  $('export').disabled = false;
  $('print').disabled = false;
  $('open-3d').disabled = !r.path?.length;
}

function drawProfile(points) {
  if (!points?.length) return;
  const pMode = $('profile-mode').value;
  const totalKm = points.at(-1).distanceKm || 0.001;
  const xOf = d => 52 + (d / totalKm) * 528;
  const wpTicks = (report?.waypointDistancesKm || []).slice(1, -1).map((km, i) => {
    const x = xOf(km).toFixed(1);
    return `<line x1="${x}" y1="32" x2="${x}" y2="172" stroke="#73c6ec99" stroke-dasharray="3,4"/>` +
      `<text x="${x}" y="27" fill="#9fd8f2" text-anchor="middle">${i + 1}</text>`;
  }).join('');

  if (pMode === 'radiation') {
    const rates = points.map(p => p.doseRateUsvH), lo = Math.min(...rates), hi = Math.max(...rates);
    const maxCum = Math.max(1e-6, points.at(-1).cumDoseUsv);
    const ratePath = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.distanceKm).toFixed(1)},${(168 - (p.doseRateUsvH - lo) / (hi - lo || 1) * 128).toFixed(1)}`).join(' ');
    const cumPath = points.map((p, i) => `${i ? 'L' : 'M'}${xOf(p.distanceKm).toFixed(1)},${(168 - (p.cumDoseUsv / maxCum) * 128).toFixed(1)}`).join(' ');
    $('profile').innerHTML =
      `<path d="${ratePath} L580,172 L52,172 Z" fill="#a974ff22"/>` +
      `<path d="${ratePath}" fill="none" stroke="#b993ff" stroke-width="2.2"/>` +
      `<path d="${cumPath}" fill="none" stroke="#5ee39c" stroke-width="2" stroke-dasharray="5,4"/>` +
      wpTicks +
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
      wpTicks +
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
    wpTicks +
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
    } else if (mode === 'start' && waypoints.length >= 2) {
      waypoints[0] = p;
    } else if (mode === 'goal' && waypoints.length >= 2) {
      waypoints[waypoints.length - 1] = p;
    } else if (mode === 'stop' && waypoints.length >= 2) {
      waypoints.splice(waypoints.length - 1, 0, p);
    } else if (mode === 'waypoint' && pickIndex !== null && pickIndex < waypoints.length) {
      waypoints[pickIndex] = p;
      pickIndex = null;
      activateMode('pan');
    } else {
      return;
    }
    renderWaypoints();
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
  activateMode(b.dataset.mode);
});

function activateMode(next, index = null) {
  mode = next;
  pickIndex = next === 'waypoint' ? index : null;
  document.querySelectorAll('[data-mode]').forEach(el => {
    const on = el.dataset.mode === next;
    el.classList.toggle('active', on);
    el.setAttribute('aria-pressed', String(on));
  });
  document.querySelectorAll('.waypoint-row').forEach(row => {
    row.classList.toggle('picking', index !== null && Number(row.dataset.index) === index);
  });
  canvas.style.cursor = next === 'pan' ? 'grab' : 'crosshair';
  const step = fmt(grid?.dx ?? 20, 1);
  const radM = grid ? Math.round(Math.min(400, Math.max(25, grid.width * grid.dx * 0.05))) : 30;
  $('pick-help').textContent = next === 'pan'
    ? `Drag to pan; scroll or use +/− to zoom up to ${MAX_ZOOM}×.`
    : next === 'zone'
    ? `Click on the map to place a ${radM} m hazard exclusion zone (auto-replans).`
    : next === 'stop'
    ? `Click the NASA terrain to append an intermediate stop before B; each click adds the next ordered waypoint (${step} m grid snap).`
    : next === 'waypoint'
    ? `Click the NASA terrain to place ${waypointName(index)} (${step} m grid snap).`
    : `Click anywhere on the NASA terrain to place ${next === 'start' ? 'Point A (Start)' : 'Point B (Destination)'} (${step} m grid snap).`;
}

function startPicker(index) {
  if (!grid || loadingRegion) return;
  activateMode('waypoint', index);
  $('map-stage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function removeWaypoint(index) {
  if (loadingRegion || index <= 0 || index >= waypoints.length - 1) return;
  waypoints.splice(index, 1);
  if (pickIndex !== null) {
    if (pickIndex === index) { pickIndex = null; activateMode('pan'); }
    else if (pickIndex > index) pickIndex--;
  }
  renderWaypoints();
  invalidate();
  calculate();
}

$('waypoint-list').addEventListener('input', e => {
  const el = e.target.closest('[data-wp]');
  if (!el) return;
  const i = Number(el.dataset.wp), k = el.dataset.k, v = Number(el.value);
  if (!waypoints[i] || !Number.isFinite(v) || Math.abs(v) > (k === 'lat' ? 90 : 180)) return;
  waypoints[i][k] = v;
  updatePointSummary();
});

$('waypoint-list').addEventListener('click', e => {
  const pick = e.target.closest('[data-pick]');
  if (pick) { startPicker(Number(pick.dataset.pick)); return; }
  const remove = e.target.closest('[data-remove]');
  if (remove && !remove.disabled) removeWaypoint(Number(remove.dataset.remove));
});

$('add-stop').onclick = () => {
  if (!grid || loadingRegion) return;
  let insertAt = waypoints.length - 1;
  let p = null;
  // Insert at the midpoint of the longest leg of the active verified path: guaranteed traversable,
  // roughly equidistant from its neighbours, and ordered correctly inside the mission chain.
  const path = report?.path || [], fixed = report?.nodes || [];
  if (path.length > 2 && fixed.length === waypoints.length) {
    const pos = fixed.map(n => path.indexOf(n));
    let bestK = -1, bestLen = 0;
    if (pos.every(i => i >= 0)) {
      for (let k = 0; k + 1 < pos.length; k++) {
        const len = pos[k + 1] - pos[k];
        if (len > bestLen) { bestLen = len; bestK = k; }
      }
    }
    if (bestK >= 0 && bestLen > 1) {
      const node = path[Math.floor((pos[bestK] + pos[bestK + 1]) / 2)];
      if (!fixed.includes(node)) {
        p = coordinates(grid, node % grid.width, Math.floor(node / grid.width));
        insertAt = bestK + 1;
      }
    }
  }
  if (!p) {
    const a = waypoints[waypoints.length - 2], b = waypoints[waypoints.length - 1];
    p = { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
  }
  waypoints.splice(insertAt, 0, p);
  pickIndex = null;
  renderWaypoints();
  invalidate();
  calculate();
};

$('reverse-waypoints').onclick = () => {
  if (loadingRegion || waypoints.length < 2) return;
  waypoints.reverse();
  pickIndex = null;
  activateMode('pan');
  renderWaypoints();
  invalidate();
  calculate();
};

$('clear-stops').onclick = () => {
  if (loadingRegion || waypoints.length < 2) return;
  if (waypoints.length === 2) { $('status').textContent = 'The mission already has no intermediate stops.'; return; }
  waypoints = [waypoints[0], waypoints[waypoints.length - 1]];
  pickIndex = null;
  activateMode('pan');
  renderWaypoints();
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
  const rows = [...$('waypoint-list').querySelectorAll('.waypoint-row')];
  const cellOf = p => {
    const q = gridPosition(grid, p);
    return Math.round(q.x) + ',' + Math.round(q.y);
  };
  const points = rows.map((row, i) => {
    const p = {
      lat: Number(row.querySelector('[data-k="lat"]').value),
      lon: Number(row.querySelector('[data-k="lon"]').value)
    };
    // An untouched row keeps its full-precision coordinate when the displayed value still lands in the same cell.
    const prev = waypoints[i];
    if (prev && Number.isFinite(p.lat) && Number.isFinite(p.lon) && cellOf(p) === cellOf(prev)) return { ...prev };
    return p;
  });
  if (points.length < 2 || points.some(p => !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180)) {
    $('status').textContent = 'Enter valid latitude/longitude coordinates for every waypoint.';
    return;
  }
  waypoints = points;
  pickIndex = null;
  activateMode('pan');
  renderWaypoints();
  invalidate();
  calculate();
};

$('clear-zones').onclick = () => { exclusions = []; updatePointSummary(); invalidate(); calculate(); };

$('demo').onclick = async () => {
  if (!dem || loadingRegion) return;
  form.reset();
  $('preset-select').value = 'crewed-rover';
  $('solar-scenario').value = 'quiet';
  applyPresetValues('crewed-rover');
  waypoints = [{ ...dem.anchors.start }, { ...dem.anchors.goal }];
  pickIndex = null;
  exclusions = [];
  activateMode('pan');
  renderWaypoints();
  try { await loadClimate(true); await calculate(); } catch {}
};

$('jury-toggle').onclick = () => {
  const on = document.body.classList.toggle('jury-mode');
  $('jury-toggle').setAttribute('aria-pressed', String(on));
  requestAnimationFrame(() => { draw(); updateZoomBadge(); });
};
$('open-3d').onclick=async()=>{if(!report||!report.path?.length){$('status').textContent='Calculate a feasible route first.';return;}const btn=$('open-3d'),orig=btn.textContent;btn.disabled=true;btn.textContent='Передаю маршрут…';try{const points=report.profile.map(p=>({lat:p.lat,lon:p.lon,elevM:p.elevationM,distKm:p.distanceKm,slopeDeg:p.slopeDeg}));const direct=(report.direct?.path||[]).map(i=>({lat:grid.coords[i].lat,lon:grid.coords[i].lon,elevM:grid.values?.[i]??null}));const body={name:`${region?.name||'Mars'} · ${new Date().toLocaleString('ru-RU')}`,source:'ARES Safe Route Lab',region:region?.name||null,status:report.status,points,direct,metrics:{oneWayKm:report.metrics?.oneWayKm,energy:report.metrics?.energy,maxSlopeDeg:report.metrics?.maxSlopeDeg}};const res=await fetch(TERRAIN_LAB_URL+'/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!res.ok)throw Error((await res.json().catch(()=>({}))).error||('HTTP '+res.status));const data=await res.json();window.open(`${TERRAIN_LAB_URL}/?route=${encodeURIComponent(data.route.id)}`,'_blank','noopener');btn.textContent='Открыто 3D ↗';setTimeout(()=>{btn.textContent=orig;btn.disabled=false;},1500);}catch(err){btn.textContent=orig;btn.disabled=false;$('status').textContent='3D export failed: '+err.message;}};
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
    input: { waypoints: report.waypoints || waypoints, exclusions },
    mission: {
      waypoints: report.waypoints || waypoints,
      stopsCount: Math.max(0, (report.waypoints?.length || waypoints.length) - 2),
      waypointDistancesKm: report.waypointDistancesKm || [],
      legs: report.legs || []
    },
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
