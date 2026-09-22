import { clamp, angleLerp, dist } from './utils.js';
import { yawForDirection, disposeObject3D } from './three-utils.js';

const THREE = window.THREE;
const SA = window.SpaceAssets;

export class Bullet {
  constructor(scene, x, z, angle, speed, damage, owner) {
    this.scene = scene;
    this.owner = owner; // 'player' | 'enemy'
    this.mesh = owner === 'player' ? SA.makePlayerBolt() : SA.makeTowerShot();
    this.mesh.position.set(x, SA.FLIGHT_Y, z);
    this.mesh.rotation.y = yawForDirection(Math.cos(angle), Math.sin(angle));
    scene.add(this.mesh);

    this.x = x;
    this.z = z;
    this.vx = Math.cos(angle) * speed;
    this.vz = Math.sin(angle) * speed;
    this.damage = damage;
    this.radius = owner === 'player' ? 0.4 : 0.45;
    this.life = 2.6;
    this.dead = false;
  }

  update(dt, t) {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.mesh.position.x = this.x;
    this.mesh.position.z = this.z;
    if (this.mesh.userData.update) this.mesh.userData.update(t, dt);
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    disposeObject3D(this.mesh);
  }
}

export class Player {
  constructor(scene, x, z) {
    this.scene = scene;
    this.mesh = SA.makePlayerShip();
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);

    this.reticle = SA.makeReticle();
    scene.add(this.reticle);

    this.x = x;
    this.z = z;
    this.angle = -Math.PI / 2; // dx=0, dz=-1 -> local -Z, matches the ship's built-in forward
    this.targetAngle = this.angle;
    this.speed = 12;
    this.turnRate = 4.2; // rad/s
    this.radius = 1.1;

    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.invulnTimer = 0;

    this.fireCooldown = 0;
    this.fireRate = 0.16;

    this.reticleDist = 5;
    this.alive = true;
  }

  setTargetAngle(a) {
    this.targetAngle = a;
  }

  get reticleX() { return this.x + Math.cos(this.angle) * this.reticleDist; }
  get reticleZ() { return this.z + Math.sin(this.angle) * this.reticleDist; }

  update(dt, t) {
    const prevAngle = this.angle;
    this.angle = angleLerp(this.angle, this.targetAngle, clamp(this.turnRate * dt, 0, 1));
    let turnDelta = this.angle - prevAngle;
    turnDelta = Math.atan2(Math.sin(turnDelta), Math.cos(turnDelta));
    const bank = dt > 0 ? clamp(turnDelta / (this.turnRate * dt + 1e-6), -1, 1) : 0;

    const dx = Math.cos(this.angle), dz = Math.sin(this.angle);
    this.x += dx * this.speed * dt;
    this.z += dz * this.speed * dt;

    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = yawForDirection(dx, dz);
    this.mesh.userData.setBank(bank);
    this.mesh.userData.setThrust(1);
    this.mesh.userData.update(t, dt);

    this.reticle.position.set(this.reticleX, 0.05, this.reticleZ);
    this.reticle.userData.update(t, dt);

    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
    // blink while invulnerable after a hit
    this.mesh.visible = !(this.invulnTimer > 0 && Math.floor(t * 16) % 2 === 0);
  }

  canFire() {
    return this.fireCooldown <= 0;
  }

  fire() {
    this.fireCooldown = this.fireRate;
    this.mesh.userData.fire();
    this.reticle.userData.pulse();
    const noseX = this.x + Math.cos(this.angle) * (this.radius + 0.6);
    const noseZ = this.z + Math.sin(this.angle) * (this.radius + 0.6);
    return new Bullet(this.scene, noseX, noseZ, this.angle, 34, 25, 'player');
  }

  takeDamage(amount) {
    if (this.invulnTimer > 0) return false;
    this.health -= amount;
    this.invulnTimer = 1.0;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
    }
    return true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.reticle);
    disposeObject3D(this.mesh);
    disposeObject3D(this.reticle);
  }
}

export class Tower {
  constructor(scene, x, z, seed) {
    this.scene = scene;
    this.mesh = SA.makeTower(seed);
    this.mesh.position.set(x, 0, z);
    scene.add(this.mesh);

    this.x = x;
    this.z = z;
    this.radius = 1.8;
    this.maxHealth = 60;
    this.health = this.maxHealth;
    this.range = 18;
    this.fireCooldown = Math.random() * 1.6;
    this.fireInterval = 1.6;
    this.dead = false;
    this.scoreValue = 100;
    this._muzzle = new THREE.Vector3();
    this._targetVec = new THREE.Vector3();
  }

  update(dt, t, player, bulletsOut) {
    if (this.dead) return;
    const d = dist(this.x, this.z, player.x, player.z);
    if (d < this.range) {
      this._targetVec.set(player.x, 0, player.z);
      this.mesh.userData.aimAt(this._targetVec);
      this.fireCooldown -= dt;
      this.mesh.userData.charge(clamp(1 - this.fireCooldown / this.fireInterval, 0, 1));
      if (this.fireCooldown <= 0) {
        this.fireCooldown = this.fireInterval;
        this.mesh.userData.fire();
        this.mesh.userData.muzzleWorld(this._muzzle);
        const angle = Math.atan2(player.z - this.z, player.x - this.x);
        bulletsOut.push(new Bullet(this.scene, this._muzzle.x, this._muzzle.z, angle, 11.5, 8, 'enemy'));
      }
    } else {
      this.mesh.userData.charge(0);
    }
    this.mesh.userData.update(t, dt);
  }

  takeDamage(amount) {
    this.health -= amount;
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      return true; // just died
    }
    return false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    disposeObject3D(this.mesh);
  }
}
