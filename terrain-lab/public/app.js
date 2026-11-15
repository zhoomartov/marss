import * as THREE from 'three';
import { OrbitControls } from './assets/OrbitControls.js';
import {
  normalizeLon,
  clampLat,
  clampSpan,
  canvasPointToLatLon,
  latLonToCanvasPoint,
} from './mars-coords.js';

const $ = (id) => document.getElementById(id);

// Application State
const state = {
  atlasUrl: 'http://127.0.0.1:4173',
  lat: 18.65,
  lon: -133.8,
  spanDeg: 11,
  name: 'Olympus Mons',
  layer: 'viking',
  verticalExaggeration: 4,
  sunAzimuthDeg: 315,
  profileMode: 'ew',
  showPins: true,
  showSlice: true,
  wireframe: false,
  activeTab: 'featured',
  catalog: {
    featured: [],
    custom: [],
    official: [],
    totalOfficial: 0,
  },
  terrainMeta: null,
  stats: null,
  hasMesh: false,
  profile: [],
  pins: [],
  hoverPoint: null,
  probePoint: null,
  requestEpoch: 0,
};

// Parse incoming deep-link query params (?lat=...&lon=...&span=...&name=...&layer=...)
function readInitialParams() {
  const q = new URLSearchParams(window.location.search);
  if (q.has('lat') && q.has('lon')) {
    const lat = Number(q.get('lat'));
    const lon = Number(q.get('lon'));
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      state.lat = clampLat(lat, 86);
      state.lon = normalizeLon(lon);
      state.spanDeg = clampSpan(Number(q.get('span') || 3));
      state.name = q.get('name')?.trim() || `${Math.abs(state.lat).toFixed(2)}°${state.lat >= 0 ? 'N' : 'S'}, ${Math.abs(state.lon).toFixed(2)}°${state.lon >= 0 ? 'E' : 'W'}`;
    }
  }
  if (q.has('layer')) {
    state.layer = q.get('layer');
  }
}

function formatCoord(lat, lon) {
  return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
}

function syncReturnLinks() {
  const q = new URLSearchParams({
    lat: state.lat.toFixed(4),
    lon: state.lon.toFixed(4),
    name: state.name,
  });
  $('atlas-home-link').href = `${state.atlasUrl}/?${q}#mars`;
  $('open-in-atlas-map').href = `${state.atlasUrl}/?${q}#map`;
  $('open-in-atlas-globe').href = `${state.atlasUrl}/?${q}#mars`;

  const roverQ = new URLSearchParams({
    startLat: state.lat.toFixed(5),
    startLon: state.lon.toFixed(5),
  });
  $('open-in-rover').href = `${state.atlasUrl}/rover.html?${roverQ}`;

  const selfQ = new URLSearchParams({
    lat: state.lat.toFixed(4),
    lon: state.lon.toFixed(4),
    span: String(state.spanDeg),
    name: state.name,
    layer: state.layer,
  });
  window.history.replaceState(null, '', `?${selfQ}`);

  $('active-target-label').textContent = `${state.name.toUpperCase()} · ${formatCoord(state.lat, state.lon)}`;
}

// ============================================================================
// 1. 2D Global Mars Equirectangular Canvas
// ============================================================================
const mapCanvas = $('mars-canvas');
const mapCtx = mapCanvas.getContext('2d');
const globalMarsImg = new Image();
let globalImgLoaded = false;
globalMarsImg.onload = () => {
  globalImgLoaded = true;
  draw2DMap();
};
globalMarsImg.src = './assets/mars.jpg';

