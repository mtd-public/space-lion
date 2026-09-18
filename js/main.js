import { InputManager } from './input.js';
import { Player, spawnExplosion } from './entities.js';
import { generateWorld, makeStarfield, drawBackground, WORLD_W, WORLD_H } from './world.js';
import { clamp, dist, TWO_PI } from './utils.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const screenStart = document.getElementById('screen-start');
const screenGameOver = document.getElementById('screen-gameover');
const btnStart = document.getElementById('btn-start');
const btnRetry = document.getElementById('btn-retry');
const gameoverStats = document.getElementById('gameover-stats');

let dpr = Math.max(1, window.devicePixelRatio || 1);
let width = window.innerWidth;
let height = window.innerHeight;

function resize() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', resize);
resize();

const input = new InputManager(canvas);

const state = {
  mode: 'menu', // 'menu' | 'playing' | 'gameover'
  score: 0,
  towersDestroyed: 0,
};

let player, bullets, enemyBullets, towers, particles, camera, stars;
let floatingTexts;

function resetGame() {
  player = new Player(WORLD_W / 2, WORLD_H / 2);
  bullets = [];
  enemyBullets = [];
  particles = [];
  floatingTexts = [];
  const world = generateWorld(player.x, player.y);
  towers = world.towers;
  stars = makeStarfield(160);
  camera = { x: player.x, y: player.y };
  state.score = 0;
  state.towersDestroyed = 0;
}

function addFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
}

function startGame() {
  resetGame();
  state.mode = 'playing';
  screenStart.classList.add('hidden');
  screenGameOver.classList.add('hidden');
}

btnStart.addEventListener('click', startGame);
btnRetry.addEventListener('click', startGame);

// Initialize world state immediately so the background/menu has something to render.
resetGame();

let lastTime = performance.now();

function update(dt) {
  if (state.mode !== 'playing') return;

  // --- Input -> steering ---
  if (input.hasDirection) {
    const angle = Math.atan2(input.dirY, input.dirX);
    player.setTargetAngle(angle);
  } else {
    const kb = input.keyboardDirection();
    if (kb) player.setTargetAngle(Math.atan2(kb.y, kb.x));
  }

  player.update(dt);
  player.x = clamp(player.x, player.radius, WORLD_W - player.radius);
  player.y = clamp(player.y, player.radius, WORLD_H - player.radius);

  // --- Firing ---
  const wantsFire = input.isFiring || input.keyboardFiring();
  if (wantsFire && player.canFire()) {
    bullets.push(player.fire());
  }
  input.clearFrameFlags();

  // --- Camera follows player exactly (ship always screen-centered) ---
  camera.x = player.x;
  camera.y = player.y;

  // --- Update bullets ---
  for (const b of bullets) b.update(dt);
  for (const b of enemyBullets) b.update(dt);
  bullets = bullets.filter(b => !b.dead);
  enemyBullets = enemyBullets.filter(b => !b.dead);

  // --- Towers ---
  for (const t of towers) {
    t.update(dt, player, enemyBullets);
  }

  // Player bullets vs towers
  for (const b of bullets) {
    if (b.dead) continue;
    for (const t of towers) {
      if (t.dead) continue;
      if (dist(b.x, b.y, t.x, t.y) < t.radius + b.radius) {
        b.dead = true;
        const justDied = t.takeDamage(b.damage);
        if (justDied) {
          spawnExplosion(particles, t.x, t.y, '#ffb14d', 22);
          state.score += t.scoreValue;
          state.towersDestroyed++;
          addFloatingText(t.x, t.y - 30, `+${t.scoreValue}`, '#ffd76a');
        }
        break;
      }
    }
  }

  // Enemy bullets vs player
  for (const b of enemyBullets) {
    if (b.dead) continue;
    if (dist(b.x, b.y, player.x, player.y) < player.radius + b.radius) {
      b.dead = true;
      const hit = player.takeDamage(b.damage);
      if (hit) spawnExplosion(particles, player.x, player.y, '#7db8ff', 10);
    }
  }
  enemyBullets = enemyBullets.filter(b => !b.dead);
  bullets = bullets.filter(b => !b.dead);

  // Cull bullets far from player (perf) and out of world bounds
  bullets = bullets.filter(b => b.x > -100 && b.x < WORLD_W + 100 && b.y > -100 && b.y < WORLD_H + 100);
  enemyBullets = enemyBullets.filter(b => b.x > -100 && b.x < WORLD_W + 100 && b.y > -100 && b.y < WORLD_H + 100);

  // --- Particles ---
  for (const p of particles) p.update(dt);
  particles = particles.filter(p => !p.dead);

  // --- Floating texts ---
  for (const f of floatingTexts) {
    f.y -= 26 * dt;
    f.life -= dt;
  }
  floatingTexts = floatingTexts.filter(f => f.life > 0);

  // --- Game over check ---
  if (!player.alive) {
    state.mode = 'gameover';
    gameoverStats.textContent = `Score: ${state.score} · Towers destroyed: ${state.towersDestroyed}`;
    screenGameOver.classList.remove('hidden');
  }
}

function drawJoystick() {
  if (!input.stickActive) return;
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = '#9db3ff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(input.stickBaseX, input.stickBaseY, input.stickRadius, 0, TWO_PI);
  ctx.stroke();

  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#6a8bff';
  ctx.beginPath();
  ctx.arc(input.stickThumbX, input.stickThumbY, 26, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawHUD() {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillStyle = '#ffd76a';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.fillText(`Score ${state.score}`, 16, 14);
  ctx.restore();

  // Health bar
  const barW = Math.min(220, width * 0.5);
  const barH = 12;
  const x = 16;
  const y = 46;
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, barW, barH);
  const pct = clamp(player.health / player.maxHealth, 0, 1);
  ctx.fillStyle = pct > 0.35 ? '#5be36a' : '#ff5d5d';
  ctx.fillRect(x, y, barW * pct, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, barW, barH);
  ctx.restore();

}

function render() {
  drawBackground(ctx, camera, width, height, stars);

  ctx.save();
  ctx.translate(width / 2 - camera.x, height / 2 - camera.y);

  drawWorldBoundsInline();

  for (const t of towers) t.draw(ctx);
  for (const b of bullets) b.draw(ctx);
  for (const b of enemyBullets) b.draw(ctx);
  for (const p of particles) p.draw(ctx);

  if (state.mode === 'playing') player.draw(ctx);

  for (const f of floatingTexts) {
    ctx.save();
    ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }

  ctx.restore();

  if (state.mode === 'playing') {
    drawHUD();
    drawJoystick();
  }
}

function drawWorldBoundsInline() {
  ctx.save();
  ctx.strokeStyle = 'rgba(120, 150, 255, 0.35)';
  ctx.lineWidth = 6;
  ctx.shadowColor = 'rgba(100, 140, 255, 0.6)';
  ctx.shadowBlur = 20;
  ctx.strokeRect(0, 0, WORLD_W, WORLD_H);
  ctx.restore();
}

function loop(now) {
  let dt = (now - lastTime) / 1000;
  dt = clamp(dt, 0, 0.05);
  lastTime = now;

  update(dt);
  render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

// Exposed for debugging/QA only.
window.__game = {
  state,
  input,
  get player() { return player; },
  get towers() { return towers; },
  get bullets() { return bullets; },
};
