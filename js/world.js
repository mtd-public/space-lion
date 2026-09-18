import { rand, dist } from './utils.js';

// World is centered on the origin, on the XZ plane (Y is up). The player
// starts at the origin and the Sentinel/Space Lion arena sits to the "north"
// (negative Z, since every model's local -Z is forward / screen-up).
export const WORLD_HALF_X = 90;
export const WORLD_HALF_Z = 120;
export const BOSS_ARENA = { x: 0, z: -95 };
export const PLAYER_START = { x: 0, z: 40 };

export function generateLayout() {
  const towers = [];
  const minDistFromPlayer = 26;
  const minDistFromArena = 32;
  const targetTowers = 18;
  let attempts = 0;
  while (towers.length < targetTowers && attempts < 800) {
    attempts++;
    const x = rand(-WORLD_HALF_X + 10, WORLD_HALF_X - 10);
    const z = rand(-WORLD_HALF_Z + 10, WORLD_HALF_Z - 10);
    if (dist(x, z, PLAYER_START.x, PLAYER_START.z) < minDistFromPlayer) continue;
    if (dist(x, z, BOSS_ARENA.x, BOSS_ARENA.z) < minDistFromArena) continue;
    if (towers.some((t) => dist(t.x, t.z, x, z) < 16)) continue;
    towers.push({ x, z, seed: attempts * 0.37 + 1 });
  }

  const golds = [];
  const targetGold = 32;
  attempts = 0;
  while (golds.length < targetGold && attempts < 800) {
    attempts++;
    const x = rand(-WORLD_HALF_X + 6, WORLD_HALF_X - 6);
    const z = rand(-WORLD_HALF_Z + 6, WORLD_HALF_Z - 6);
    if (dist(x, z, BOSS_ARENA.x, BOSS_ARENA.z) < 20) continue;
    if (golds.some((g) => dist(g.x, g.z, x, z) < 5)) continue;
    golds.push({ x, z });
  }

  const ringCourses = [];
  const targetRings = 5;
  attempts = 0;
  while (ringCourses.length < targetRings && attempts < 400) {
    attempts++;
    const x = rand(-WORLD_HALF_X + 20, WORLD_HALF_X - 20);
    const z = rand(-WORLD_HALF_Z + 30, WORLD_HALF_Z - 30);
    if (dist(x, z, BOSS_ARENA.x, BOSS_ARENA.z) < 28) continue;
    if (dist(x, z, PLAYER_START.x, PLAYER_START.z) < 18) continue;
    if (ringCourses.some((r) => dist(r.x, r.z, x, z) < 24)) continue;
    ringCourses.push({ x, z, yaw: rand(0, Math.PI * 2) });
  }

  return { towers, golds, ringCourses };
}

// Backdrop: a big vertex-coloured "sky" sphere plus a sparse starfield of
// THREE.Points, and a dark grid plane so motion/scale read clearly.
export function buildBackdrop(THREE, scene) {
  const skyGeo = new THREE.SphereGeometry(300, 24, 16);
  const pos = skyGeo.attributes.position;
  const colors = [];
  const top = new THREE.Color(0x2c3a7a), mid = new THREE.Color(0x0f1230), bot = new THREE.Color(0x030308);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 300;
    if (y > 0) tmp.copy(mid).lerp(top, y); else tmp.copy(mid).lerp(bot, -y);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  scene.add(sky);

  const starCount = 1400;
  const starPos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const r = rand(120, 280);
    const theta = rand(0, Math.PI * 2);
    const phi = Math.acos(rand(-1, 0.6));
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = Math.abs(r * Math.cos(phi)) * 0.6 + 20;
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xdfe8ff, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.85, fog: false });
  scene.add(new THREE.Points(starGeo, starMat));

  const grid = makeGridTexture(THREE);
  const groundMat = new THREE.MeshBasicMaterial({ map: grid, transparent: true, opacity: 0.55 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_HALF_X * 2.4, WORLD_HALF_Z * 2.4), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.35;
  scene.add(ground);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(WORLD_HALF_X * 2.4, WORLD_HALF_Z * 2.4),
    new THREE.MeshBasicMaterial({ color: 0x05060f })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.4;
  scene.add(floor);

  // Camera sits ~55 units above the play field looking straight down, so ground
  // depth is ~55-114 across the visible frustum; tuned to fade the distant
  // edges of the ground plane without touching near-camera gameplay.
  scene.fog = new THREE.Fog(0x05060f, 70, 170);
}

function makeGridTexture(THREE) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0)';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(120,150,255,0.35)';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, 0); g.lineTo(256, 0); g.lineTo(256, 256); g.lineTo(0, 256); g.closePath();
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(WORLD_HALF_X * 2.4 / 8, WORLD_HALF_Z * 2.4 / 8);
  return tex;
}