function draw2DMap() {
  const w = mapCanvas.width;
  const h = mapCanvas.height;
  mapCtx.clearRect(0, 0, w, h);

  if (globalImgLoaded) {
    mapCtx.drawImage(globalMarsImg, 0, 0, w, h);
  } else {
    mapCtx.fillStyle = '#241512';
    mapCtx.fillRect(0, 0, w, h);
  }

  // Subtle dark tint for marker legibility
  mapCtx.fillStyle = 'rgba(5, 10, 16, 0.18)';
  mapCtx.fillRect(0, 0, w, h);

  // Graticule lines every 30 degrees
  mapCtx.strokeStyle = 'rgba(220, 232, 248, 0.14)';
  mapCtx.lineWidth = 1;
  mapCtx.beginPath();
  for (let lon = -150; lon <= 150; lon += 30) {
    const x = ((lon + 180) / 360) * w;
    mapCtx.moveTo(x, 0);
    mapCtx.lineTo(x, h);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * h;
    mapCtx.moveTo(0, y);
    mapCtx.lineTo(w, y);
  }
  mapCtx.stroke();

  // Equator & Prime Meridian slightly stronger
  mapCtx.strokeStyle = 'rgba(239, 214, 171, 0.28)';
  mapCtx.beginPath();
  mapCtx.moveTo(0, h / 2);
  mapCtx.lineTo(w, h / 2);
  mapCtx.moveTo(w / 2, 0);
  mapCtx.lineTo(w / 2, h);
  mapCtx.stroke();

  // Plot official USGS Mars features (subtle warm dots)
  mapCtx.fillStyle = 'rgba(239, 214, 171, 0.34)';
  for (const item of state.catalog.official) {
    const p = latLonToCanvasPoint(item.lat, item.lon, w, h);
    mapCtx.fillRect(p.x - 0.8, p.y - 0.8, 1.6, 1.6);
  }

  // Plot custom user points (emerald diamonds/circles)
  for (const item of state.catalog.custom) {
    const p = latLonToCanvasPoint(item.lat, item.lon, w, h);
    mapCtx.beginPath();
    mapCtx.arc(p.x, p.y, 4.2, 0, Math.PI * 2);
    mapCtx.fillStyle = '#0b1822';
    mapCtx.fill();
    mapCtx.lineWidth = 2;
    mapCtx.strokeStyle = '#7cd4a6';
    mapCtx.stroke();
  }

  // Plot active terrain BBOX & center crosshair
  const b = state.terrainMeta?.bounds;
  if (b) {
    const nw = latLonToCanvasPoint(b.north, b.west, w, h);
    const se = latLonToCanvasPoint(b.south, b.east, w, h);
    const bw = Math.max(5, se.x - nw.x);
    const bh = Math.max(5, se.y - nw.y);

    mapCtx.fillStyle = 'rgba(239, 214, 171, 0.16)';
    mapCtx.fillRect(nw.x - (bw === 5 ? 2.5 : 0), nw.y - (bh === 5 ? 2.5 : 0), bw, bh);
    mapCtx.strokeStyle = '#efd6ab';
    mapCtx.lineWidth = 1.8;
    mapCtx.strokeRect(nw.x - (bw === 5 ? 2.5 : 0), nw.y - (bh === 5 ? 2.5 : 0), bw, bh);
  }

  const centerPt = latLonToCanvasPoint(state.lat, state.lon, w, h);
  mapCtx.beginPath();
  mapCtx.arc(centerPt.x, centerPt.y, 5, 0, Math.PI * 2);
  mapCtx.strokeStyle = '#ffdf9a';
  mapCtx.lineWidth = 2;
  mapCtx.stroke();

  // If user is hovering on the SVG profile, show exact point on 2D map too
  if (state.hoverPoint) {
    const hp = latLonToCanvasPoint(state.hoverPoint.lat, state.hoverPoint.lon, w, h);
    mapCtx.beginPath();
    mapCtx.arc(hp.x, hp.y, 3.5, 0, Math.PI * 2);
    mapCtx.fillStyle = '#7cd4a6';
    mapCtx.fill();
  }
}

mapCanvas.addEventListener('mousemove', (e) => {
  const rect = mapCanvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * mapCanvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * mapCanvas.height;
  const { lat, lon } = canvasPointToLatLon(x, y, mapCanvas.width, mapCanvas.height);
  $('canvas-hover-readout').textContent = formatCoord(lat, lon);
});

mapCanvas.addEventListener('mouseleave', () => {
  $('canvas-hover-readout').textContent = formatCoord(state.lat, state.lon);
});

mapCanvas.addEventListener('click', (e) => {
  const rect = mapCanvas.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * mapCanvas.width;
  const y = ((e.clientY - rect.top) / rect.height) * mapCanvas.height;
  const { lat, lon } = canvasPointToLatLon(x, y, mapCanvas.width, mapCanvas.height);

  // Check if user clicked right next to a custom or named feature
  const nearest = findNearestFeature(lat, lon, 1.4);
  $('custom-lat').value = lat;
  $('custom-lon').value = lon;

  if (nearest) {
    selectLocation(nearest.lat, nearest.lon, nearest.spanDeg || state.spanDeg, nearest.name);
  } else {
    selectLocation(lat, lon, state.spanDeg, `Mars Sector (${lat.toFixed(2)}°, ${lon.toFixed(2)}°)`);
  }
});

