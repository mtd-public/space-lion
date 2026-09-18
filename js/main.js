import { InputManager } from './input.js';
import { Player, Tower } from './entities.js';
import { GoldPickup, RingCourse } from './collectibles.js';
import { Sentinel, SpaceLionBoss } from './boss.js';
import { generateLayout, buildBackdrop, WORLD_HALF_X, WORLD_HALF_Z, BOSS_ARENA, PLAYER_START } from './world.js';
import { worldToScreen, disposeObject3D } from './three-utils.js';
import { clamp, dist } from './utils.js';
import { drawHUD } from './hud.js';

const THREE = window.THREE;
const SA = window.SpaceAssets;

const webglCanvas = document.getElementById('webgl');
const hudCanvas = document.getElementById('hud');
const inputLayer = document.getElementById('input-layer');

const screenStart = document.getElementById('screen-start');
const screenGameOver = document.getElementById('screen-gameover');
const screenVictory = document.getElementById('screen-victory');
const screenPaused = document.getElementById('screen-paused');
const btnStart = document.getElementById('btn-start');
const btnRetry = document.getElementById('btn-retry');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const gameoverStats = document.getElementById('gameover-stats');
const victoryStats = document.getElementById('victory-stats');

let width = window.innerWidth;
let height = window.innerHeight;
let dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

// ---------- renderer / scene / camera ----------

const scene = new THREE.Scene();

const renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(dpr);
if (THREE.sRGBEncoding !== undefined) renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const VIEW_SIZE = 20; // half-height of the visible world, in world units
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 500);
camera.up.set(0, 0, -1);

const hudCtx = hudCanvas.getContext('2d');

let composer = null;
let bloomPass = null;
function setupComposer() {
  try {
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(width, height), 0.75, 0.55, 0.84);
    composer.addPass(bloomPass);
  } catch (e) {
    console.warn('Bloom post-processing unavailable, rendering without it.', e);
    composer = null;
    bloomPass = null;
  }
}
setupComposer();

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, true);

  const aspect = width / height;
  camera.left = -VIEW_SIZE * aspect;
  camera.right = VIEW_SIZE * aspect;
  camera.top = VIEW_SIZE;
  camera.bottom = -VIEW_SIZE;
  camera.updateProjectionMatrix();

  hudCanvas.width = Math.floor(width * dpr);
  hudCanvas.height = Math.floor(height * dpr);
  hudCanvas.style.width = width + 'px';
  hudCanvas.style.height = height + 'px';
  hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (composer) composer.setSize(width, height);
}
window.addEventListener('resize', resize);

// ---------- lighting / environment / backdrop ----------

scene.add(new THREE.HemisphereLight(0x8fa8ff, 0x0a0a18, 0.75));
const sun = new THREE.DirectionalLight(0xfff2df, 1.2);
sun.position.set(-40, 70, 25);
scene.add(sun);

scene.environment = SA.createEnvironment(renderer);
buildBackdrop(THREE, scene);

// ---------- lightweight destruction sparks ----------

class Spark {
  constructor(scene, x, z, color) {
    this.scene = scene;
    this.sprite = SA.glow(color, 1.1, 1);
    this.sprite.position.set(x, 0.6, z);
    scene.add(this.sprite);
    const a = Math.random() * Math.PI * 2;
    const s = 4 + Math.random() * 9;
    this.vx = Math.cos(a) * s;
    this.vz = Math.sin(a) * s;
    this.vy = 2 + Math.random() * 4;
    this.life = 0.45 + Math.random() * 0.3;
    this.maxLife = this.life;
    this.dead = false;
  }
  update(dt) {
    this.sprite.position.x += this.vx * dt;
    this.sprite.position.z += this.vz * dt;
    this.sprite.position.y += this.vy * dt;
    this.vx *= 0.9; this.vz *= 0.9; this.vy -= dt * 6;
    this.life -= dt;
    const k = Math.max(0, this.life / this.maxLife);
    this.sprite.material.opacity = k * 0.95;
    this.sprite.scale.setScalar(1.1 * (0.5 + 0.5 * k));
    if (this.life <= 0) this.dead = true;
  }
  dispose() {
    this.scene.remove(this.sprite);
    this.sprite.material.dispose();
  }
}
function spawnSparks(list, scene, x, z, color, count) {
  for (let i = 0; i < count; i++) list.push(new Spark(scene, x, z, color));
}

