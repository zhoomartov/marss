import {
  sanitizeElevations,
  buildTerrainGeometryData,
  sampleFeatureElevations,
} from './mars-coords.js';

let cachedState = null;

function build(id, verticalExaggeration, profileMode, nearbyFeatures, routePoints, directPoints) {
  const { clean, width, height, bounds } = cachedState;

  const result = buildTerrainGeometryData({
    elevations: clean,
    width,
    height,
    bounds,
    verticalExaggeration,
    profileMode,
    routePoints,
    directPoints,
  });

  const pins = sampleFeatureElevations(nearbyFeatures, clean, width, height, bounds, result.stats);

  self.postMessage(
    {
      type: 'mesh',
      id,
      positions: result.positions,
      normals: result.normals,
      uvs: result.uvs,
      indices: result.indices,
      profile: result.profile,
      stats: result.stats,
      pins,
      route: result.route,
      direct: result.direct,
    },
    [
      result.positions.buffer,
      result.normals.buffer,
      result.uvs.buffer,
      result.indices.buffer,
    ]
  );
}

self.onmessage = (event) => {
  const msg = event.data || {};
  try {
    if (msg.type === 'build') {
      const {
        id,
        demBuffer,
        width,
        height,
        bounds,
        demType = 'int16',
        verticalExaggeration = 4,
        profileMode = 'ew',
        nearbyFeatures = [],
        routePoints = null,
        directPoints = null,
      } = msg;

      const raw = demType === 'float32' ? new Float32Array(demBuffer) : new Int16Array(demBuffer);
      const clean = sanitizeElevations(raw, width, height);
      cachedState = { clean, width, height, bounds, routePoints, directPoints };
      build(id, verticalExaggeration, profileMode, nearbyFeatures, routePoints, directPoints);
      return;
    }

    if (msg.type === 'recompute' && cachedState) {
      const {
        id,
        verticalExaggeration = 4,
        profileMode = 'ew',
        nearbyFeatures = [],
        routePoints,
        directPoints,
      } = msg;
      const route = routePoints !== undefined ? routePoints : cachedState.routePoints;
      const direct = directPoints !== undefined ? directPoints : cachedState.directPoints;
      cachedState.routePoints = route;
      cachedState.directPoints = direct;
      build(id, verticalExaggeration, profileMode, nearbyFeatures, route, direct);
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: err?.message || 'Worker geometry error',
    });
  }
};
