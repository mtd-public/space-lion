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

// ---------- backdrop ----------
// A purple-twilight "space mat" floor well below the flight layer, painted
// with nebula wisps and stars, with low-floating toy planets, crystals and
// moon rocks on it. Everything in the flight layer casts a soft drop shadow
// onto a shadow-catcher plane just above the floor.
export const FLOOR_Y = -4.5;
export const BACKDROP_COLOR = 0x2e2669;

export function buildBackdrop(THREE, scene) {
  const SA = window.SpaceAssets;
  const rng = SA.mulberry(20260922);
  const W = WORLD_HALF_X * 2 + 160;
  const H = WORLD_HALF_Z * 2 + 160;

  scene.background = SA.lin(BACKDROP_COLOR);

  // Floor: tiled painted texture, modulated by low-frequency vertex colours so
  // the tiling doesn't show, and darkened outside the play area.
  const floorGeo = new THREE.PlaneGeometry(W, H, 80, 100);
  floorGeo.rotateX(-Math.PI / 2);
  const pos = floorGeo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    let k = 0.9 + 0.1 * (Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.037 - 0.4) + 0.5 * Math.sin((x + z) * 0.021));
    const ox = Math.max(0, Math.abs(x) - WORLD_HALF_X), oz = Math.max(0, Math.abs(z) - WORLD_HALF_Z);
    const out = Math.min(1, Math.hypot(ox, oz) / 18);
    k *= 1 - out * 0.4;
    // warm the boss arena slightly
    const da = dist(x, z, BOSS_ARENA.x, BOSS_ARENA.z);
    const arena = Math.max(0, 1 - da / 30);
    cols[i * 3] = k * (1 + arena * 0.18);
    cols[i * 3 + 1] = k * (1 - arena * 0.05);
    cols[i * 3 + 2] = k * (1 + arena * 0.04);
  }
  floorGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const tex = makeFloorTexture(THREE);
  tex.repeat.set(W / 26, H / 26);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshBasicMaterial({ map: tex, vertexColors: true }));
  floor.position.y = FLOOR_Y;
  scene.add(floor);

  const catcherMat = new THREE.ShadowMaterial({ opacity: 0.32 });
  catcherMat.color.copy(SA.lin(0x1a1438));
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(W, H), catcherMat);
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = FLOOR_Y + 0.02;
  catcher.receiveShadow = true;
  scene.add(catcher);

  // Dashed hazard circle on the floor around the boss arena.
  const dash = dashedRing(THREE, 25, 25.7, 56);
  const dashMesh = new THREE.Mesh(dash, new THREE.MeshBasicMaterial({ color: SA.lin(0xff9fbd), transparent: true, opacity: 0.45 }));
  dashMesh.position.set(BOSS_ARENA.x, FLOOR_Y + 0.03, BOSS_ARENA.z);
  scene.add(dashMesh);

  // Floating toy decor on the floor.
  const decor = [];
  const kinds = ['planet', 'planet', 'crystal', 'rock', 'rock'];
  let attempts = 0;
  while (decor.length < 70 && attempts < 2000) {
    attempts++;
    const x = (rng() - 0.5) * (W - 40);
    const z = (rng() - 0.5) * (H - 40);
    if (decor.some((d) => dist(d.position.x, d.position.z, x, z) < 13)) continue;
    const d = SA.makeDecor(kinds[Math.floor(rng() * kinds.length)], rng);
    d.position.set(x, FLOOR_Y + d.userData.lift, z);
    d.rotation.y = rng() * Math.PI * 2;
    d.userData.phase = rng() * 6;
    scene.add(d);
    decor.push(d);
  }

  // Buoys marking the edge of the play area.
  const buoys = [];
  const addBuoy = (x, z) => {
    const b = SA.makeBuoy();
    b.position.set(x, SA.FLIGHT_Y - 1.3, z);
    b.userData.phase = rng() * 6;
    scene.add(b);
    buoys.push(b);
  };
  const STEP = 12;
  for (let x = -WORLD_HALF_X; x <= WORLD_HALF_X + 0.01; x += STEP) { addBuoy(x, -WORLD_HALF_Z - 1.5); addBuoy(x, WORLD_HALF_Z + 1.5); }
  for (let z = -WORLD_HALF_Z + STEP; z < WORLD_HALF_Z; z += STEP) { addBuoy(-WORLD_HALF_X - 1.5, z); addBuoy(WORLD_HALF_X + 1.5, z); }

  return {
    update(t) {
      for (const d of decor) {
        if (d.userData.spin) d.userData.spin.rotation.y = t * 0.2 + d.userData.phase;
        d.position.y = FLOOR_Y + d.userData.lift + Math.sin(t * 0.8 + d.userData.phase) * 0.12;
      }
      for (const b of buoys) b.position.y = SA.FLIGHT_Y - 1.3 + Math.sin(t * 1.5 + b.userData.phase) * 0.1;
      SA.updateBuoys(t);
    },
  };
}