function findNearestFeature(lat, lon, maxDeg = 1.4) {
  let best = null;
  let bestDist = maxDeg;
  const candidates = [...state.catalog.custom, ...state.catalog.featured, ...state.catalog.official];
  for (const item of candidates) {
    const d = Math.hypot(item.lat - lat, item.lon - lon);
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best;
}

// ============================================================================
// 2. Three.js 3D Terrain Scene + Web Worker Integration
// ============================================================================
const container = $('three-container');
const pinsLayer = $('pins-layer');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#060c14');
scene.fog = new THREE.FogExp2('#060c14', 0.0022);

const camera = new THREE.PerspectiveCamera(44, 1, 0.5, 1600);
camera.position.set(0, 88, 128);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.485;
controls.minDistance = 18;
controls.maxDistance = 380;
controls.target.set(0, 6, 0);

// Martian sky + dusty bounce lighting + directional solar key light
const hemiLight = new THREE.HemisphereLight('#ffdcc2', '#263244', 0.72);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight('#fff0dc', 1.85);
scene.add(sunLight);

function updateSunPosition() {
  const az = (state.sunAzimuthDeg * Math.PI) / 180;
  const elev = (38 * Math.PI) / 180;
  const r = 200;
  sunLight.position.set(
    Math.sin(az) * Math.cos(elev) * r,
    Math.sin(elev) * r,
    -Math.cos(az) * Math.cos(elev) * r
  );
}
updateSunPosition();

// Subtle reference coordinate grid under the terrain block
const floorGrid = new THREE.GridHelper(180, 18, '#2b3d52', '#15202d');
floorGrid.position.y = -0.35;
scene.add(floorGrid);

const terrainGroup = new THREE.Group();
scene.add(terrainGroup);

let terrainMesh = null;
let skirtMesh = null;
let sliceLine = null;
let currentTexture = null;
const textureLoader = new THREE.TextureLoader();

// 3D Beacon synced with SVG elevation profile hover
const beaconGroup = new THREE.Group();
beaconGroup.visible = false;
const beaconSphere = new THREE.Mesh(
  new THREE.SphereGeometry(1.15, 20, 20),
  new THREE.MeshBasicMaterial({ color: '#7cd4a6' })
);
const beaconStemGeo = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 8, 0),
]);
const beaconStem = new THREE.Line(
  beaconStemGeo,
  new THREE.LineBasicMaterial({ color: '#7cd4a6' })
);
beaconSphere.position.y = 8;
beaconGroup.add(beaconSphere, beaconStem);
scene.add(beaconGroup);