// ---------- input ----------

const input = new InputManager(inputLayer);

// ---------- game state ----------

const state = {
  mode: 'menu', // 'menu' | 'playing' | 'paused' | 'gameover' | 'victory'
  score: 0,
  gold: 0,
  towersDestroyed: 0,
};

let player, bullets, enemyBullets, towers, golds, ringCourses, sparks;
let sentinel, spaceLion, spaceLionPending, spaceLionTimer;
let floatingTexts, messages;
let elapsed;

function addMessage(text, color) {
  messages.push({ text, color, life: 3, maxLife: 3 });
  if (messages.length > 2) messages.shift();
}

function addFloatingText(x, y, z, text, color) {
  const p = worldToScreen(THREE, x, y, z, camera, width, height);
  floatingTexts.push({ x: p.x, y: p.y, text, color, life: 1, maxLife: 1 });
}

function disposeEntities() {
  if (!towers) return;
  for (const t of towers) t.dispose();
  for (const g of golds) g.dispose();
  for (const b of bullets) b.dispose();
  for (const b of enemyBullets) b.dispose();
  for (const s of sparks) s.dispose();
  if (player) player.dispose();
  if (sentinel) { scene.remove(sentinel.mesh); disposeObject3D(sentinel.mesh); }
  if (spaceLion) { scene.remove(spaceLion.mesh); disposeObject3D(spaceLion.mesh); }
  for (const rc of ringCourses) { scene.remove(rc.group); disposeObject3D(rc.group); }
}

function resetGame() {
  disposeEntities();

  elapsed = 0;
  bullets = [];
  enemyBullets = [];
  sparks = [];
  floatingTexts = [];
  messages = [];
  state.score = 0;
  state.gold = 0;
  state.towersDestroyed = 0;

  player = new Player(scene, PLAYER_START.x, PLAYER_START.z);

  const layout = generateLayout();
  towers = layout.towers.map((t) => new Tower(scene, t.x, t.z, t.seed));
  golds = layout.golds.map((g) => new GoldPickup(scene, g.x, g.z, 1));
  ringCourses = layout.ringCourses.map((r) => new RingCourse(scene, r.x, r.z, r.yaw, 4, 6));

  sentinel = new Sentinel(scene, BOSS_ARENA.x, BOSS_ARENA.z);
  spaceLion = new SpaceLionBoss(scene, BOSS_ARENA.x, BOSS_ARENA.z);
  spaceLionPending = false;
  spaceLionTimer = 0;

  camera.position.set(player.x, 55, player.z);
  camera.lookAt(player.x, 0, player.z);
}

function startGame() {
  resetGame();
  state.mode = 'playing';
  screenStart.classList.add('hidden');
  screenGameOver.classList.add('hidden');
  screenVictory.classList.add('hidden');
  screenPaused.classList.add('hidden');
  btnPause.classList.remove('hidden');
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  btnPause.classList.add('hidden');
  screenPaused.classList.remove('hidden');
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  screenPaused.classList.add('hidden');
  btnPause.classList.remove('hidden');
}

btnStart.addEventListener('click', startGame);
btnRetry.addEventListener('click', startGame);
btnPlayAgain.addEventListener('click', startGame);
btnPause.addEventListener('click', pauseGame);
btnResume.addEventListener('click', resumeGame);

resize();
resetGame();

// ---------- boss event -> HUD message wiring ----------

function onSentinelEvent(kind) {
  if (kind === 'sentinel-spawn') addMessage('SENTINEL DETECTED', '#ff4470');
  else if (kind === 'sentinel-retreat') addMessage('SENTINEL RETREATING', '#ffb347');
  else if (kind === 'sentinel-defeated') {
    addMessage('SENTINEL DESTROYED', '#5be36a');
    spaceLionPending = true;
    spaceLionTimer = 6;
  }
}

// ---------- main update ----------