function dashedRing(THREE, r0, r1, n) {
  const verts = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = a0 + (Math.PI * 2 / n) * 0.55;
    const p = (r, a) => [Math.cos(a) * r, 0, Math.sin(a) * r];
    const A = p(r0, a0), B = p(r1, a0), C = p(r1, a1), D = p(r0, a1);
    verts.push(...A, ...C, ...B, ...A, ...D, ...C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return g;
}

function makeFloorTexture(THREE) {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rng = window.SpaceAssets.mulberry(77);
  // draw with wrap-around so the tile is seamless
  const wrap = (x, y, r, fn) => {
    for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) {
      if (x + ox + r < 0 || x + ox - r > S || y + oy + r < 0 || y + oy - r > S) continue;
      fn(x + ox, y + oy);
    }
  };

  g.fillStyle = '#4a3c98';
  g.fillRect(0, 0, S, S);

  const neb = ['rgba(98,80,190,0.55)', 'rgba(120,78,176,0.45)', 'rgba(70,86,178,0.45)', 'rgba(88,70,170,0.5)'];
  for (let i = 0; i < 16; i++) {
    const x = rng() * S, y = rng() * S, r = 90 + rng() * 170;
    const col = neb[i % neb.length];
    wrap(x, y, r, (px, py) => {
      const grd = g.createRadialGradient(px, py, 0, px, py, r);
      grd.addColorStop(0, col);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
    });
  }

  // fine dust
  for (let i = 0; i < 420; i++) {
    const x = rng() * S, y = rng() * S, r = 1 + rng() * 1.6;
    g.fillStyle = `rgba(220,210,255,${0.2 + rng() * 0.25})`;
    wrap(x, y, r, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); });
  }
  // stars
  for (let i = 0; i < 46; i++) {
    const x = rng() * S, y = rng() * S, r = 2.5 + rng() * 2.5;
    g.fillStyle = rng() < 0.8 ? '#fff6e0' : '#ffd45e';
    wrap(x, y, r, (px, py) => { g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill(); });
  }
  // four-point sparkles
  const sparkCols = ['#ffd45e', '#ff9fbd', '#8ff0e4', '#fffdf8'];
  for (let i = 0; i < 14; i++) {
    const x = rng() * S, y = rng() * S, r = 9 + rng() * 9;
    g.fillStyle = sparkCols[i % sparkCols.length];
    wrap(x, y, r, (px, py) => {
      g.beginPath();
      g.moveTo(px, py - r);
      g.quadraticCurveTo(px, py, px + r, py);
      g.quadraticCurveTo(px, py, px, py + r);
      g.quadraticCurveTo(px, py, px - r, py);
      g.quadraticCurveTo(px, py, px, py - r);
      g.fill();
    });
  }
  // a few tiny painted ringed planets
  for (let i = 0; i < 3; i++) {
    const x = rng() * S, y = rng() * S, r = 10 + rng() * 8;
    wrap(x, y, r * 2, (px, py) => {
      g.fillStyle = ['#7a68c8', '#8a5fb8', '#5f6fc0'][i];
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(200,185,255,0.7)';
      g.lineWidth = 3;
      g.beginPath(); g.ellipse(px, py, r * 1.8, r * 0.5, -0.4, 0, Math.PI * 2); g.stroke();
    });
  }

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.encoding = THREE.sRGBEncoding;
  tex.anisotropy = 4;
  return tex;
}