function buildSkirtGeometry(positions, width, height, baseY = -2.2) {
  // Builds 4 vertical side walls around the displaced terrain perimeter for a clean relief-block look
  const edges = [];
  // North edge (row 0, left to right)
  for (let c = 0; c < width - 1; c++) edges.push([c, c + 1]);
  // East edge (col width-1, top to bottom)
  for (let r = 0; r < height - 1; r++) edges.push([r * width + (width - 1), (r + 1) * width + (width - 1)]);
  // South edge (row height-1, right to left)
  for (let c = width - 1; c > 0; c--) edges.push([(height - 1) * width + c, (height - 1) * width + (c - 1)]);
  // West edge (col 0, bottom to top)
  for (let r = height - 1; r > 0; r--) edges.push([r * width, (r - 1) * width]);

  const verts = new Float32Array(edges.length * 18);
  let ptr = 0;
  for (const [i0, i1] of edges) {
    const x0 = positions[i0 * 3];
    const y0 = positions[i0 * 3 + 1];
    const z0 = positions[i0 * 3 + 2];
    const x1 = positions[i1 * 3];
    const y1 = positions[i1 * 3 + 1];
    const z1 = positions[i1 * 3 + 2];

    // Two triangles forming quad
    verts.set([x0, y0, z0, x0, baseY, z0, x1, y1, z1], ptr);
    ptr += 9;
    verts.set([x1, y1, z1, x0, baseY, z0, x1, baseY, z1], ptr);
    ptr += 9;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

function applyWorkerMesh({ positions, normals, uvs, indices, profile, stats, pins }, resetView = false) {
  state.stats = stats;
  state.profile = profile;
  state.pins = pins;
  state.hasMesh = true;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();

  if (!terrainMesh) {
    const mat = new THREE.MeshStandardMaterial({
      map: currentTexture,
      color: currentTexture ? '#ffffff' : '#b97b58',
      roughness: 0.88,
      metalness: 0.04,
      wireframe: state.wireframe,
    });
    terrainMesh = new THREE.Mesh(geometry, mat);
    terrainGroup.add(terrainMesh);
  } else {
    terrainMesh.geometry.dispose();
    terrainMesh.geometry = geometry;
    terrainMesh.material.wireframe = state.wireframe;
    if (currentTexture) {
      terrainMesh.material.map = currentTexture;
      terrainMesh.material.color.set('#ffffff');
      terrainMesh.material.needsUpdate = true;
    }
  }

  // Update geological plinth skirt
  const skirtGeo = buildSkirtGeometry(positions, stats.width, stats.height, -1.8);
  if (!skirtMesh) {
    const skirtMat = new THREE.MeshStandardMaterial({
      color: '#182433',
      roughness: 0.95,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    terrainGroup.add(skirtMesh);
  } else {
    skirtMesh.geometry.dispose();
    skirtMesh.geometry = skirtGeo;
  }

  // Update 3D cross-section slice line draped on surface
  const slicePoints = profile.map((p) => new THREE.Vector3(p.worldX, p.worldY + 0.35, p.worldZ));
  const sliceGeo = new THREE.BufferGeometry().setFromPoints(slicePoints);
  if (!sliceLine) {
    sliceLine = new THREE.Line(
      sliceGeo,
      new THREE.LineBasicMaterial({ color: '#efd6ab', transparent: true, opacity: 0.88 })
    );
    terrainGroup.add(sliceLine);
  } else {
    sliceLine.geometry.dispose();
    sliceLine.geometry = sliceGeo;
  }
  sliceLine.visible = state.showSlice;

  if (resetView) {
    const maxY = (stats.reliefM * stats.elevScale) || 8;
    controls.target.set(0, Math.min(18, maxY * 0.3), 0);
    camera.position.set(0, Math.max(58, maxY * 2.1 + 48), 118);
    controls.update();
  }

  rebuildPinElements();
  renderProfileSVG();
  renderTelemetry();
}

// ============================================================================
// 3. 3D Projected Feature Pins + Double-Click Surface Probe
// ============================================================================
let pinDomList = [];

function rebuildPinElements() {
  pinsLayer.replaceChildren();
  pinDomList = [];
  if (!state.showPins) return;

  for (const pin of state.pins) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `pin-3d ${pin.source === 'custom' ? 'custom' : ''}`;
    el.innerHTML = `<span>${escapeHtml(pin.name)} · ${pin.elevM} m</span><i></i>`;
    el.title = `Перейти к ${pin.name} (${formatCoord(pin.lat, pin.lon)})`;
    el.onclick = () => {
      selectLocation(pin.lat, pin.lon, pin.spanDeg || Math.max(1, state.spanDeg * 0.5), pin.name);
    };
    pinsLayer.appendChild(el);
    pinDomList.push({ el, pos: new THREE.Vector3(pin.worldX, pin.worldY + 1.2, pin.worldZ) });
  }
}

function updateProjectedPins() {
  if (!state.showPins || !pinDomList.length) return;
  const rect = container.getBoundingClientRect();
  const tempV = new THREE.Vector3();

  for (const item of pinDomList) {
    tempV.copy(item.pos).project(camera);
    if (tempV.z < -1 || tempV.z > 1) {
      item.el.style.display = 'none';
      continue;
    }
    const x = (tempV.x * 0.5 + 0.5) * rect.width;
    const y = (-tempV.y * 0.5 + 0.5) * rect.height;
    if (x < 10 || x > rect.width - 10 || y < 55 || y > rect.height - 15) {
      item.el.style.display = 'none';
      continue;
    }
    item.el.style.display = 'flex';
    item.el.style.left = `${x.toFixed(1)}px`;
    item.el.style.top = `${y.toFixed(1)}px`;
  }
}

const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();

renderer.domElement.addEventListener('dblclick', (e) => {
  if (!terrainMesh || !state.terrainMeta || !state.stats) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointerNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointerNDC, camera);
  const hits = raycaster.intersectObject(terrainMesh, false);
  if (!hits.length) return;

  const pt = hits[0].point;
  const { bounds } = state.terrainMeta;
  const { meshWidth, meshDepth, minElevM, elevScale } = state.stats;

  const u = Math.min(1, Math.max(0, (pt.x + meshWidth / 2) / meshWidth));
  const v = Math.min(1, Math.max(0, (pt.z + meshDepth / 2) / meshDepth));
  const lon = Number((bounds.west + u * (bounds.east - bounds.west)).toFixed(4));
  const lat = Number((bounds.north - v * (bounds.north - bounds.south)).toFixed(4));
  const elevM = Math.round(minElevM + pt.y / Math.max(1e-6, elevScale));

  state.probePoint = { lat, lon, elevM };
  $('probe-text').textContent = `Точка 3D: ${formatCoord(lat, lon)} · Высота ${elevM.toLocaleString('ru-RU')} м`;
  $('surface-probe').hidden = false;

  beaconGroup.position.set(pt.x, pt.y, pt.z);
  beaconGroup.visible = true;
});

$('probe-center-btn').onclick = () => {
  if (!state.probePoint) return;
  selectLocation(
    state.probePoint.lat,
    state.probePoint.lon,
    state.spanDeg,
    `Mars (${state.probePoint.lat.toFixed(2)}°, ${state.probePoint.lon.toFixed(2)}°)`
  );
};

$('probe-form-btn').onclick = () => {
  if (!state.probePoint) return;
  $('custom-details').open = true;
  $('custom-lat').value = state.probePoint.lat;
  $('custom-lon').value = state.probePoint.lon;
  $('custom-name').focus();
};

// Resize handling
function handleResize() {
  const rect = container.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
new ResizeObserver(handleResize).observe(container);

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
  updateProjectedPins();
}
animate();

// ============================================================================
// 4. Web Worker Lifecycle & Terrain Loading
// ============================================================================
const worker = new Worker('./terrain-worker.js', { type: 'module' });
let pendingResetView = false;

worker.onmessage = ({ data }) => {
  if (data.id !== state.requestEpoch) return;
  if (data.type === 'error') {
    showLoading(false);
    $('stat-source').textContent = `Ошибка воркера: ${data.message}`;
    return;
  }
  if (data.type === 'mesh') {
    applyWorkerMesh(data, pendingResetView);
    pendingResetView = false;
    showLoading(false);
  }
};

function showLoading(visible, title = '', sub = '') {
  const el = $('loading-overlay');
  el.hidden = !visible;
  if (title) $('loading-title').textContent = title;
  if (sub) $('loading-sub').textContent = sub;
}

function loadTextureAsync(url) {
  return new Promise((resolve, reject) => {
    textureLoader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        resolve(tex);
      },
      undefined,
      reject
    );
  });
}

