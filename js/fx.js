import { rand } from './utils.js';

const SA = window.SpaceAssets;

// Toy-style bursts: chunky outlined stars, puffs and debris that pop out,
// tumble and shrink away, plus flat expanding shock rings.
class Particle {
  constructor(scene, kind, x, y, z, o) {
    this.scene = scene;
    this.mesh = SA.makeParticle(kind);
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
    scene.add(this.mesh);
    const a = rand(0, Math.PI * 2);
    const s = rand(o.speed[0], o.speed[1]);
    this.vx = Math.cos(a) * s;
    this.vz = Math.sin(a) * s;
    this.vy = rand(o.up[0], o.up[1]);
    this.gravity = o.gravity || 0;
    this.drag = o.drag == null ? 0.9 : o.drag;
    this.spin = rand(-8, 8);
    this.size = rand(o.size[0], o.size[1]);
    this.grow = o.grow || 0;
    this.life = this.maxLife = rand(o.life[0], o.life[1]);
    this.dead = false;
  }

  update(dt) {
    const m = this.mesh;
    m.position.x += this.vx * dt;
    m.position.y += this.vy * dt;
    m.position.z += this.vz * dt;
    const k = Math.pow(this.drag, dt * 60);
    this.vx *= k; this.vz *= k;
    this.vy -= this.gravity * dt;
    m.rotation.x += this.spin * dt;
    m.rotation.y += this.spin * 0.7 * dt;
    this.life -= dt;
    const t = 1 - Math.max(0, this.life / this.maxLife);
    // pop in fast, hold, then shrink away
    const s = t < 0.15 ? t / 0.15 : 1 - Math.max(0, (t - 0.45) / 0.55);
    const sc = this.size * s * (1 + this.grow * t);
    m.scale.setScalar(Math.max(0.001, sc));
    m.visible = sc > 0.08;
    if (this.life <= 0) this.dead = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
  }
}

class Shock {
  constructor(scene, x, y, z, hex, life) {
    this.scene = scene;
    this.mesh = SA.makeShockRing(hex);
    this.mesh.position.set(x, y, z);
    scene.add(this.mesh);
    this.life = this.maxLife = life;
    this.mesh.userData.setProgress(0);
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    this.mesh.userData.setProgress(1 - Math.max(0, this.life / this.maxLife));
    if (this.life <= 0) this.dead = true;
  }
  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.traverse((c) => { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  }
}

const Y = SA.FLIGHT_Y;

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
  }

  _emit(kind, n, x, z, o) {
    for (let i = 0; i < n; i++) this.items.push(new Particle(this.scene, kind, x, o.y == null ? Y : o.y, z, o));
  }

  shock(x, z, hex, life) {
    this.items.push(new Shock(this.scene, x, Y, z, hex, life || 0.5));
  }

  // A tower (or anything big) blowing up.
  explode(x, z) {
    this._emit('puff', 7, x, z, { speed: [1, 3.5], up: [0.5, 2], size: [1.1, 1.8], grow: 0.6, life: [0.5, 0.8], drag: 0.9 });
    this._emit('star', 7, x, z, { speed: [6, 12], up: [2, 6], size: [0.9, 1.4], life: [0.45, 0.7], drag: 0.88 });
    this._emit('orange', 4, x, z, { speed: [5, 10], up: [2, 5], size: [0.8, 1.2], life: [0.4, 0.6], drag: 0.88 });
    this._emit('chunk', 5, x, z, { speed: [3, 7], up: [5, 9], size: [0.8, 1.3], gravity: 22, life: [0.8, 1.1], drag: 0.97 });
    this._emit('rock', 4, x, z, { speed: [3, 6], up: [3, 7], size: [0.9, 1.4], gravity: 22, life: [0.8, 1.1], drag: 0.97 });
    this.shock(x, z, 0xffd45e, 0.5);
  }

  // Small pop where a shot lands.
  hit(x, z, kind) {
    this._emit(kind || 'star', 3, x, z, { speed: [3, 6], up: [1, 3], size: [0.5, 0.8], life: [0.25, 0.4], drag: 0.85 });
  }

  // Player took damage.
  hurt(x, z) {
    this._emit('blue', 5, x, z, { speed: [4, 8], up: [1, 4], size: [0.6, 1.0], life: [0.35, 0.55], drag: 0.87 });
    this._emit('red', 3, x, z, { speed: [2, 5], up: [1, 3], size: [0.5, 0.8], life: [0.3, 0.5], drag: 0.87 });
  }

  sparkle(x, z, kind, n) {
    this._emit(kind || 'star', n || 6, x, z, { speed: [3, 6], up: [3, 6], size: [0.55, 0.9], life: [0.4, 0.6], drag: 0.88, gravity: 6 });
  }

  update(dt) {
    for (const it of this.items) it.update(dt);
    for (const it of this.items) if (it.dead) it.dispose();
    this.items = this.items.filter((it) => !it.dead);
  }

  clear() {
    for (const it of this.items) it.dispose();
    this.items = [];
  }
}