function update(dt, t) {
  if (state.mode !== 'playing') return;

  if (input.hasDirection) {
    player.setTargetAngle(Math.atan2(input.dirY, input.dirX));
  } else {
    const kb = input.keyboardDirection();
    if (kb) player.setTargetAngle(Math.atan2(kb.y, kb.x));
  }

  player.update(dt, t);
  player.x = clamp(player.x, -WORLD_HALF_X + player.radius, WORLD_HALF_X - player.radius);
  player.z = clamp(player.z, -WORLD_HALF_Z + player.radius, WORLD_HALF_Z - player.radius);

  const wantsFire = input.isFiring || input.keyboardFiring();
  if (wantsFire && player.canFire()) bullets.push(player.fire());
  input.clearFrameFlags();

  camera.position.set(player.x, 55, player.z);
  camera.lookAt(player.x, 0, player.z);

  // Reticle lock-on flourish: light up if aimed near a live hostile.
  let locked = false;
  const rx = player.reticleX, rz = player.reticleZ;
  for (const tw of towers) { if (!tw.dead && dist(rx, rz, tw.x, tw.z) < 3) { locked = true; break; } }
  if (!locked && sentinel.isActive && dist(rx, rz, sentinel.worldX, sentinel.worldZ) < 4) locked = true;
  if (!locked && spaceLion.active && dist(rx, rz, spaceLion.x, spaceLion.z) < 5) locked = true;
  player.reticle.userData.setLock(locked);

  for (const b of bullets) b.update(dt, t);
  for (const b of enemyBullets) b.update(dt, t);

  for (const tw of towers) if (!tw.dead) tw.update(dt, t, player, enemyBullets);
  sentinel.update(dt, t, player, enemyBullets, onSentinelEvent);
  if (spaceLion.active) spaceLion.update(dt, t, player, enemyBullets);

  if (spaceLionPending) {
    spaceLionTimer -= dt;
    if (spaceLionTimer <= 0) {
      spaceLionPending = false;
      spaceLion.spawn();
      addMessage('THE SPACE LION AWAKENS', '#ffd76a');
    }
  }

  // player bullets vs towers
  for (const b of bullets) {
    if (b.dead) continue;
    for (const tw of towers) {
      if (tw.dead) continue;
      if (dist(b.x, b.z, tw.x, tw.z) < tw.radius + b.radius) {
        b.dead = true;
        const justDied = tw.takeDamage(b.damage);
        if (justDied) {
          spawnSparks(sparks, scene, tw.x, tw.z, 0xffb14d, 20);
          state.score += tw.scoreValue;
          state.towersDestroyed++;
          addFloatingText(tw.x, 1.2, tw.z, `+${tw.scoreValue}`, '#ffd76a');
        }
        break;
      }
    }
  }

  // player bullets vs Sentinel
  if (sentinel.isActive) {
    for (const b of bullets) {
      if (b.dead) continue;
      if (dist(b.x, b.z, sentinel.worldX, sentinel.worldZ) < sentinel.radius + b.radius) {
        b.dead = true;
        const result = sentinel.damage(b.damage, onSentinelEvent);
        if (result === 'retreat') { state.score += sentinel.scoreValue; addFloatingText(sentinel.worldX, 2, sentinel.worldZ, `+${sentinel.scoreValue}`, '#ff9ab0'); }
        else if (result === 'defeated') { state.score += sentinel.defeatScoreValue; addFloatingText(sentinel.worldX, 2, sentinel.worldZ, `+${sentinel.defeatScoreValue}`, '#5be36a'); }
        else if (result === 'hit') state.score += 15;
      }
    }
  }

  // player bullets vs Space Lion
  if (spaceLion.active) {
    for (const b of bullets) {
      if (b.dead) continue;
      if (dist(b.x, b.z, spaceLion.x, spaceLion.z) < spaceLion.radius + b.radius) {
        b.dead = true;
        const result = spaceLion.damage(b.damage);
        if (result === 'defeated') {
          state.score += 5000;
          addFloatingText(spaceLion.x, 3, spaceLion.z, '+5000', '#ffd76a');
          triggerVictory();
        } else if (result === 'hit') {
          state.score += 12;
        }
      }
    }
  }

  // enemy bullets vs player
  for (const b of enemyBullets) {
    if (b.dead) continue;
    if (dist(b.x, b.z, player.x, player.z) < player.radius + b.radius) {
      b.dead = true;
      const hit = player.takeDamage(b.damage);
      if (hit) spawnSparks(sparks, scene, player.x, player.z, 0x7db8ff, 8);
    }
  }

  // boss body contact damage
  if (sentinel.isActive && dist(player.x, player.z, sentinel.worldX, sentinel.worldZ) < player.radius + sentinel.radius) {
    if (player.takeDamage(18)) spawnSparks(sparks, scene, player.x, player.z, 0x7db8ff, 8);
  }
  if (spaceLion.active && dist(player.x, player.z, spaceLion.x, spaceLion.z) < player.radius + spaceLion.radius) {
    if (player.takeDamage(spaceLion.contactDamage)) spawnSparks(sparks, scene, player.x, player.z, 0x7db8ff, 8);
  }

  // player vs gold
  for (const g of golds) {
    if (g.collected) continue;
    if (dist(player.x, player.z, g.x, g.z) < player.radius + g.radius) {
      g.collect();
      state.gold += g.value;
      state.score += 15;
      addFloatingText(g.x, 1.2, g.z, '+15', '#ffc247');
    }
  }

  // player vs rings
  for (const rc of ringCourses) {
    const pos = rc.nextRingWorldPos();
    if (!pos) continue;
    if (dist(player.x, player.z, pos.x, pos.z) < player.radius + rc.collisionRadius) {
      const completedCourse = rc.clearNext();
      state.score += 60;
      addFloatingText(pos.x, 1.2, pos.z, '+60', '#4fe3ff');
      if (completedCourse) {
        state.score += 300;
        addMessage('RING COURSE CLEAR +300', '#4fe3ff');
      }
    }
  }

  // cleanup dead/expired
  for (const b of bullets) if (b.dead) b.dispose();
  bullets = bullets.filter((b) => !b.dead);
  for (const b of enemyBullets) if (b.dead) b.dispose();
  enemyBullets = enemyBullets.filter((b) => !b.dead);

  for (const g of golds) g.update(dt, t);
  for (const g of golds) if (g.done) g.dispose();
  golds = golds.filter((g) => !g.done);

  for (const rc of ringCourses) rc.update(dt, t);

  for (const s of sparks) s.update(dt);
  for (const s of sparks) if (s.dead) s.dispose();
  sparks = sparks.filter((s) => !s.dead);

  for (const f of floatingTexts) { f.y -= 28 * dt; f.life -= dt; }
  floatingTexts = floatingTexts.filter((f) => f.life > 0);
  for (const m of messages) m.life -= dt;
  messages = messages.filter((m) => m.life > 0);

  if (!player.alive) {
    state.mode = 'gameover';
    btnPause.classList.add('hidden');
    gameoverStats.textContent = `Score: ${state.score} · Gold: ${state.gold} · Towers destroyed: ${state.towersDestroyed}`;
    screenGameOver.classList.remove('hidden');
  }
}

