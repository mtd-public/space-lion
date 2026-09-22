// Small helpers shared across the 3D game modules.
// Convention (matches js/vendor/space-assets.js): Y is up, play field is the XZ
// plane, and every model's local -Z is its "forward" (screen-up on a top-down
// camera). Gameplay heading is tracked as a plain 2D angle where
// dx = cos(angle), dz = sin(angle) — the same convention js/utils.js already
// uses for angleLerp etc. yawForDirection() converts that heading into the
// three.js rotation.y needed to make a model's -Z point along it.
export function yawForDirection(dx, dz) {
  return Math.atan2(-dx, -dz);
}

export function worldToScreen(THREE, x, y, z, camera, width, height) {
  const v = new THREE.Vector3(x, y, z).project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * width,
    y: (1 - (v.y * 0.5 + 0.5)) * height,
  };
}

// Frees GPU resources for an object and everything under it. Geometries and
// materials that space-assets marks as shared (bullets, fx particles, the ink
// outline material) are left alone, since other live objects still use them.
export function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child.geometry && !child.geometry.userData.shared) child.geometry.dispose();
    if (child.material) {
      const mats = Array.isArray(child.material) ? child.material : [child.material];
      for (const m of mats) if (!m.userData.shared) m.dispose();
    }
  });
}