async function selectLocation(lat, lon, spanDeg = state.spanDeg, name = state.name) {
  state.lat = clampLat(lat, 86);
  state.lon = normalizeLon(lon);
  state.spanDeg = clampSpan(spanDeg);
  state.name = name || state.name;
  state.probePoint = null;
  $('surface-probe').hidden = true;
  beaconGroup.visible = false;

  syncSpanSelectUI(state.spanDeg);
  syncReturnLinks();
  renderCatalog();

  const epoch = ++state.requestEpoch;
  pendingResetView = true;
  state.hasMesh = false;
  showLoading(
    true,
    `Загрузка участка «${state.name}»…`,
    `NASA Mars Trek S16 DEM + USGS WMS (${state.layer.toUpperCase()})`
  );

  try {
    const q = new URLSearchParams({
      lat: String(state.lat),
      lon: String(state.lon),
      span: String(state.spanDeg),
      layer: state.layer,
      grid: '257',
    });

    const metaRes = await fetch(`/api/terrain?${q}`);
    if (!metaRes.ok) {
      const errBody = await metaRes.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${metaRes.status}`);
    }
    const meta = await metaRes.json();
    if (epoch !== state.requestEpoch) return;

    state.terrainMeta = meta;
    draw2DMap();

    showLoading(true, 'Считывание матрицы высот и спутниковой текстуры…', 'Передача буфера в Web Worker');

    const [demBuf, tex] = await Promise.all([
      fetch(meta.demUrl).then((r) => {
        if (!r.ok) throw new Error(`DEM HTTP ${r.status}`);
        return r.arrayBuffer();
      }),
      loadTextureAsync(meta.textureUrl),
    ]);

    if (epoch !== state.requestEpoch) {
      tex.dispose();
      return;
    }

    if (currentTexture) currentTexture.dispose();
    currentTexture = tex;
    if (terrainMesh) {
      terrainMesh.material.map = currentTexture;
      terrainMesh.material.color.set('#ffffff');
      terrainMesh.material.needsUpdate = true;
    }

    worker.postMessage(
      {
        type: 'build',
        id: epoch,
        demBuffer: demBuf,
        width: meta.gridSize,
        height: meta.gridSize,
        bounds: meta.bounds,
        verticalExaggeration: state.verticalExaggeration,
        profileMode: state.profileMode,
        nearbyFeatures: meta.nearbyFeatures || [],
      },
      [demBuf]
    );
  } catch (err) {
    if (epoch !== state.requestEpoch) return;
    showLoading(false);
    $('stat-source').textContent = `Ошибка загрузки: ${err.message}`;
  }
}

function triggerWorkerRecompute() {
  if (!state.terrainMeta || !state.hasMesh) return;
  const epoch = ++state.requestEpoch;
  pendingResetView = false;
  worker.postMessage({
    type: 'recompute',
    id: epoch,
    verticalExaggeration: state.verticalExaggeration,
    profileMode: state.profileMode,
    nearbyFeatures: state.terrainMeta.nearbyFeatures || [],
  });
}

// ============================================================================
// 5. Interactive SVG Elevation Cross-Section Profile
// ============================================================================
const profileSvg = $('profile-svg');

function renderProfileSVG() {
  const pts = state.profile;
  if (!pts || pts.length < 2) {
    profileSvg.innerHTML = '';
    return;
  }

  const W = 760;
  const H = 156;
  const padL = 54;
  const padR = 18;
  const padT = 18;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  let minE = Infinity;
  let maxE = -Infinity;
  for (const p of pts) {
    if (p.elevM < minE) minE = p.elevM;
    if (p.elevM > maxE) maxE = p.elevM;
  }
  const spanE = Math.max(20, maxE - minE);
  const maxDist = pts[pts.length - 1].distKm || 1;

  const xOf = (d) => padL + (d / maxDist) * plotW;
  const yOf = (e) => padT + (1 - (e - minE) / spanE) * plotH;

  const lineCmd = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${xOf(p.distKm).toFixed(1)},${yOf(p.elevM).toFixed(1)}`)
    .join(' ');
  const areaCmd = `${lineCmd} L${(padL + plotW).toFixed(1)},${(padT + plotH).toFixed(1)} L${padL},${(padT + plotH).toFixed(1)} Z`;

  const midE = Math.round((minE + maxE) / 2);
  const modeLabels = {
    ew: ['Запад (W)', 'Восток (E)', 'Разрез Запад → Восток через центр участка'],
    ns: ['Север (N)', 'Юг (S)', 'Меридиональный разрез Север → Юг'],
    diag: ['Юго-Запад (SW)', 'Северо-Восток (NE)', 'Диагональный разрез ЮЗ → СВ'],
  };
  const [startLbl, endLbl, titleLbl] = modeLabels[state.profileMode] || modeLabels.ew;
  $('profile-title').textContent = `${titleLbl} · ${maxDist.toFixed(1)} км`;

  profileSvg.innerHTML = `
    <defs>
      <linearGradient id="elevFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#efd6ab" stop-opacity="0.38"/>
        <stop offset="100%" stop-color="#efd6ab" stop-opacity="0.03"/>
      </linearGradient>
    </defs>
    <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="#b8c8de1f" stroke-dasharray="3,3"/>
    <line x1="${padL}" y1="${padT + plotH / 2}" x2="${W - padR}" y2="${padT + plotH / 2}" stroke="#b8c8de18" stroke-dasharray="3,3"/>
    <line x1="${padL}" y1="${padT + plotH}" x2="${W - padR}" y2="${padT + plotH}" stroke="#b8c8de33"/>

    <text x="${padL - 6}" y="${padT + 4}" fill="#93a5b8" font-size="9.5" font-family="monospace" text-anchor="end">${maxE} м</text>
    <text x="${padL - 6}" y="${padT + plotH / 2 + 3}" fill="#74889d" font-size="9" font-family="monospace" text-anchor="end">${midE} м</text>
    <text x="${padL - 6}" y="${padT + plotH + 3}" fill="#93a5b8" font-size="9.5" font-family="monospace" text-anchor="end">${minE} м</text>

    <text x="${padL}" y="${H - 7}" fill="#9fb0c2" font-size="9.5" font-family="monospace">${startLbl} · 0 км</text>
    <text x="${padL + plotW / 2}" y="${H - 7}" fill="#7f93a8" font-size="9.5" font-family="monospace" text-anchor="middle">${(maxDist / 2).toFixed(1)} км</text>
    <text x="${W - padR}" y="${H - 7}" fill="#9fb0c2" font-size="9.5" font-family="monospace" text-anchor="end">${maxDist.toFixed(1)} км · ${endLbl}</text>

    <path d="${areaCmd}" fill="url(#elevFill)"/>
    <path d="${lineCmd}" fill="none" stroke="#efd6ab" stroke-width="2"/>

    <g id="svg-hover-cursor" visibility="hidden">
      <line id="svg-hover-line" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" stroke="#7cd4a6" stroke-width="1.3" stroke-dasharray="3,2"/>
      <circle id="svg-hover-dot" cx="0" cy="0" r="4" fill="#7cd4a6" stroke="#08121d" stroke-width="1.5"/>
    </g>
  `;
}

profileSvg.addEventListener('mousemove', (e) => {
  const pts = state.profile;
  if (!pts || pts.length < 2) return;
  const rect = profileSvg.getBoundingClientRect();
  const svgX = ((e.clientX - rect.left) / rect.width) * 760;
  const padL = 54;
  const plotW = 760 - 54 - 18;
  const t = Math.min(1, Math.max(0, (svgX - padL) / plotW));
  const idx = Math.round(t * (pts.length - 1));
  const sample = pts[idx];
  if (!sample) return;

  state.hoverPoint = sample;

  let minE = Infinity;
  let maxE = -Infinity;
  for (const p of pts) {
    if (p.elevM < minE) minE = p.elevM;
    if (p.elevM > maxE) maxE = p.elevM;
  }
  const spanE = Math.max(20, maxE - minE);
  const cx = padL + t * plotW;
  const cy = 18 + (1 - (sample.elevM - minE) / spanE) * (156 - 18 - 26);

  const cursor = $('svg-hover-cursor');
  if (cursor) {
    cursor.setAttribute('visibility', 'visible');
    $('svg-hover-line').setAttribute('x1', cx.toFixed(1));
    $('svg-hover-line').setAttribute('x2', cx.toFixed(1));
    $('svg-hover-dot').setAttribute('cx', cx.toFixed(1));
    $('svg-hover-dot').setAttribute('cy', cy.toFixed(1));
  }

  $('profile-hover-readout').textContent =
    `${sample.distKm.toFixed(1)} км · Высота ${sample.elevM.toLocaleString('ru-RU')} м · Уклон ${sample.slopeDeg}° · (${sample.lat.toFixed(2)}°, ${sample.lon.toFixed(2)}°)`;

  beaconGroup.position.set(sample.worldX, sample.worldY, sample.worldZ);
  beaconGroup.visible = true;
  draw2DMap();
});

profileSvg.addEventListener('mouseleave', () => {
  state.hoverPoint = null;
  const cursor = $('svg-hover-cursor');
  if (cursor) cursor.setAttribute('visibility', 'hidden');
  $('profile-hover-readout').textContent =
    'Наведите курсор на график для синхронизации с 3D-сценой';
  if (!state.probePoint) beaconGroup.visible = false;
  draw2DMap();
});

function renderTelemetry() {
  const s = state.stats;
  const m = state.terrainMeta;
  if (!s || !m) return;

  $('stat-minmax').textContent = `${s.minElevM.toLocaleString('ru-RU')} м … ${s.maxElevM.toLocaleString('ru-RU')} м`;
  $('stat-relief').textContent = `${s.reliefM.toLocaleString('ru-RU')} м (${state.verticalExaggeration}× верт.)`;
  $('stat-footprint').textContent = `${s.widthKm} × ${s.depthKm} км (${s.width}×${s.height})`;
  $('stat-slope').textContent = `${s.meanSlopeDeg}° сред · ${s.maxSlopeDeg}° макс`;
  $('stat-source').textContent =
    `${m.elevation.source} · DEM ${m.elevation.cached ? 'CACHE HIT' : 'LIVE'} · TEX ${m.texture.cached ? 'CACHE HIT' : 'LIVE'}`;
}

// ============================================================================
// 6. Catalog & Custom User Locations (GET / POST / DELETE /api/locations)
// ============================================================================
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

async function loadLocationsCatalog() {
  try {
    const res = await fetch('/api/locations');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.catalog.featured = data.featured || [];
    state.catalog.custom = data.custom || [];
    state.catalog.official = data.official || [];
    state.catalog.totalOfficial = data.totalOfficial || state.catalog.official.length;

    $('custom-count').textContent = String(state.catalog.custom.length);
    $('official-count').textContent = String(state.catalog.totalOfficial);

    renderCatalog();
    draw2DMap();
  } catch (err) {
    console.error('Failed to load locations catalog:', err);
  }
}

function renderCatalog() {
  const listEl = $('catalog-list');
  const tab = state.activeTab;
  $('catalog-filters').hidden = tab !== 'official';

  let items = [];
  if (tab === 'featured') {
    items = state.catalog.featured;
  } else if (tab === 'custom') {
    items = state.catalog.custom;
  } else {
    const q = ($('catalog-search').value || '').trim().toLowerCase();
    const t = ($('catalog-type').value || '').trim().toLowerCase();
    items = state.catalog.official.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q) && !item.type.toLowerCase().includes(q)) {
        return false;
      }
      if (t && !item.type.toLowerCase().includes(t)) return false;
      return true;
    }).slice(0, 120);
  }

  listEl.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'hint-line';
    empty.textContent = tab === 'custom'
      ? 'Пока нет сохранённых точек. Добавьте свою локацию выше или кликните по 2D-карте.'
      : 'Ничего не найдено по фильтру.';
    listEl.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement('div');
    const isActive = Math.hypot(item.lat - state.lat, item.lon - state.lon) < 0.25;
    row.className = `cat-item ${isActive ? 'active' : ''}`;
    row.setAttribute('role', 'listitem');

    const main = document.createElement('div');
    main.className = 'cat-main';
    const diamText = item.diameterKm > 0 ? ` · ⌀ ${item.diameterKm} км` : '';
    main.innerHTML = `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.type)}${diamText}</small>`;

    const right = document.createElement('div');
    right.className = 'cat-right';
    const coordsSpan = document.createElement('span');
    coordsSpan.textContent = `${item.lat.toFixed(1)}°, ${item.lon.toFixed(1)}°`;
    right.appendChild(coordsSpan);

    if (item.source === 'custom') {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'del-btn';
      del.title = 'Удалить точку';
      del.textContent = '×';
      del.onclick = async (ev) => {
        ev.stopPropagation();
        await deleteCustomLocation(item.id);
      };
      right.appendChild(del);
    }

    row.append(main, right);
    row.onclick = () => {
      selectLocation(item.lat, item.lon, item.spanDeg || 2.5, item.name);
    };
    listEl.appendChild(row);
  }
}

