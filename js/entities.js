import { clamp, angleLerp, dist, TWO_PI } from './utils.js';

export class Player {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.angle = -Math.PI / 2; // facing up
    this.targetAngle = this.angle;
    this.speed = 230; // px/s, always moving forward
    this.turnRate = 4.2; // rad/s max turn speed
    this.radius = 16;

    this.maxHealth = 100;
    this.health = this.maxHealth;
    this.invulnTimer = 0;

    this.fireCooldown = 0;
    this.fireRate = 0.16; // seconds between shots

    this.reticleDist = 90;
    this.alive = true;
  }

  setTargetAngle(a) {
    this.targetAngle = a;
  }

  update(dt) {
    this.angle = angleLerp(this.angle, this.targetAngle, clamp(this.turnRate * dt, 0, 1));
    this.x += Math.cos(this.angle) * this.speed * dt;
    this.y += Math.sin(this.angle) * this.speed * dt;

    if (this.fireCooldown > 0) this.fireCooldown -= dt;
    if (this.invulnTimer > 0) this.invulnTimer -= dt;
  }

  canFire() {
    return this.fireCooldown <= 0;
  }

  fire() {
    this.fireCooldown = this.fireRate;
    const noseX = this.x + Math.cos(this.angle) * (this.radius + 6);
    const noseY = this.y + Math.sin(this.angle) * (this.radius + 6);
    return new Bullet(noseX, noseY, this.angle, 620, 25, 'player');
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

  get reticleX() { return this.x + Math.cos(this.angle) * this.reticleDist; }
  get reticleY() { return this.y + Math.sin(this.angle) * this.reticleDist; }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);

    // Blink while invulnerable.
    const flicker = this.invulnTimer > 0 && Math.floor(this.invulnTimer * 16) % 2 === 0;
    if (!flicker) {
      ctx.rotate(this.angle);
      ctx.shadowColor = '#7db8ff';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#dfe9ff';
      ctx.beginPath();
      ctx.moveTo(20, 0);
      ctx.lineTo(-14, 12);
      ctx.lineTo(-7, 0);
      ctx.lineTo(-14, -12);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#5c8bff';
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(-20, 8);
      ctx.lineTo(-14, 0);
      ctx.lineTo(-20, -8);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Reticle stays screen-aligned (not rotated with ship).
    ctx.save();
    ctx.translate(this.reticleX, this.reticleY);
    ctx.strokeStyle = 'rgba(255, 90, 90, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, TWO_PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-14, 0); ctx.lineTo(-5, 0);
    ctx.moveTo(14, 0); ctx.lineTo(5, 0);
    ctx.moveTo(0, -14); ctx.lineTo(0, -5);
    ctx.moveTo(0, 14); ctx.lineTo(0, 5);
    ctx.stroke();
    ctx.restore();
  }
}

export class Bullet {
  constructor(x, y, angle, speed, damage, owner) {
    this.x = x;
    this.y = y;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;
    this.damage = damage;
    this.owner = owner; // 'player' | 'enemy'
    this.radius = owner === 'player' ? 4 : 5;
    this.life = 2.2;
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    if (this.owner === 'player') {
      ctx.fillStyle = '#9be7ff';
      ctx.shadowColor = '#9be7ff';
    } else {
      ctx.fillStyle = '#ff6a6a';
      ctx.shadowColor = '#ff6a6a';
    }
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
}

export class Tower {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.radius = 24;
    this.maxHealth = 60;
    this.health = this.maxHealth;
    this.range = 420;
    this.turretAngle = 0;
    this.fireCooldown = Math.random() * 1.5;
    this.fireInterval = 1.6;
    this.dead = false;
    this.scoreValue = 100;
    this.hitFlash = 0;
  }

  update(dt, player, bullets) {
    if (this.dead) return;
    if (this.hitFlash > 0) this.hitFlash -= dt;

    const d = dist(this.x, this.y, player.x, player.y);
    if (d < this.range) {
      const desired = Math.atan2(player.y - this.y, player.x - this.x);
      this.turretAngle = angleLerp(this.turretAngle, desired, clamp(3 * dt, 0, 1));

      this.fireCooldown -= dt;
      if (this.fireCooldown <= 0 && d < this.range) {
        this.fireCooldown = this.fireInterval;
        bullets.push(new Bullet(
          this.x + Math.cos(this.turretAngle) * (this.radius + 4),
          this.y + Math.sin(this.turretAngle) * (this.radius + 4),
          this.turretAngle, 230, 8, 'enemy'
        ));
      }
    }
  }

  takeDamage(amount) {
    this.health -= amount;
    this.hitFlash = 0.12;
    if (this.health <= 0 && !this.dead) {
      this.dead = true;
      return true; // just died
    }
    return false;
  }

  draw(ctx) {
    if (this.dead) return;
    ctx.save();
    ctx.translate(this.x, this.y);

    // Base
    ctx.fillStyle = this.hitFlash > 0 ? '#ffffff' : '#8a5a6b';
    ctx.beginPath();
    ctx.arc(0, 0, this.radius, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = '#3a1f28';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Turret barrel
    ctx.rotate(this.turretAngle);
    ctx.fillStyle = '#d1495b';
    ctx.fillRect(0, -5, this.radius + 14, 10);
    ctx.restore();

    // Health bar
    const w = 40;
    const pct = clamp(this.health / this.maxHealth, 0, 1);
    ctx.save();
    ctx.translate(this.x - w / 2, this.y - this.radius - 14);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, w, 5);
    ctx.fillStyle = pct > 0.4 ? '#5be36a' : '#ff5d5d';
    ctx.fillRect(0, 0, w * pct, 5);
    ctx.restore();
  }
}

export class Particle {
  constructor(x, y, color) {
    this.x = x;
    this.y = y;
    const a = Math.random() * TWO_PI;
    const s = 60 + Math.random() * 160;
    this.vx = Math.cos(a) * s;
    this.vy = Math.sin(a) * s;
    this.life = 0.35 + Math.random() * 0.3;
    this.maxLife = this.life;
    this.color = color;
    this.size = 2 + Math.random() * 3;
    this.dead = false;
  }

  update(dt) {
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.vx *= 0.92;
    this.vy *= 0.92;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    const t = clamp(this.life / this.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * t, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
}

export function spawnExplosion(list, x, y, color, count = 14) {
  for (let i = 0; i < count; i++) list.push(new Particle(x, y, color));
}
