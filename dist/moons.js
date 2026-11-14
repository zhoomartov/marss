import * as THREE from 'three';
import { GLTFLoader } from './assets/GLTFLoader.js';

// NASA/JPL-Caltech meshes and embedded image maps; display scales are illustrative.
export const MOONS = {
  phobos: { name: 'Phobos', radius: .032, orbit: .40, period: 7.65, phase: 2.65 },
  deimos: { name: 'Deimos', radius: .018, orbit: .47, period: 30.3, phase: .55 }
};

export async function createMarsMoons(parent, center, anisotropy) {
  const root = new THREE.Group();
  root.position.copy(center);
  root.rotation.z = .44;
  parent.add(root);
  const bodies = {}, paths = [];
  const loader = new GLTFLoader();
  await Promise.all(Object.entries(MOONS).map(async ([key, spec]) => {
    const { scene: model } = await loader.loadAsync(`./assets/${key}.glb`);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = spec.radius * 2 / Math.max(size.x, size.y, size.z);
    model.position.sub(box.getCenter(new THREE.Vector3()));
    const body = new THREE.Group();
    body.add(model);
    body.scale.setScalar(scale);
    model.traverse(mesh => {
      if (!mesh.isMesh) return;
      mesh.material.metalness = 0;
      mesh.material.roughness = 1;
      if (mesh.material.map) mesh.material.map.anisotropy = anisotropy;
    });
    root.add(body);
    bodies[key] = body;
    const points = Array.from({ length: 129 }, (_, i) => {
      const a = i / 128 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * spec.orbit, 0, Math.sin(a) * spec.orbit);
    });
    const path = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: 0xb4a58d, transparent: true, opacity: .18, depthWrite: false }));
    root.add(path); paths.push(path);
  }));
  let hours = 0;
  function update(dt, visible, showPaths) {
    root.visible = visible;
    // One displayed second represents 0.05 hours; period ratio is preserved.
    hours += dt * .05;
    for (const [key, spec] of Object.entries(MOONS)) {
      const angle = spec.phase + hours / spec.period * Math.PI * 2;
      bodies[key].position.set(Math.cos(angle) * spec.orbit, 0, Math.sin(angle) * spec.orbit);
      bodies[key].rotation.y = -angle; // Synchronous rotation.
    }
    for (const path of paths) path.visible = showPaths;
    root.updateMatrixWorld(true);
  }
  update(0, true, true);
  return { root, bodies, update };
}

