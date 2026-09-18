import { disposeObject3D } from './three-utils.js';

const THREE = window.THREE;
const SA = window.SpaceAssets;

export class GoldPickup {
  constructor(scene, x, z, value) {
    this.scene = scene;
    this.mesh = SA.makeGold();
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);

    this.x = x;
    this.z = z;
    this.radius = 1.3;
    this.value = value || 10;
    this.collected = false;
    this._removeIn = -1;
  }

  update(dt, t) {
    this.mesh.userData.update(t, dt);
    if (this.collected) this._removeIn -= dt;
  }

  collect() {
    if (this.collected) return;
    this.collected = true;
    this.mesh.userData.collect();
    this._removeIn = 1.4; // matches the pop animation length in space-assets.js
  }

  get done() {
    return this.collected && this._removeIn <= 0;
  }

  dispose() {
    this.scene.remove(this.mesh);
    disposeObject3D(this.mesh);
  }
}

// A sequential set of rings ("fly through in order"); replays after a
// cooldown once fully cleared.
export class RingCourse {
  constructor(scene, x, z, yaw, count, spacing) {
    this.scene = scene;
    this.count = count || 4;
    this.group = SA.makeRingSet(this.count, spacing || 6);
    this.group.position.set(x, 0, z);
    this.group.rotation.y = yaw;
    scene.add(this.group);

    this.x = x;
    this.z = z;
    this.collisionRadius = 1.8;
    this.replayCooldown = 16;
    this._clearedFor = 0;
    this._worldPos = new THREE.Vector3();
  }

  get isCleared() {
    return this.group.userData.nextIndex >= this.count;
  }

  // World position of the next ring the player needs to fly through, or null
  // once the whole course is cleared.
  nextRingWorldPos() {
    const idx = this.group.userData.nextIndex;
    if (idx >= this.count) return null;
    this.group.userData.rings[idx].getWorldPosition(this._worldPos);
    return this._worldPos;
  }

  // Returns true if this clear completed the whole course.
  clearNext() {
    return this.group.userData.clearNext();
  }

  update(dt, t) {
    this.group.userData.update(t, dt);
    if (this.isCleared) {
      this._clearedFor += dt;
      if (this._clearedFor > this.replayCooldown) {
        this.group.userData.reset();
        this._clearedFor = 0;
      }
    }
  }
}