async function deleteCustomLocation(id) {
  const res = await fetch(`/api/locations/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) return;
  const data = await res.json();
  state.catalog.custom = data.custom || [];
  $('custom-count').textContent = String(state.catalog.custom.length);
  renderCatalog();
  draw2DMap();
}

$('custom-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('custom-name').value.trim();
  const lat = Number($('custom-lat').value);
  const lon = Number($('custom-lon').value);
  const spanDeg = Number($('custom-span').value || 2.5);
  const type = $('custom-type').value.trim() || 'Custom waypoint';

  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return;

  const res = await fetch('/api/locations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, lat, lon, spanDeg, type }),
  });
  if (!res.ok) return;
  const data = await res.json();
  state.catalog.custom = data.custom || [];
  $('custom-count').textContent = String(state.catalog.custom.length);
  $('custom-name').value = '';

  // Switch tab to show newly saved custom point and fly to its 3D mesh
  setActiveCatalogTab('custom');
  const loc = data.location;
  selectLocation(loc.lat, loc.lon, loc.spanDeg, loc.name);
});

$('preview-coords-btn').onclick = () => {
  const lat = Number($('custom-lat').value);
  const lon = Number($('custom-lon').value);
  const spanDeg = Number($('custom-span').value || 2.5);
  const name = $('custom-name').value.trim() || `Custom (${lat.toFixed(2)}°, ${normalizeLon(lon).toFixed(2)}°)`;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  selectLocation(lat, lon, spanDeg, name);
};

function setActiveCatalogTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.catalog-tabs button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  renderCatalog();
}

document.querySelectorAll('.catalog-tabs button').forEach((btn) => {
  btn.onclick = () => setActiveCatalogTab(btn.dataset.tab);
});

$('catalog-search').addEventListener('input', renderCatalog);
$('catalog-type').addEventListener('change', renderCatalog);

// ============================================================================
// 7. HUD Controls Wiring
// ============================================================================
function syncSpanSelectUI(spanVal) {
  const sel = $('span-select');
  const str = String(spanVal);
  let match = Array.from(sel.options).find((o) => Number(o.value) === Number(spanVal));
  if (!match) {
    let dyn = sel.querySelector('option[data-dynamic="1"]');
    if (!dyn) {
      dyn = document.createElement('option');
      dyn.dataset.dynamic = '1';
      sel.appendChild(dyn);
    }
    dyn.value = str;
    dyn.textContent = `${Number(spanVal).toFixed(1)}° (~${Math.round(spanVal * 59.3)} км)`;
    match = dyn;
  }
  sel.value = match.value;
}

$('layer-select').onchange = (e) => {
  state.layer = e.target.value;
  selectLocation(state.lat, state.lon, state.spanDeg, state.name);
};

$('span-select').onchange = (e) => {
  state.spanDeg = Number(e.target.value);
  selectLocation(state.lat, state.lon, state.spanDeg, state.name);
};

$('exag-slider').oninput = (e) => {
  state.verticalExaggeration = Number(e.target.value);
  $('exag-value').textContent = `${state.verticalExaggeration.toFixed(1)}×`;
  triggerWorkerRecompute();
};

$('sun-slider').oninput = (e) => {
  state.sunAzimuthDeg = Number(e.target.value);
  $('sun-value').textContent = `${state.sunAzimuthDeg}°`;
  updateSunPosition();
};

$('toggle-pins').onclick = () => {
  state.showPins = !state.showPins;
  $('toggle-pins').classList.toggle('active', state.showPins);
  rebuildPinElements();
};

$('toggle-slice').onclick = () => {
  state.showSlice = !state.showSlice;
  $('toggle-slice').classList.toggle('active', state.showSlice);
  if (sliceLine) sliceLine.visible = state.showSlice;
};

$('toggle-wire').onclick = () => {
  state.wireframe = !state.wireframe;
  $('toggle-wire').classList.toggle('active', state.wireframe);
  if (terrainMesh) terrainMesh.material.wireframe = state.wireframe;
};

$('reset-camera').onclick = () => {
  const maxY = (state.stats?.reliefM * state.stats?.elevScale) || 8;
  controls.target.set(0, Math.min(18, maxY * 0.3), 0);
  camera.position.set(0, Math.max(58, maxY * 2.1 + 48), 118);
  controls.update();
};

document.querySelectorAll('.slice-buttons button').forEach((btn) => {
  btn.onclick = () => {
    state.profileMode = btn.dataset.slice;
    document.querySelectorAll('.slice-buttons button').forEach((b) =>
      b.classList.toggle('active', b === btn)
    );
    triggerWorkerRecompute();
  };
});

// ============================================================================
// 8. Initialization
// ============================================================================
async function init() {
  readInitialParams();
  $('layer-select').value = state.layer;
  handleResize();

  try {
    const health = await fetch('/api/health').then((r) => r.json());
    if (health?.atlasUrl) state.atlasUrl = health.atlasUrl;
  } catch {
    // Keep default localhost:4173
  }

  syncReturnLinks();
  loadLocationsCatalog();
  await selectLocation(state.lat, state.lon, state.spanDeg, state.name);
}

init();
