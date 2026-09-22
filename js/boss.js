import { Bullet } from './entities.js';

const SA = window.SpaceAssets;

// The recurring mini-boss. Its health is persistent across encounters: each
// time it's engaged you can chip away exactly half before it warps out and
// flees for a while; it comes back at whatever health remained.
export class Sentinel {
  constructor(scene, x, z) {
    this.scene = scene;
    this.x = x;
    this.z = z;
    this.worldX = x;
    this.worldZ = z;
    this.mesh = SA.makeBossUFO();
    this.mesh.position.set(x, 0, z);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.health = new SA.BossHealth(180, 2);
    this.state = 'dormant'; // dormant | spawning | active | retreating | defeated
    this.spawnTimer = 25;
    this.respawnDelay = 50;
    this.fireCooldown = 1.5;
    this.radius = 3.6;
    this.scoreValue = 400; // per phase chipped
    this.defeatScoreValue = 1500;
  }

  get isDefeated() { return this.health.hp <= 0; }
  get isActive() { return this.state === 'active'; }

  update(dt, t, player, bulletsOut, onEvent) {
    if (this.state === 'dormant') {
      if (this.isDefeated) return;
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) this._spawn(onEvent);
      return;
    }

    this.mesh.userData.lookAt(player.x, player.z);
    this.mesh.userData.update(t, dt);

    if (this.state === 'active') {
      const orbitX = this.x + Math.sin(t * 0.22) * 12;
      const orbitZ = this.z + Math.cos(t * 0.17) * 7;
      this.worldX += (orbitX - this.worldX) * Math.min(1, dt * 0.6);
      this.worldZ += (orbitZ - this.worldZ) * Math.min(1, dt * 0.6);
      this.mesh.position.x = this.worldX;
      this.mesh.position.z = this.worldZ;

      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0) {
        this.fireCooldown = 1.15;
        this._fireBurst(bulletsOut, player);
      }
    }
  }

  _spawn(onEvent) {
    this.state = 'spawning';
    this.mesh.visible = true;
    this.worldX = this.x;
    this.worldZ = this.z;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.userData.setHealth(this.health.fraction);
    this.mesh.userData.warpIn(() => { this.state = 'active'; });
    if (onEvent) onEvent('sentinel-spawn');
  }

  _fireBurst(bulletsOut, player) {
    const baseAngle = Math.atan2(player.z - this.worldZ, player.x - this.worldX);
    const spread = 0.26;
    for (const off of [-spread, 0, spread]) {
      bulletsOut.push(new Bullet(this.scene, this.worldX, this.worldZ, baseAngle + off, 14, 12, 'enemy'));
    }
  }

  damage(amount, onEvent) {
    if (this.state !== 'active') return null;
    const result = this.health.damage(amount);
    this.mesh.userData.hitFlash();
    this.mesh.userData.setHealth(this.health.fraction);

    if (result === 'retreat') {
      this.state = 'retreating';
      this.mesh.userData.warpOut(() => {
        this.mesh.visible = false;
        this.state = 'dormant';
        this.spawnTimer = this.respawnDelay;
      });
      if (onEvent) onEvent('sentinel-retreat');
    } else if (result === 'defeated') {
      this.state = 'retreating';
      this.mesh.userData.warpOut(() => {
        this.mesh.visible = false;
        this.state = 'defeated';
      });
      if (onEvent) onEvent('sentinel-defeated');
    } else if (onEvent) {
      onEvent('sentinel-hit');
    }
    return result;
  }
}

// The final boss. A single (non-segmented) health pool; defeating it wins
// the game. Attacks with a bullet-wave timed to the peak of its roar.
export class SpaceLionBoss {
  constructor(scene, x, z) {
    this.scene = scene;
    this.x = x;
    this.z = z;
    this.mesh = SA.makeSpaceLion();
    this.mesh.position.set(x, 0, z);
    this.mesh.visible = false;
    scene.add(this.mesh);

    this.health = new SA.BossHealth(420, 1);
    this.active = false;
    this.roarTimer = 4;
    this._queuedBlast = null;
    this.radius = 6.5;
    this.contactDamage = 20;
  }

  get isDefeated() { return this.health.hp <= 0; }

  spawn() {
    this.mesh.visible = true;
    this.active = true;
    this.health.reset();
    this.mesh.userData.setHealth(1);
    this.roarTimer = 3;
  }

  update(dt, t, player, bulletsOut) {
    if (!this.active) return;
    this.mesh.userData.lookAt(player.x, player.z);
    this.mesh.userData.update(t, dt);

    this.roarTimer -= dt;
    if (this.roarTimer <= 0) {
      this.roarTimer = 5.2;
      this.mesh.userData.roar();
      this._queuedBlast = 1.05; // fires near the roar's peak (see space-assets.js timeline)
    }
    if (this._queuedBlast != null) {
      this._queuedBlast -= dt;
      if (this._queuedBlast <= 0) {
        this._queuedBlast = null;
        this._fireWave(bulletsOut, player);
      }
    }
  }

  _fireWave(bulletsOut, player) {
    const baseAngle = Math.atan2(player.z - this.z, player.x - this.x);
    const n = 5;
    const spread = 0.6;
    for (let i = 0; i < n; i++) {
      const a = baseAngle + (i / (n - 1) - 0.5) * spread * 2;
      bulletsOut.push(new Bullet(this.scene, this.x, this.z, a, 15, 18, 'enemy'));
    }
  }

  damage(amount) {
    if (!this.active) return null;
    const result = this.health.damage(amount);
    this.mesh.userData.hitFlash();
    this.mesh.userData.setHealth(this.health.fraction);
    if (result === 'defeated') this.active = false;
    return result;
  }
}