function triggerVictory() {
  if (state.mode !== 'playing') return;
  state.mode = 'victory';
  btnPause.classList.add('hidden');
  victoryStats.textContent = `Score: ${state.score} · Gold: ${state.gold} · Towers destroyed: ${state.towersDestroyed}`;
  screenVictory.classList.remove('hidden');
}

function reapTowers() {
  const alive = [];
  for (const tw of towers) {
    if (tw.dead) {
      if (tw.mesh.parent) tw.dispose();
    } else {
      alive.push(tw);
    }
  }
  towers = alive;
}

function render() {
  if (composer) composer.render();
  else renderer.render(scene, camera);

  drawHUD(hudCtx, width, height, {
    score: state.score,
    gold: state.gold,
    player,
    sentinel,
    spaceLion,
    floatingTexts,
    messages,
  });
}

let lastTime = performance.now();
function loop(now) {
  let dt = (now - lastTime) / 1000;
  dt = clamp(dt, 0, 0.05);
  lastTime = now;
  elapsed += dt;

  update(dt, elapsed);
  reapTowers();
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
  get golds() { return golds; },
  get ringCourses() { return ringCourses; },
  get bullets() { return bullets; },
  get sentinel() { return sentinel; },
  get spaceLion() { return spaceLion; },
  startGame,
};
