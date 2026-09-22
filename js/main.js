import { InputManager } from './input.js';
import { Player, Tower } from './entities.js';
import { GoldPickup, RingCourse } from './collectibles.js';
import { Sentinel, SpaceLionBoss } from './boss.js';
import { generateLayout, buildBackdrop, WORLD_HALF_X, WORLD_HALF_Z, BOSS_ARENA, PLAYER_START } from './world.js';
import { Fx } from './fx.js';
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

// Toy look (after gig-ambulance): sRGB output with linear-authored colours,
// no tone mapping so pastels stay true, physically-based light intensities,
// and soft shadow maps for the drop shadows.
const renderer = new THREE.WebGLRenderer({ canvas: webglCanvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(dpr);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.NoToneMapping;
renderer.physicallyCorrectLights = true;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// Orthographic camera pitched like a toy diorama. Screen-up is still world -Z,
// but world Z is foreshortened by sin(pitch) on screen.
const CAM_PITCH = SA.CAM_PITCH;
const SIN_PITCH = Math.sin(CAM_PITCH);
const CAM_OFFSET = new THREE.Vector3(0, Math.sin(CAM_PITCH), Math.cos(CAM_PITCH)).multiplyScalar(120);
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const camFocus = new THREE.Vector3();
let shake = 0;

const hudCtx = hudCanvas.getContext('2d');

// env(safe-area-inset-*) isn't readable from canvas code, so measure it.
const safeProbe = document.createElement('div');
safeProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);';
document.body.appendChild(safeProbe);
let safeTop = 0, safeBottom = 0;

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, true);

  // Half-height of the view: at least 12 units, widened in portrait so the
  // screen is always ~18 units across.
  const aspect = width / height;
  const half = Math.max(12, 9 / aspect);
  camera.left = -half * aspect;
  camera.right = half * aspect;
  camera.top = half;
  camera.bottom = -half;
  camera.updateProjectionMatrix();

  hudCanvas.width = Math.floor(width * dpr);
  hudCanvas.height = Math.floor(height * dpr);
  hudCanvas.style.width = width + 'px';
  hudCanvas.style.height = height + 'px';
  hudCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cs = getComputedStyle(safeProbe);
  safeTop = parseFloat(cs.paddingTop) || 0;
  safeBottom = parseFloat(cs.paddingBottom) || 0;
}
window.addEventListener('resize', resize);

function placeCamera(x, z, dt) {
  camFocus.set(x, 0, z);
  camera.position.copy(camFocus).add(CAM_OFFSET);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - (dt || 0) * 3);
  }
  camera.lookAt(camFocus);
  sun.position.copy(camFocus).add(SUN_OFFSET);
  sun.target.position.copy(camFocus);
}

// ---------- lighting / backdrop ----------

