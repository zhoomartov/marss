import { sanitizeElevations, buildTerrainGeometryData, sampleFeatureElevations } from './mars-coords.js';

let cachedState = null;

function build(id, verticalExaggeration, profileMode, nearbyFeatures) {
  const { clean, width, height, bounds } = cachedState;

  const result = buildTerrainGeometryData({
    elevations: clean,
    width,
    height,
    bounds,
    verticalExaggeration,
    profileMode,
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
      const { id, demBuffer, width, height, bounds, verticalExaggeration = 4, profileMode = 'ew', nearbyFeatures = [] } = msg;
      const clean = sanitizeElevations(new Int16Array(demBuffer), width, height);
      cachedState = { clean, width, height, bounds };
      build(id, verticalExaggeration, profileMode, nearbyFeatures);
      return;
    }

    if (msg.type === 'recompute' && cachedState) {
      const { id, verticalExaggeration = 4, profileMode = 'ew', nearbyFeatures = [] } = msg;
      build(id, verticalExaggeration, profileMode, nearbyFeatures);
    }
  } catch (err) {
    self.postMessage({
      type: 'error',
      id: msg.id,
      message: err?.message || 'Worker geometry error',
    });
  }
};