scene.add(new THREE.HemisphereLight(SA.lin(0xf1eaff), SA.lin(0x6e5ac8), 1.9));
const sun = new THREE.DirectionalLight(SA.lin(0xfff1dc), 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 140 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.03;
const SUN_OFFSET = new THREE.Vector3(-20, 45, 12);
scene.add(sun, sun.target);

const backdrop = buildBackdrop(THREE, scene);
const fx = new Fx(scene);

// ---------- input ----------

const input = new InputManager(inputLayer);

// ---------- game state ----------

const state = {
  mode: 'menu', // 'menu' | 'playing' | 'paused' | 'gameover' | 'victory'
  score: 0,
  gold: 0,
  towersDestroyed: 0,
};

let player, bullets, enemyBullets, towers, golds, ringCourses;
let sentinel, spaceLion, spaceLionPending, spaceLionTimer;
let floatingTexts, messages;
let elapsed;

function addMessage(text, kind) {
  messages.push({ text, kind, life: 2.6, maxLife: 2.6 });
  if (messages.length > 2) messages.shift();
}

function addFloatingText(x, y, z, text, color) {
  const p = worldToScreen(THREE, x, y, z, camera, width, height);
  floatingTexts.push({ x: p.x, y: p.y, text, color, life: 1.1, maxLife: 1.1 });
}

function disposeEntities() {
  if (!towers) return;
  for (const t of towers) t.dispose();
  for (const g of golds) g.dispose();
  for (const b of bullets) b.dispose();
  for (const b of enemyBullets) b.dispose();
  fx.clear();
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

  shake = 0;
  placeCamera(player.x, player.z, 0);
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
  if (kind === 'sentinel-spawn') addMessage('SENTINEL DETECTED!', 'bad');
  else if (kind === 'sentinel-retreat') { addMessage('SENTINEL RETREATING', 'warn'); fx.explode(sentinel.worldX, sentinel.worldZ); shake = 0.5; }
  else if (kind === 'sentinel-defeated') {
    addMessage('SENTINEL DESTROYED!', 'good');
    fx.explode(sentinel.worldX, sentinel.worldZ);
    fx.explode(sentinel.worldX + 1.5, sentinel.worldZ - 1);
    shake = 0.9;
    spaceLionPending = true;
    spaceLionTimer = 6;
  }
}

// ---------- main update ----------

function update(dt, t) {
  if (state.mode !== 'playing') return;

  // Screen direction -> world heading: undo the camera pitch's foreshortening
  // of world Z so the ship flies where the stick points on screen.
  if (input.hasDirection) {
    player.setTargetAngle(Math.atan2(input.dirY / SIN_PITCH, input.dirX));
  } else {
    const kb = input.keyboardDirection();
    if (kb) player.setTargetAngle(Math.atan2(kb.y / SIN_PITCH, kb.x));
  }

  player.update(dt, t);
  player.x = clamp(player.x, -WORLD_HALF_X + player.radius, WORLD_HALF_X - player.radius);
  player.z = clamp(player.z, -WORLD_HALF_Z + player.radius, WORLD_HALF_Z - player.radius);

  const wantsFire = input.isFiring || input.keyboardFiring();
  if (wantsFire && player.canFire()) bullets.push(player.fire());
  input.clearFrameFlags();

  placeCamera(player.x, player.z, dt);

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
      addMessage('THE SPACE LION AWAKENS!', 'gold');
      shake = 0.6;
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
        if (!justDied) { fx.hit(b.x, b.z); tw.mesh.userData.hitFlash && tw.mesh.userData.hitFlash(); }
        if (justDied) {
          fx.explode(tw.x, tw.z);
          shake = Math.max(shake, 0.45);
          state.score += tw.scoreValue;
          state.towersDestroyed++;
          addFloatingText(tw.x, 1.2, tw.z, `+${tw.scoreValue}`, '#ffd45e');
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
        fx.hit(b.x, b.z);
        const result = sentinel.damage(b.damage, onSentinelEvent);
        if (result === 'retreat') { state.score += sentinel.scoreValue; addFloatingText(sentinel.worldX, 2, sentinel.worldZ, `+${sentinel.scoreValue}`, '#ff9fbd'); }
        else if (result === 'defeated') { state.score += sentinel.defeatScoreValue; addFloatingText(sentinel.worldX, 2, sentinel.worldZ, `+${sentinel.defeatScoreValue}`, '#3ddc84'); }
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
        fx.hit(b.x, b.z, 'orange');
        const result = spaceLion.damage(b.damage);
        if (result === 'defeated') {
          state.score += 5000;
          addFloatingText(spaceLion.x, 3, spaceLion.z, '+5000', '#ffd45e');
          for (let k = 0; k < 4; k++) fx.explode(spaceLion.x + (k - 1.5) * 2, spaceLion.z + (k % 2) * 2);
          shake = 1.2;
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
      if (hit) { fx.hurt(player.x, player.z); shake = Math.max(shake, 0.35); };
    }
  }

  // boss body contact damage
  if (sentinel.isActive && dist(player.x, player.z, sentinel.worldX, sentinel.worldZ) < player.radius + sentinel.radius) {
    if (player.takeDamage(18)) { fx.hurt(player.x, player.z); shake = Math.max(shake, 0.35); };
  }
  if (spaceLion.active && dist(player.x, player.z, spaceLion.x, spaceLion.z) < player.radius + spaceLion.radius) {
    if (player.takeDamage(spaceLion.contactDamage)) { fx.hurt(player.x, player.z); shake = Math.max(shake, 0.35); };
  }

  // player vs gold
  for (const g of golds) {
    if (g.collected) continue;
    if (dist(player.x, player.z, g.x, g.z) < player.radius + g.radius) {
      g.collect();
      state.gold += g.value;
      state.score += 15;
      addFloatingText(g.x, 1.2, g.z, '+15', '#ffd45e');
      fx.sparkle(g.x, g.z, 'star', 5);
    }
  }

  // player vs rings
  for (const rc of ringCourses) {
    const pos = rc.nextRingWorldPos();
    if (!pos) continue;
    if (dist(player.x, player.z, pos.x, pos.z) < player.radius + rc.collisionRadius) {
      const completedCourse = rc.clearNext();
      state.score += 60;
      addFloatingText(pos.x, 1.2, pos.z, '+60', '#6ff0dc');
      fx.sparkle(pos.x, pos.z, 'teal', 6);
      fx.shock(pos.x, pos.z, 0x35c3b2, 0.45);
      if (completedCourse) {
        state.score += 300;
        addMessage('RING COURSE CLEAR +300', 'ring');
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

  fx.update(dt);

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
  renderer.render(scene, camera);

  drawHUD(hudCtx, width, height, {
    input,
    playing: state.mode === 'playing',
    safeTop,
    safeBottom,
    time: elapsed,
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
  backdrop.update(elapsed);
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
  camera,
  fx,
  startGame,
};
