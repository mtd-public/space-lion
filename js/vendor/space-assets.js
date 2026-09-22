/*  space-assets.js — procedural toy-style three.js (r136) assets for Space Lion
 *
 *  Art direction follows gig-ambulance / splashy-fish: chunky, smooth-shaded toy
 *  shapes with thin ink outlines (inverted hull) and soft drop shadows, pastel
 *  colours on a purple-twilight base, and saturated accents kept for gameplay
 *  reads (red = hostile, yellow = reward, teal = rings, blue = you).
 *
 *  Conventions
 *    - Y is up. The play field is the XZ plane. Every ship/turret faces -Z (screen-up).
 *    - Ships, bullets and rings fly on the flight layer at SA.FLIGHT_Y; the backdrop
 *      floor sits well below it so everything casts a soft shadow onto it.
 *    - Colours are authored as sRGB hex and converted to linear (renderer output is sRGB).
 *    - Each factory returns a THREE.Group. Call  obj.userData.update(time, dt)  every frame.
 *
 *  Factories
 *    makePlayerShip()   fire(), setThrust(0..1), setBank(-1..1)
 *    makePlayerBolt()
 *    makeReticle()      pulse(), setLock(bool)
 *    makeTower(seed)    aimAt(Vector3), charge(0..1), fire(), muzzleWorld(out)
 *    makeTowerShot()
 *    makeGold()         collect()
 *    makeRing()         setState('waiting' | 'next' | 'cleared')
 *    makeRingSet(n)     clearNext(), reset(), rings[]
 *    makeBossUFO()      setHealth(0..1), hitFlash(), warpOut(), warpIn(), lookAt(x, z)
 *    makeSpaceLion()    roar(), setHealth(0..1), hitFlash(), lookAt(x, z)
 *    makeParticle(kind) shared-resource fx bits ('puff' | 'smoke' | 'star' | 'chunk' | 'blue' | 'teal' | 'pink')
 *    makeShockRing(hex) flat expanding ring, setProgress(0..1)
 *    makeBuoy(), makeDecor(kind, rand)   backdrop pieces
 *    BossHealth         persistent-phases health model (see bottom)
 */
(function (global) {
  const THREE = global.THREE;
  const SA = {};

  const PAL = {
    ink: 0x3b2e5a,
    cream: 0xfffdf8,
    lav: 0xdccbf7,
    lilac: 0xa58cf2,
    purple: 0x6e5ac8,
    yellow: 0xffd45e,
    gold: 0xffc53a,
    orange: 0xff9e4a,
    pink: 0xff9fbd,
    blush: 0xff93a8,
    red: 0xff3d52,
    teal: 0x35c3b2,
    mint: 0x45c48e,
    sky: 0x86c4f0,
    blue: 0x5aa2f0,
    navy: 0x3a4572,
    white: 0xffffff,
    eye: 0x2a2433,
    glass: 0x8ee6f2,
  };
  SA.PAL = PAL;
  SA.COLORS = PAL;
  SA.CAM_PITCH = THREE.MathUtils.degToRad(58);
  SA.FLIGHT_Y = 0.45;

  /* ---------- materials ---------- */

  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const setLin = (color, hex) => color.setHex(hex).convertSRGBToLinear();
  SA.lin = lin;

  // Soft, smooth-shaded toy plastic.
  function toy(hex, o) {
    o = Object.assign({}, o);
    const em = o.emissive, ei = o.emissiveIntensity;
    delete o.emissive; delete o.emissiveIntensity;
    const m = new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.6, metalness: 0 }, o));
    m.color.copy(lin(hex));
    if (em != null) { m.emissive.copy(lin(em)); m.emissiveIntensity = ei == null ? 1 : ei; }
    return m;
  }
  function flat(hex, o) {
    const m = new THREE.MeshBasicMaterial(Object.assign({}, o));
    m.color.copy(lin(hex));
    return m;
  }
  // Shared resources are skipped by disposeObject3D (see js/three-utils.js).
  function shared(x) { x.userData.shared = true; return x; }

  /* ---------------------------------------------------------------
     Ink outlines — the inverted-hull trick. Each outlined mesh gets a
     back-faced copy pushed out along its normals in view space. The hull
     uses smoothed normals (averaged over coincident vertices) so hard
     edges and UV seams don't split the line open.
  --------------------------------------------------------------- */
  const OUTLINE = 0.065;
  const BOSS_OUTLINE = 0.11; // big silhouettes need a heavier line to read at the same weight
  const INK = lin(PAL.ink);
  function outlineMaterial(thickness) {
    return new THREE.ShaderMaterial({
      uniforms: { color: { value: INK }, thickness: { value: thickness } },
      vertexShader: /* glsl */ `
        uniform float thickness;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          mv.xyz += normalize(normalMatrix * normal) * thickness;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 color;
        void main() {
          gl_FragColor = vec4(color, 1.0);
          #include <encodings_fragment>
        }
      `,
      side: THREE.BackSide,
    });
  }
  const OUTLINE_MAT = shared(outlineMaterial(OUTLINE));
  const OUTLINE_THIN = shared(outlineMaterial(OUTLINE * 0.7));

  function smoothNormals(geo) {
    const pos = geo.attributes.position;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const nrm = geo.attributes.normal;
    const acc = new Map();
    const keys = new Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.round(pos.getX(i) * 1e3) + ',' + Math.round(pos.getY(i) * 1e3) + ',' + Math.round(pos.getZ(i) * 1e3);
      keys[i] = k;
      let a = acc.get(k);
      if (!a) { a = [0, 0, 0]; acc.set(k, a); }
      a[0] += nrm.getX(i); a[1] += nrm.getY(i); a[2] += nrm.getZ(i);
    }
    const out = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const a = acc.get(keys[i]);
      const l = Math.hypot(a[0], a[1], a[2]);
      if (l > 1e-4) { out[i * 3] = a[0] / l; out[i * 3 + 1] = a[1] / l; out[i * 3 + 2] = a[2] / l; }
      else { out[i * 3] = nrm.getX(i); out[i * 3 + 1] = nrm.getY(i); out[i * 3 + 2] = nrm.getZ(i); }
    }
    return new THREE.BufferAttribute(out, 3);
  }

  const hulls = new WeakMap();
  function hullOf(geo) {
    let h = hulls.get(geo);
    if (!h) {
      h = new THREE.BufferGeometry();
      h.setAttribute('position', geo.attributes.position);
      h.setAttribute('normal', smoothNormals(geo));
      if (geo.index) h.setIndex(geo.index);
      if (geo.userData.shared) h.userData.shared = true;
      hulls.set(geo, h);
    }
    return h;
  }

  /** A mesh with an ink outline that casts a soft shadow onto the floor. */
  function inked(geo, mat, om) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    const h = new THREE.Mesh(hullOf(geo), om || OUTLINE_MAT);
    h.userData.isHull = true;
    m.add(h);
    return m;
  }
  /** Small details (eyes, shines, lamps) skip the outline so they stay crisp. */
  function plain(geo, mat, shadow) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = shadow !== false;
    return m;
  }
  function setOutlines(obj, on) {
    obj.traverse((c) => { if (c.userData.isHull) c.visible = on; });
  }
  SA.setOutlines = setOutlines;

  /* ---------- geometry helpers ---------- */

  const ball = (r, w, h) => new THREE.SphereGeometry(r, w || 20, h || 14);
  function lathe(pts, segs) {
    return new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p[0], p[1])), segs || 24);
  }
  function arcPts(cx, cy, r, a0, a1, n, out) {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      out.push([Math.max(0, cx + Math.cos(a) * r), cy + Math.sin(a) * r]);
    }
    return out;
  }
  /** Capsule along Y, centred on the origin. */
  function capsule(r, len, segs) {
    const p = [];
    arcPts(0, -len / 2, r, -Math.PI / 2, 0, 5, p);
    arcPts(0, len / 2, r, 0, Math.PI / 2, 5, p);
    p[0][0] = 0; p[p.length - 1][0] = 0;
    return lathe(p, segs || 16);
  }
  /** A cylinder with rounded rims, base on y = 0. */
  function roundCyl(rb, rt, h, bev, segs) {
    const b = Math.min(bev, h / 2 - 1e-3, rb - 1e-3, rt - 1e-3);
    const p = [[0, 0]];
    arcPts(rb - b, b, b, -Math.PI / 2, 0, 3, p);
    arcPts(rt - b, h - b, b, 0, Math.PI / 2, 3, p);
    p.push([0, h]);
    return lathe(p, segs || 24);
  }
  /** A chunky bevelled box (RoundedBoxGeometry-style), centred on the origin. */
  function rbox(w, h, d, r, seg) {
    seg = seg || 3;
    r = Math.max(0.002, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    const S = seg * 2 + 1;
    const geo = new THREE.BoxGeometry(1, 1, 1, S, S, S);
    const pos = geo.attributes.position, nrm = geo.attributes.normal;
    const inner = 0.5 / S;
    const map = (u, hh) => {
      const a = Math.abs(u), s = Math.sign(u), ih = hh - r;
      return s * (a <= inner + 1e-6 ? (a / inner) * ih : ih + (a - inner) / (0.5 - inner) * r);
    };
    const v = new THREE.Vector3(), c = new THREE.Vector3();
    const hx = w / 2 - r, hy = h / 2 - r, hz = d / 2 - r;
    for (let i = 0; i < pos.count; i++) {
      v.set(map(pos.getX(i), w / 2), map(pos.getY(i), h / 2), map(pos.getZ(i), d / 2));
      c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
      v.sub(c);
      const L = v.length();
      if (L > 1e-6) {
        v.multiplyScalar(r / L);
        nrm.setXYZ(i, v.x / r, v.y / r, v.z / r);
      }
      pos.setXYZ(i, c.x + v.x, c.y + v.y, c.z + v.z);
    }
    return geo;
  }
  function starShape(points, ro, ri) {
    const s = new THREE.Shape();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? ro : ri;
      const a = i / (points * 2) * Math.PI * 2 + Math.PI / 2;
      if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    s.closePath();
    return s;
  }
  function starGeo(ro, ri, depth, bevel) {
    const g = new THREE.ExtrudeGeometry(starShape(5, ro, ri), {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 4,
    });
    g.translate(0, 0, -depth / 2);
    return g;
  }
  function smoothNoise(x, y, z) {
    return (Math.sin(x * 1.7 + z * 0.9) * Math.cos(y * 2.3 - x * 0.6) + Math.sin(z * 2.9 + y * 1.3) * 0.5) * 0.5;
  }
  /** A lumpy, smooth asteroid: flattened on top, tapering underneath like a floating island. */
  function blob(r, seed, squash, plateau, under) {
    const g = new THREE.SphereGeometry(r, 28, 18);
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      v.multiplyScalar(1 + smoothNoise(v.x * 1.1 + seed, v.y * 1.1, v.z * 1.1 - seed) * 0.16);
      v.y *= v.y < 0 ? squash * (under || 1) : squash;
      if (plateau != null && v.y > plateau) v.y = plateau + (v.y - plateau) * 0.15;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    g.computeVertexNormals();
    g.setAttribute('normal', smoothNormals(g));
    return g;
  }
  function mulberry(seed) {
    let a = (seed * 2654435761) >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  SA.mulberry = mulberry;

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  /** Flat overlay material (drawn on top of everything, for the reticle). */
  function overlay(hex) {
    return flat(hex, { transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  }

  /* ---------- player ship ---------- */

  SA.makePlayerShip = function () {
    const root = new THREE.Group();
    root.name = 'PlayerShip';
    const body = new THREE.Group(); // banks independently of heading
    body.position.y = SA.FLIGHT_Y;
    root.add(body);

    const cream = toy(PAL.cream, { roughness: 0.5 });
    const blue = toy(PAL.blue, { roughness: 0.5 });
    const navy = toy(PAL.navy, { roughness: 0.5 });
    const yellow = toy(PAL.yellow, { roughness: 0.45 });
    const glass = toy(PAL.glass, { roughness: 0.2 });

    const fus = inked(capsule(0.4, 1.1, 20), cream);
    fus.rotation.x = Math.PI / 2;
    fus.scale.z = 0.85;
    body.add(fus);

    const nose = inked(ball(0.3), blue);
    nose.scale.set(1, 0.85, 1);
    nose.position.z = -0.74;
    body.add(nose);

    const canopy = inked(ball(0.3, 20, 14), glass);
    canopy.scale.set(0.95, 0.75, 1.35);
    canopy.position.set(0, 0.28, -0.18);
    body.add(canopy);
    const shine = plain(ball(0.07, 10, 8), flat(PAL.white), false);
    shine.position.set(0.1, 0.47, -0.34);
    body.add(shine);

    // swept stubby wings with yellow tips
    const lights = [];
    for (const side of [-1, 1]) {
      const wing = inked(rbox(1.05, 0.14, 0.58, 0.07), blue);
      wing.position.set(side * 0.78, -0.03, 0.18);
      wing.rotation.y = -side * 0.32;
      body.add(wing);
      const tip = inked(rbox(0.24, 0.2, 0.52, 0.08), yellow);
      tip.position.set(side * 1.28, -0.02, 0.36);
      tip.rotation.y = -side * 0.32;
      body.add(tip);
      const lamp = plain(ball(0.08, 10, 8), flat(side < 0 ? PAL.red : PAL.mint), false);
      lamp.position.set(side * 1.42, 0.1, 0.4);
      body.add(lamp);
      lights.push(lamp);
    }

    const fin = inked(rbox(0.12, 0.55, 0.5, 0.05), blue);
    fin.position.set(0, 0.36, 0.55);
    fin.rotation.x = 0.35;
    body.add(fin);

    // engines, exhaust rings, toon flames
    const flames = [];
    const flameOuter = flat(PAL.orange), flameInner = flat(PAL.yellow);
    for (const side of [-1, 1]) {
      const eng = inked(capsule(0.19, 0.45, 14), navy);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(side * 0.36, -0.04, 0.62);
      body.add(eng);
      const ring = inked(new THREE.TorusGeometry(0.15, 0.055, 8, 18), yellow);
      ring.position.set(side * 0.36, -0.04, 0.98);
      body.add(ring);

      const flame = new THREE.Group();
      flame.position.set(side * 0.36, -0.04, 1.0);
      const og = new THREE.ConeGeometry(0.15, 0.7, 12); og.translate(0, 0.35, 0);
      const ig = new THREE.ConeGeometry(0.08, 0.42, 10); ig.translate(0, 0.21, 0);
      const outer = plain(og, flameOuter, false); outer.rotation.x = Math.PI / 2;
      const inner = plain(ig, flameInner, false); inner.rotation.x = Math.PI / 2; inner.position.y = 0.01;
      flame.add(outer, inner);
      body.add(flame);
      flames.push(flame);
    }

    // nose cannons + muzzle pops
    const muzzles = [];
    for (const side of [-1, 1]) {
      const gun = inked(capsule(0.075, 0.35, 10), navy);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(side * 0.55, -0.04, -0.28);
      body.add(gun);
      const pop = plain(ball(0.2, 12, 10), flat(PAL.yellow), false);
      pop.position.set(side * 0.55, -0.04, -0.66);
      pop.scale.setScalar(0.001);
      body.add(pop);
      muzzles.push(pop);
    }

    let thrust = 0.75, bank = 0, bankTarget = 0, muzzleT = 0;
    root.userData = {
      body,
      fire() { muzzleT = 1; },
      setThrust(v) { thrust = clamp01(v); },
      setBank(v) { bankTarget = Math.max(-1, Math.min(1, v)); },
      update(t, dt) {
        const fl = 0.85 + Math.sin(t * 45) * 0.1 + Math.sin(t * 29) * 0.06;
        for (const f of flames) f.scale.set(1 + Math.sin(t * 38) * 0.08, 1, (0.5 + thrust * 0.8) * fl);
        bank += (bankTarget - bank) * Math.min(1, dt * 6);
        body.rotation.z = -bank * 0.5;
        body.position.y = SA.FLIGHT_Y + Math.sin(t * 2.2) * 0.05;
        const blink = (t % 1.1) < 0.14 ? 1.5 : 0.8;
        for (const l of lights) l.scale.setScalar(blink);
        muzzleT = Math.max(0, muzzleT - dt * 9);
        for (const m of muzzles) m.scale.setScalar(Math.max(0.001, muzzleT * 1.1));
        body.scale.set(1, 1, 1 + muzzleT * 0.04);
      },
    };
    return root;
  };

  /* ---------- bullets (shared resources: fired many times a second) ---------- */

  let boltRes = null;
  SA.makePlayerBolt = function () {
    if (!boltRes) {
      const g = capsule(0.13, 0.5, 10);
      g.rotateX(Math.PI / 2);
      boltRes = { g: shared(g), m: shared(toy(0xffe27a, { emissive: 0xffd45e, emissiveIntensity: 0.55, roughness: 0.4 })) };
      shared(hullOf(boltRes.g));
    }
    const root = new THREE.Group();
    root.add(inked(boltRes.g, boltRes.m, OUTLINE_THIN));
    root.userData = { update() {} };
    return root;
  };

  let shotRes = null;
  SA.makeTowerShot = function () {
    if (!shotRes) {
      shotRes = {
        g: shared(ball(0.24, 16, 12)),
        m: shared(toy(PAL.red, { emissive: PAL.red, emissiveIntensity: 0.35, roughness: 0.35 })),
        sg: shared(ball(0.07, 8, 6)),
        sm: shared(flat(PAL.white)),
      };
      shared(hullOf(shotRes.g));
    }
    const root = new THREE.Group();
    const core = inked(shotRes.g, shotRes.m, OUTLINE_THIN);
    const shine = plain(shotRes.sg, shotRes.sm, false);
    shine.position.set(0.07, 0.15, 0.05);
    root.add(core, shine);
    root.userData = {
      update(t) { core.scale.setScalar(1 + Math.sin(t * 22) * 0.1); },
    };
    return root;
  };

  /* ---------- reticle: four chunky square corner brackets ---------- */

  SA.makeReticle = function () {
    const root = new THREE.Group();
    const flatG = new THREE.Group();
    flatG.rotation.x = -Math.PI / 2;
    flatG.position.y = SA.FLIGHT_Y;
    root.add(flatG);

    const inkM = overlay(PAL.ink);
    const fillM = overlay(PAL.cream);

    // One L-shaped bracket, drawn in the +X/+Y corner; the ink version is the
    // same shape grown outward so it reads as a thick outline.
    function bracketShape(arm, thick, grow) {
      const s = new THREE.Shape();
      const o = grow;
      s.moveTo(-o, -o);
      s.lineTo(arm + o, -o);
      s.lineTo(arm + o, thick + o);
      s.lineTo(thick + o, thick + o);
      s.lineTo(thick + o, arm + o);
      s.lineTo(-o, arm + o);
      s.closePath();
      return new THREE.ShapeGeometry(s);
    }
    const ARM = 0.34, THICK = 0.12, INK_W = 0.06;
    const inkGeo = bracketShape(ARM, THICK, INK_W);
    const fillGeo = bracketShape(ARM, THICK, 0);

    const corners = [];
    for (let i = 0; i < 4; i++) {
      const c = new THREE.Group();
      // corner i sits at 45° + i·90°; the L points its elbow outward
      c.rotation.z = i * Math.PI / 2 + Math.PI;
      const ink = new THREE.Mesh(inkGeo, inkM); ink.renderOrder = 20;
      const fill = new THREE.Mesh(fillGeo, fillM); fill.renderOrder = 21;
      c.add(ink, fill);
      flatG.add(c);
      corners.push(c);
    }

    // centre pip: a small square
    const pipInk = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), inkM); pipInk.renderOrder = 20;
    const pip = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.09), fillM); pip.renderOrder = 21;
    flatG.add(pipInk, pip);

    let pulseT = 0, lock = 0, lockTarget = 0;
    const cA = lin(PAL.cream), cB = lin(PAL.red);
    root.userData = {
      pulse() { pulseT = 1; },
      setLock(v) { lockTarget = v ? 1 : 0; },
      update(t, dt) {
        pulseT = Math.max(0, pulseT - dt * 7);
        lock += (lockTarget - lock) * Math.min(1, dt * 12);
        // brackets sit on the square's corners; lock pulls them in, firing kicks them out
        const half = 0.62 - lock * 0.16 + pulseT * 0.14 + Math.sin(t * 4) * 0.015 * (1 - lock);
        corners.forEach((c, i) => {
          const a = i * Math.PI / 2 + Math.PI / 4;
          const d = half * Math.SQRT2;
          c.position.set(Math.cos(a) * d, Math.sin(a) * d, 0);
        });
        fillM.color.copy(cA).lerp(cB, lock);
        pip.scale.setScalar(1 + lock * 0.6);
      },
    };
    return root;
  };

  /* ---------- enemy tower: grumpy one-eyed turret on a floating island ---------- */

  SA.makeTower = function (seed) {
    seed = seed || 1;
    const root = new THREE.Group();
    root.name = 'Tower';
    const rand = mulberry(Math.floor(seed * 9973));

    const rock = toy([0x9b8ae6, 0x8f86d8, 0xa592e8][Math.floor(rand() * 3)], { roughness: 0.85 });
    const turf = toy(0xe6dcff, { roughness: 0.7 });
    const navy = toy(PAL.navy, { roughness: 0.5 });
    const dark = toy(0x262b4f, { roughness: 0.5 });
    const red = toy(PAL.red, { roughness: 0.4 });
    const white = toy(PAL.white, { roughness: 0.3 });
    const domeM = toy(0xff6b7d, { roughness: 0.5 });
    const pupilM = toy(PAL.eye, { emissive: PAL.red, emissiveIntensity: 0, roughness: 0.3 });

    const island = new THREE.Group();
    root.add(island);
    const PLATEAU = 0.2;
    const body = inked(blob(1.5, seed, 0.5, PLATEAU, 1.7), rock);
    body.rotation.y = rand() * Math.PI * 2;
    island.add(body);
    const plate = inked(roundCyl(1.18, 1.12, 0.2, 0.08, 28), turf);
    plate.position.y = PLATEAU - 0.06;
    island.add(plate);
    const pebbles = [];
    for (let i = 0; i < 2; i++) {
      const p = inked(blob(0.28 + rand() * 0.12, seed + i * 3, 0.8), rock);
      const a = rand() * Math.PI * 2;
      p.position.set(Math.cos(a) * 1.0, -1.45 - rand() * 0.4, Math.sin(a) * 1.0);
      island.add(p);
      pebbles.push({ p, y: p.position.y, ph: rand() * 6 });
    }
    const top = PLATEAU + 0.14;

    const base = inked(roundCyl(0.78, 0.66, 0.42, 0.12, 24), navy);
    base.position.y = top;
    island.add(base);
    const band = inked(roundCyl(0.72, 0.7, 0.12, 0.04, 24), domeM);
    band.position.y = top + 0.24;
    island.add(band);

    // dashed-free "danger" halo around the turret; brightens as it charges
    const haloM = flat(PAL.red, { transparent: true, opacity: 0.35, depthWrite: false });
    const halo = new THREE.Mesh(new THREE.RingGeometry(1.28, 1.42, 40), haloM);
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = top + 0.01;
    island.add(halo);

    const head = new THREE.Group();
    head.position.y = top + 0.44;
    island.add(head);
    const dome = inked(ball(0.56, 24, 16), domeM);
    dome.scale.y = 0.82;
    head.add(dome);
    const eyeW = inked(ball(0.27, 18, 12), white);
    eyeW.scale.z = 0.6;
    eyeW.position.set(0, 0.18, -0.45);
    head.add(eyeW);
    const pupil = plain(ball(0.14, 14, 10), pupilM, false);
    pupil.scale.z = 0.5;
    pupil.position.set(0, 0.18, -0.6);
    head.add(pupil);
    const eyeShine = plain(ball(0.05, 8, 6), flat(PAL.white), false);
    eyeShine.position.set(0.07, 0.26, -0.66);
    head.add(eyeShine);
    for (const side of [-1, 1]) {
      const brow = inked(rbox(0.3, 0.08, 0.12, 0.035), dark);
      brow.position.set(side * 0.14, 0.46, -0.5);
      brow.rotation.z = side * 0.38;
      head.add(brow);
    }

    const barrels = new THREE.Group();
    head.add(barrels);
    const flashes = [];
    for (const side of [-1, 1]) {
      const br = inked(capsule(0.095, 0.55, 12), navy);
      br.rotation.x = Math.PI / 2;
      br.position.set(side * 0.27, -0.04, -0.58);
      barrels.add(br);
      const tip = inked(roundCyl(0.125, 0.125, 0.12, 0.04, 14), red);
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(side * 0.27, -0.04, -0.86);
      barrels.add(tip);
      const fl = plain(ball(0.2, 12, 10), flat(PAL.yellow), false);
      fl.position.set(side * 0.27, -0.04, -1.1);
      fl.scale.setScalar(0.001);
      barrels.add(fl);
      flashes.push(fl);
    }

    island.position.y = SA.FLIGHT_Y - 0.75;
    const baseY = island.position.y;

    let charge = 0, fireT = 0, hitT = 0, targetYaw = 0, manualAim = false;
    root.userData = {
      head,
      hitFlash() { hitT = 1; },
      muzzleWorld(out) { return barrels.localToWorld(out.set(0, -0.04, -1.05)); },
      aimAt(worldPos) {
        const local = root.worldToLocal(worldPos.clone());
        targetYaw = Math.atan2(-local.x, -local.z);
        manualAim = true;
      },
      charge(v) { charge = clamp01(v); },
      fire() { fireT = 1; charge = 0; },
      update(t, dt) {
        if (!manualAim) targetYaw = Math.sin(t * 0.6 + seed) * 1.4;
        let d = targetYaw - head.rotation.y;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        head.rotation.y += d * Math.min(1, dt * 5);
        island.position.y = baseY + Math.sin(t * 1.2 + seed) * 0.07;
        hitT = Math.max(0, hitT - dt * 6);
        island.scale.set(1 + hitT * 0.08, 1 - hitT * 0.1, 1 + hitT * 0.08);
        for (const pb of pebbles) pb.p.position.y = pb.y + Math.sin(t * 1.6 + pb.ph) * 0.12;
        fireT = Math.max(0, fireT - dt * 6);
        barrels.position.z = fireT * 0.16;
        for (const f of flashes) f.scale.setScalar(Math.max(0.001, fireT * 1.2));
        const late = Math.max(0, charge - 0.65) / 0.35;
        head.position.x = Math.sin(t * 70) * 0.035 * late;
        head.scale.setScalar(1 + late * 0.08 + fireT * 0.06);
        pupilM.emissiveIntensity = charge * charge * 3;
        pupil.scale.set(1 - charge * 0.35, 1 - charge * 0.35, 0.5);
        haloM.opacity = 0.22 + charge * 0.6 + Math.sin(t * 2 + seed) * 0.06;
        halo.scale.setScalar(1 + charge * 0.12);
      },
    };
    return root;
  };

  /* ---------- gold coin ---------- */

  SA.makeGold = function () {
    const root = new THREE.Group();
    root.name = 'Gold';
    const spin = new THREE.Group();
    spin.position.y = SA.FLIGHT_Y;
    root.add(spin);

    const goldM = toy(PAL.gold, { roughness: 0.35, emissive: 0xffb000, emissiveIntensity: 0.18 });
    const starM = toy(0xffe27a, { roughness: 0.35, emissive: 0xffd45e, emissiveIntensity: 0.2 });

    const cg = roundCyl(0.46, 0.46, 0.17, 0.07, 28);
    cg.translate(0, -0.085, 0);
    cg.rotateX(Math.PI / 2);
    spin.add(inked(cg, goldM));
    const sg = starGeo(0.23, 0.1, 0.04, 0.02);
    for (const side of [-1, 1]) {
      const s = plain(sg, starM, false);
      s.position.z = side * 0.09;
      if (side < 0) s.rotation.y = Math.PI;
      spin.add(s);
    }
    const shine = plain(ball(0.055, 8, 6), flat(PAL.white), false);
    shine.position.set(0.2, 0.2, 0.12);
    spin.add(shine);

    let collectT = -1;
    root.userData = {
      collect() { collectT = 0; },
      update(t, dt) {
        spin.rotation.y = t * 2.6;
        spin.position.y = SA.FLIGHT_Y + Math.sin(t * 2.5 + root.position.x) * 0.12;
        if (collectT >= 0) {
          collectT += dt;
          const k = Math.min(1, collectT / 0.45);
          spin.position.y += easeOut(k) * 1.6;
          const s = k < 0.25 ? 1 + k * 1.6 : 1.4 * (1 - (k - 0.25) / 0.75);
          spin.scale.setScalar(Math.max(0.001, s));
          setOutlines(spin, s > 0.35);
        }
      },
    };
    return root;
  };

  /* ---------- rings: striped pool-float hoops ---------- */

  const RING_STATES = {
    waiting: { base: 0xe9e1ff, stripe: PAL.lilac },
    next: { base: PAL.cream, stripe: PAL.teal },
    cleared: { base: PAL.cream, stripe: PAL.yellow },
  };

  SA.makeRing = function () {
    const root = new THREE.Group();
    root.name = 'Ring';
    const float = new THREE.Group();
    float.position.y = SA.FLIGHT_Y - 0.1;
    root.add(float);

    const baseM = toy(PAL.cream, { roughness: 0.45 });
    const stripeM = toy(PAL.teal, { roughness: 0.45 });

    const tg = new THREE.TorusGeometry(1.3, 0.2, 12, 48);
    tg.rotateX(Math.PI / 2);
    float.add(inked(tg, baseM));
    const sg = new THREE.TorusGeometry(1.3, 0.207, 12, 8, Math.PI / 6);
    sg.rotateX(Math.PI / 2);
    for (let i = 0; i < 6; i++) {
      const s = plain(sg, stripeM, false);
      s.rotation.y = i * Math.PI / 3;
      float.add(s);
    }

    const fieldM = flat(PAL.teal, { transparent: true, opacity: 0.2, depthWrite: false });
    const field = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), fieldM);
    field.rotation.x = -Math.PI / 2;
    field.position.y = -0.05;
    float.add(field);

    // two chevrons pointing along the course (-Z)
    const chev = new THREE.Shape();
    chev.moveTo(0, 0.34); chev.lineTo(0.36, 0.0); chev.lineTo(0.2, 0.0);
    chev.lineTo(0, 0.18); chev.lineTo(-0.2, 0.0); chev.lineTo(-0.36, 0.0); chev.closePath();
    const chevGeo = new THREE.ShapeGeometry(chev);
    const arrowM = flat(PAL.yellow, { transparent: true, depthWrite: false });
    const arrowInk = flat(PAL.ink, { transparent: true, depthWrite: false });
    const arrows = new THREE.Group();
    for (let i = 0; i < 2; i++) {
      const a = new THREE.Group();
      a.rotation.x = -Math.PI / 2;
      a.position.set(0, 0.0, 0.25 - i * 0.42);
      const inkA = new THREE.Mesh(chevGeo, arrowInk); inkA.scale.setScalar(1.25); inkA.position.y = -0.04;
      const fillA = new THREE.Mesh(chevGeo, arrowM); fillA.position.z = 0.01;
      a.add(inkA, fillA);
      arrows.add(a);
    }
    float.add(arrows);

    let state = 'waiting', clearT = 10;
    const apply = () => {
      setLin(baseM.color, RING_STATES[state].base);
      setLin(stripeM.color, RING_STATES[state].stripe);
      setLin(fieldM.color, RING_STATES[state].stripe);
    };
    apply();
    root.userData = {
      get state() { return state; },
      setState(s) { state = s; if (s === 'cleared') clearT = 0; apply(); },
      update(t, dt) {
        clearT += dt;
        const isNext = state === 'next';
        if (isNext) {
          float.position.y = SA.FLIGHT_Y - 0.1 + Math.sin(t * 3) * 0.08;
          float.rotation.y = Math.sin(t * 0.8) * 0.3;
          float.scale.setScalar(1 + Math.sin(t * 5) * 0.04);
          fieldM.opacity = 0.2 + Math.sin(t * 5) * 0.06;
          arrows.visible = true;
          arrowM.opacity = arrowInk.opacity = 1;
          arrows.position.z = -((t * 0.9) % 0.42);
        } else if (state === 'cleared') {
          const pop = clearT < 0.35 ? Math.sin(clearT / 0.35 * Math.PI) * 0.3 : 0;
          float.scale.setScalar(0.85 + pop);
          float.position.y += ((SA.FLIGHT_Y - 0.4) - float.position.y) * Math.min(1, dt * 3);
          fieldM.opacity = Math.max(0.04, 0.4 * (1 - clearT));
          arrows.visible = false;
        } else {
          float.position.y = SA.FLIGHT_Y - 0.25;
          float.scale.setScalar(0.92);
          fieldM.opacity = 0.08;
          arrows.visible = false;
        }
      },
    };
    return root;
  };

  // a gentle S-curve of rings; each ring faces along the path (-Z forward)
  SA.makeRingSet = function (count, spacing) {
    count = count || 5; spacing = spacing || 4;
    const root = new THREE.Group();
    const rings = [];
    for (let i = 0; i < count; i++) {
      const r = SA.makeRing();
      const z = -i * spacing;
      const x = Math.sin(i * 0.8) * 1.6;
      const dx = Math.cos(i * 0.8) * 1.6 * 0.8 / spacing;
      r.position.set(x, 0, z);
      r.rotation.y = Math.atan2(-dx, 1);
      root.add(r);
      rings.push(r);
    }
    let next = 0;
    const refresh = () => rings.forEach((r, i) => r.userData.setState(i < next ? 'cleared' : i === next ? 'next' : 'waiting'));
    refresh();
    root.userData = {
      rings,
      get nextIndex() { return next; },
      clearNext() { if (next < rings.length) { rings[next].userData.setState('cleared'); next++; if (next < rings.length) rings[next].userData.setState('next'); } return next >= rings.length; },
      reset() { next = 0; refresh(); },
      update(t, dt) { for (const r of rings) r.userData.update(t, dt); },
    };
    return root;
  };

  /* ---------- the Sentinel: a toy saucer whose dome is one big watchful eye ---------- */

  SA.makeBossUFO = function () {
    const root = new THREE.Group();
    root.name = 'BossUFO';
    const craft = new THREE.Group();
    root.add(craft);
    const om = outlineMaterial(BOSS_OUTLINE); // own copy so the line thins as it warps out

    const navy = toy(PAL.navy, { roughness: 0.5, emissive: PAL.white, emissiveIntensity: 0 });
    const lav = toy(0xb9a6f5, { roughness: 0.55, emissive: PAL.white, emissiveIntensity: 0 });
    const cream = toy(PAL.cream, { roughness: 0.5, emissive: PAL.white, emissiveIntensity: 0 });
    const white = toy(PAL.white, { roughness: 0.3, emissive: PAL.white, emissiveIntensity: 0 });
    const flashMats = [navy, lav, cream, white];

    const lower = inked(lathe([[0, -0.62], [1.2, -0.6], [2.2, -0.42], [2.85, -0.14], [3.05, 0.04], [0, 0.04]], 48), navy, om);
    craft.add(lower);
    const upper = inked(lathe([[3.05, 0.04], [2.9, 0.24], [2.2, 0.5], [1.3, 0.66], [0, 0.7]], 48), lav, om);
    craft.add(upper);
    const rimG = new THREE.TorusGeometry(3.0, 0.2, 10, 64);
    rimG.rotateX(Math.PI / 2);
    const rim = inked(rimG, cream, om);
    rim.position.y = 0.08;
    craft.add(rim);

    const lightRing = new THREE.Group();
    craft.add(lightRing);
    const bulbs = [];
    const bulbG = ball(0.15, 10, 8);
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const m = toy(PAL.red, { emissive: PAL.red, emissiveIntensity: 1, roughness: 0.3 });
      const b = plain(bulbG, m, false);
      b.position.set(Math.cos(a) * 3.0, 0.25, Math.sin(a) * 3.0);
      lightRing.add(b);
      bulbs.push(m);
    }

    // the eye
    const eye = new THREE.Group();
    eye.position.y = 0.62;
    craft.add(eye);
    const sclera = inked(ball(1.05, 28, 20), white, om);
    sclera.scale.y = 0.9;
    eye.add(sclera);
    const look = new THREE.Group();
    look.rotation.order = 'YXZ';
    eye.add(look);
    const iris = plain(ball(0.58, 22, 14), toy(PAL.red, { emissive: PAL.red, emissiveIntensity: 0.3, roughness: 0.35 }), false);
    iris.scale.y = 0.34;
    iris.position.y = 0.84;
    look.add(iris);
    const pupil = plain(ball(0.3, 16, 10), toy(PAL.eye, { roughness: 0.3 }), false);
    pupil.scale.y = 0.32;
    pupil.position.y = 0.96;
    look.add(pupil);
    const shine = plain(ball(0.11, 10, 8), flat(PAL.white), false);
    shine.position.set(0.18, 1.02, 0.08);
    look.add(shine);
    // eyelid: a navy half-shell that sweeps over the eye; lower = angrier
    const lidPivot = new THREE.Group();
    look.add(lidPivot);
    const lidM = toy(0x8a76d8, { roughness: 0.55, emissive: PAL.white, emissiveIntensity: 0 });
    flashMats.push(lidM);
    const lid = inked(new THREE.SphereGeometry(1.12, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), lidM, om);
    lid.scale.y = 0.92;
    lidPivot.add(lid);

    // damage: bandage crosses and puffs of smoke appear as health drops
    const damage = [];
    const spots = [[1.8, 0.45, 1.0], [-1.6, 0.45, -1.1], [0.3, 0.5, -2.1]];
    const smokeM = toy(0x5a4f7a, { roughness: 0.9 });
    const smokeG = ball(0.3, 12, 8);
    spots.forEach((p, i) => {
      const band = new THREE.Group();
      band.position.set(p[0], p[1], p[2]);
      band.lookAt(0, 3, 0);
      band.rotation.z += i;
      for (const r of [0.6, -0.6]) {
        const strip = inked(rbox(0.9, 0.24, 0.08, 0.04), cream, om);
        strip.rotation.z = r;
        band.add(strip);
      }
      band.visible = false;
      craft.add(band);
      const puffs = [];
      for (let k = 0; k < 3; k++) {
        const s = plain(smokeG, smokeM, false);
        s.visible = false;
        craft.add(s);
        puffs.push(s);
      }
      damage.push({ band, puffs, p, thresh: [0.75, 0.5, 0.25][i] });
    });

    // warp sparkle ring
    const warpInk = flat(PAL.ink, { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const warpFill = flat(PAL.yellow, { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const warpRing = new THREE.Group();
    warpRing.rotation.x = -Math.PI / 2;
    warpRing.position.y = SA.FLIGHT_Y;
    const wi = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.14, 64), warpInk);
    const wf = new THREE.Mesh(new THREE.RingGeometry(0.92, 1.08, 64), warpFill);
    wf.position.z = 0.01;
    warpRing.add(wi, wf);
    root.add(warpRing);

    let health = 1, flashT = 0, warp = 0, warpDir = 0, yaw = 0, yawTarget = 0, blinkT = 3;
    const onWarp = [];
    root.userData = {
      get present() { return warp < 0.01 && warpDir === 0; },
      setHealth(f) { health = clamp01(f); },
      hitFlash() { flashT = 1; },
      warpOut(cb) { warpDir = 1; if (cb) onWarp.push(cb); },
      warpIn(cb) { warpDir = -1; warp = 1; root.visible = true; if (cb) onWarp.push(cb); },
      lookAt(x, z) { yawTarget = Math.atan2(-(x - root.position.x), -(z - root.position.z)); },
      update(t, dt) {
        craft.position.y = SA.FLIGHT_Y + 0.35 + Math.sin(t * 1.3) * 0.15;
        craft.rotation.z = Math.sin(t * 0.9) * 0.05;
        craft.rotation.x = Math.cos(t * 0.7) * 0.05;
        lightRing.rotation.y = t * 0.5;
        bulbs.forEach((m, i) => {
          const on = 0.5 + 0.5 * Math.sin(t * 7 - i * 0.8);
          const dead = health < 0.5 && i % 3 === 0;
          m.emissiveIntensity = dead ? 0 : 0.3 + on * 1.4;
        });

        let d = yawTarget - yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 4);
        look.rotation.y = yaw;
        look.rotation.x = -0.85;
        blinkT -= dt;
        if (blinkT < -0.14) blinkT = 2.5 + Math.random() * 3;
        const blink = blinkT < 0 ? 1 : 0;
        const open = (2.0 - (1 - health) * 0.65) * (1 - blink);
        lidPivot.rotation.x = Math.max(0.05, open);

        flashT = Math.max(0, flashT - dt * 4);
        for (const m of flashMats) m.emissiveIntensity = flashT * 0.7;

        damage.forEach((dm, i) => {
          const on = health < dm.thresh + 1e-6;
          dm.band.visible = on;
          dm.puffs.forEach((s, k) => {
            s.visible = on;
            if (!on) return;
            const ph = ((t * 0.7 + k / 3 + i * 0.37) % 1);
            s.position.set(dm.p[0] + Math.sin(ph * 6 + k) * 0.2, dm.p[1] + 0.2 + ph * 1.8, dm.p[2]);
            s.scale.setScalar(Math.max(0.001, Math.sin(ph * Math.PI) * (0.8 + k * 0.2)));
          });
        });

        if (warpDir !== 0) {
          warp = clamp01(warp + warpDir * dt * 1.6);
          if ((warpDir > 0 && warp >= 1) || (warpDir < 0 && warp <= 0)) {
            warpDir = 0;
            onWarp.splice(0).forEach((f) => f());
          }
        }
        const e = easeOut(1 - warp);
        craft.scale.set(Math.max(0.001, e), Math.max(0.001, e * e), Math.max(0.001, e));
        craft.visible = warp < 0.97;
        om.uniforms.thickness.value = BOSS_OUTLINE * Math.max(0.05, e);
        const wr = warp > 0 && warp < 1 ? Math.sin(warp * Math.PI) : 0;
        warpInk.opacity = warpFill.opacity = wr;
        warpRing.scale.setScalar(1 + warp * 4);
      },
    };
    return root;
  };

  /* ---------- the Space Lion: a chibi lion head with a petal mane and an astronaut collar ---------- */

  SA.makeSpaceLion = function () {
    const root = new THREE.Group();
    root.name = 'SpaceLion';
    const om = outlineMaterial(BOSS_OUTLINE * 0.8);
    const ink = (g, m) => inked(g, m, om);
    // Built with the face toward +Z, then tilted to face the camera square-on.
    const tilt = new THREE.Group();
    tilt.rotation.x = -SA.CAM_PITCH;
    tilt.position.y = SA.FLIGHT_Y + 0.6;
    tilt.scale.setScalar(1.12);
    root.add(tilt);
    const head = new THREE.Group();
    tilt.add(head);

    const fur = toy(0xffb347, { roughness: 0.6, emissive: PAL.white, emissiveIntensity: 0 });
    const furDark = toy(0xd9782e, { roughness: 0.6 });
    const cream = toy(PAL.cream, { roughness: 0.55, emissive: PAL.white, emissiveIntensity: 0 });
    const pink = toy(0xff7b9c, { roughness: 0.45 });
    const blushM = toy(PAL.blush, { roughness: 0.8 });
    const eyeM = toy(PAL.eye, { roughness: 0.3 });
    const whiteF = flat(PAL.white);
    const mouthM = toy(0x5a2140, { roughness: 0.7 });
    const glowM = toy(PAL.yellow, { emissive: PAL.yellow, emissiveIntensity: 0.5, roughness: 0.4 });
    const navy = toy(PAL.navy, { roughness: 0.5 });
    const gem = toy(PAL.yellow, { roughness: 0.35, emissive: PAL.yellow, emissiveIntensity: 0.2 });

    const FR = 2.2, SX = 1.08, SY = 0.98, SZ = 0.85;
    const surfZ = (x, y) => FR * SZ * Math.sqrt(Math.max(0, 1 - (x / (FR * SX)) ** 2 - (y / (FR * SY)) ** 2));

    // mane: two rings of chunky petals
    const mane = new THREE.Group();
    head.add(mane);
    const petalG = ball(1, 18, 12);
    const petals = [];
    const rings = [
      { n: 12, r: 2.55, z: -0.5, sx: 0.85, sy: 1.35, mats: [toy(PAL.pink), toy(PAL.orange)] },
      { n: 14, r: 3.35, z: -0.95, sx: 0.95, sy: 1.45, mats: [toy(PAL.lilac), toy(0x8a6fd6)] },
    ];
    rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        const a = (i + (ri % 2) * 0.5) / ring.n * Math.PI * 2;
        const p = ink(petalG, ring.mats[i % 2]);
        p.position.set(Math.cos(a) * ring.r, Math.sin(a) * ring.r, ring.z);
        p.rotation.z = a - Math.PI / 2;
        p.scale.set(ring.sx, ring.sy, 0.5);
        mane.add(p);
        petals.push({ p, sy: ring.sy, a, r: ring.r, phase: i * 1.7 + ri });
      }
    });

    const collarG = new THREE.TorusGeometry(2.0, 0.28, 12, 40);
    collarG.rotateX(Math.PI / 2);
    const collar = ink(collarG, navy);
    collar.position.set(0, -1.95, -0.1);
    collar.rotation.x = 0.35;
    head.add(collar);

    const face = ink(ball(FR, 32, 24), fur);
    face.scale.set(SX, SY, SZ);
    head.add(face);

    for (const side of [-1, 1]) {
      const ear = ink(ball(0.62, 18, 12), fur);
      ear.scale.z = 0.6;
      ear.position.set(side * 1.55, 1.62, -0.25);
      head.add(ear);
      const inner = plain(ball(0.36, 14, 10), pink, false);
      inner.scale.z = 0.5;
      inner.position.set(side * 1.55, 1.6, 0.05);
      head.add(inner);
    }

    const eyes = [], brows = [], blushes = [];
    for (const side of [-1, 1]) {
      const ex = side * 0.78, ey = 0.32;
      const e = plain(ball(1, 18, 12), eyeM, false);
      e.scale.set(0.3, 0.42, 0.18);
      e.position.set(ex, ey, surfZ(ex, ey) - 0.02);
      head.add(e);
      const sh = plain(ball(0.1, 8, 6), whiteF, false);
      sh.position.set(ex + 0.1, ey + 0.16, surfZ(ex, ey) + 0.14);
      head.add(sh);
      eyes.push({ e, sh });
      const by = 0.95;
      const brow = ink(rbox(0.7, 0.16, 0.2, 0.07), furDark);
      brow.position.set(side * 0.8, by, surfZ(side * 0.8, by) + 0.02);
      head.add(brow);
      brows.push({ brow, side });
      const bl = plain(ball(1, 14, 10), blushM, false);
      bl.scale.set(0.42, 0.24, 0.1);
      bl.position.set(side * 1.35, -0.3, surfZ(side * 1.35, -0.3) - 0.02);
      head.add(bl);
      blushes.push(bl);
      const mz = ink(ball(0.62, 18, 12), cream);
      mz.scale.set(1, 0.8, 0.6);
      mz.position.set(side * 0.42, -0.62, surfZ(side * 0.42, -0.62) - 0.08);
      head.add(mz);
      for (let w = 0; w < 3; w++) {
        const dot = plain(ball(0.05, 6, 4), eyeM, false);
        const wx = side * (0.42 + (w - 1) * 0.2), wy = -0.55 - Math.abs(w - 1) * 0.08;
        dot.position.set(wx, wy, surfZ(side * 0.42, -0.62) - 0.08 + 0.34);
        head.add(dot);
      }
    }
    const nose = ink(ball(1, 16, 12), pink);
    nose.scale.set(0.36, 0.24, 0.25);
    nose.position.set(0, -0.28, surfZ(0, -0.28) + 0.12);
    head.add(nose);

    const star = ink(starGeo(0.36, 0.16, 0.1, 0.04), gem);
    star.position.set(0, 1.35, surfZ(0, 1.35) + 0.02);
    star.rotation.x = -0.55;
    head.add(star);

    // mouth + jaw (opens for the roar)
    const mouth = plain(ball(1, 16, 12), mouthM, false);
    mouth.scale.set(0.6, 0.42, 0.3);
    mouth.position.set(0, -1.05, surfZ(0, -1.05) - 0.05);
    head.add(mouth);
    const core = plain(ball(0.28, 14, 10), glowM, false);
    core.position.set(0, -1.08, surfZ(0, -1.05) + 0.12);
    head.add(core);
    const jaw = new THREE.Group();
    jaw.position.set(0, -1.0, 1.0);
    head.add(jaw);
    const chin = ink(ball(1, 18, 12), cream);
    chin.scale.set(0.62, 0.3, 0.5);
    chin.position.set(0, -0.28, 0.62);
    jaw.add(chin);
    for (const side of [-1, 1]) {
      const fang = inked(new THREE.ConeGeometry(0.09, 0.3, 8), cream, OUTLINE_THIN);
      fang.rotation.x = Math.PI;
      fang.position.set(side * 0.24, -0.86, surfZ(0.24, -0.86) + 0.1);
      head.add(fang);
    }

    // paws with toe beans, resting in front
    for (const side of [-1, 1]) {
      const paw = new THREE.Group();
      paw.position.set(side * 1.9, -2.35, 1.0);
      const pad = ink(ball(0.72, 18, 12), fur);
      pad.scale.set(1, 0.7, 0.8);
      paw.add(pad);
      for (let c = 0; c < 3; c++) {
        const bean = plain(ball(0.14, 10, 8), pink, false);
        bean.position.set((c - 1) * 0.3, 0.28, 0.45);
        paw.add(bean);
      }
      tilt.add(paw);
    }

    let roarT = -1, health = 1, flashT = 0, blinkT = 2.5, lookYaw = 0, lookTarget = 0;
    const blushBase = lin(PAL.blush), blushRage = lin(PAL.red);
    root.userData = {
      roar() { roarT = 0; },
      setHealth(f) { health = clamp01(f); },
      hitFlash() { flashT = 1; },
      lookAt(x) { lookTarget = Math.max(-1, Math.min(1, (x - root.position.x) / 14)) * 0.3; },
      update(t, dt) {
        const rage = 1 - health;
        let open = 0.04 + Math.sin(t * 0.9) * 0.03;
        let charge = 0;
        if (roarT >= 0) {
          roarT += dt;
          const r = roarT;
          if (r < 0.9) { charge = r / 0.9; open = 0.04 + easeOut(charge) * 0.6; }
          else if (r < 1.5) { charge = 1; open = 0.64 + Math.sin(r * 50) * 0.03; }
          else if (r < 2.1) { const k = (r - 1.5) / 0.6; charge = 1 - k; open = 0.64 * (1 - k) + 0.04; }
          else roarT = -1;
        }
        petals.forEach((s) => {
          const k = 1 + Math.sin(t * (2.4 + rage * 3) + s.phase) * 0.06 + charge * 0.22;
          s.p.scale.y = s.sy * k;
          const push = 1 + charge * 0.08;
          s.p.position.x = Math.cos(s.a) * s.r * push;
          s.p.position.y = Math.sin(s.a) * s.r * push;
        });
        mane.rotation.z = Math.sin(t * 0.4) * 0.06;
        lookYaw += (lookTarget - lookYaw) * Math.min(1, dt * 3);
        head.rotation.y = lookYaw + Math.sin(t * 0.5) * 0.08;
        head.rotation.z = Math.sin(t * 0.7) * 0.04 + (charge > 0.95 ? Math.sin(t * 60) * 0.02 : 0);
        star.rotation.z = Math.sin(t * 1.5) * 0.25;
        jaw.rotation.x = open;
        mouth.scale.y = 0.42 + open * 0.8;
        core.scale.setScalar(0.4 + charge * 1.1);
        glowM.emissiveIntensity = 0.4 + charge * 1.6;

        blinkT -= dt;
        if (blinkT < -0.13) blinkT = 2.5 + Math.random() * 2.5;
        const shut = blinkT < 0 ? 0.12 : 1;
        for (const { e, sh } of eyes) { e.scale.y = 0.42 * shut; sh.visible = shut > 0.5; }
        for (const { brow, side } of brows) {
          brow.rotation.z = side * (0.12 + rage * 0.45 + charge * 0.15);
          brow.position.y = 0.95 - rage * 0.12;
        }
        for (const b of blushes) b.material.color.copy(blushBase).lerp(blushRage, rage * 0.6);

        flashT = Math.max(0, flashT - dt * 4);
        fur.emissiveIntensity = cream.emissiveIntensity = flashT * 0.6;
      },
    };
    return root;
  };

  /* ---------- fx particles (shared geometry/materials) ---------- */

  let fxRes = null;
  function fxResources() {
    if (fxRes) return fxRes;
    const g = (geo) => { shared(geo); shared(hullOf(geo)); return geo; };
    const puffG = g(ball(0.32, 12, 8));
    const starG = g(starGeo(0.26, 0.12, 0.1, 0.03));
    const chunkG = g(rbox(0.36, 0.28, 0.3, 0.07, 2));
    const m = (hex, em) => shared(toy(hex, { roughness: 0.55, emissive: em == null ? hex : em, emissiveIntensity: em == null ? 0.25 : 0.2 }));
    fxRes = {
      puff: { g: puffG, m: m(PAL.cream) },
      smoke: { g: puffG, m: m(0x5a4f7a, 0x000000) },
      star: { g: starG, m: m(PAL.yellow) },
      orange: { g: starG, m: m(PAL.orange) },
      chunk: { g: chunkG, m: m(PAL.navy, 0x000000) },
      rock: { g: chunkG, m: m(0x9b8ae6, 0x000000) },
      blue: { g: starG, m: m(PAL.sky) },
      teal: { g: starG, m: m(PAL.teal) },
      pink: { g: starG, m: m(PAL.pink) },
      red: { g: puffG, m: m(PAL.red) },
    };
    return fxRes;
  }
  SA.makeParticle = function (kind) {
    const r = fxResources()[kind] || fxResources().puff;
    return inked(r.g, r.m, OUTLINE_THIN);
  };

  SA.makeShockRing = function (hex) {
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2;
    const inkM = flat(PAL.ink, { transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const fillM = flat(hex, { transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const a = new THREE.Mesh(new THREE.RingGeometry(0.8, 1.12, 48), inkM);
    const b = new THREE.Mesh(new THREE.RingGeometry(0.86, 1.06, 48), fillM);
    b.position.z = 0.01;
    root.add(a, b);
    root.userData = {
      setProgress(k) {
        root.scale.setScalar(0.4 + easeOut(k) * 2.6);
        inkM.opacity = fillM.opacity = 1 - k;
      },
    };
    return root;
  };

  /* ---------- backdrop pieces ---------- */

  let buoyRes = null;
  SA.makeBuoy = function () {
    if (!buoyRes) {
      buoyRes = {
        post: capsule(0.2, 0.5, 12),
        cap: roundCyl(0.34, 0.3, 0.28, 0.08, 16),
        lampG: ball(0.16, 10, 8),
        navy: toy(PAL.navy),
        yellow: toy(PAL.yellow),
        lamp: toy(PAL.red, { emissive: PAL.red, emissiveIntensity: 1 }),
      };
    }
    const b = buoyRes;
    const root = new THREE.Group();
    const post = inked(b.post, b.navy);
    root.add(post);
    const cap = inked(b.cap, b.yellow);
    cap.position.y = 0.36;
    root.add(cap);
    const lamp = plain(b.lampG, b.lamp, false);
    lamp.position.y = 0.72;
    root.add(lamp);
    return root;
  };
  SA.updateBuoys = function (t) {
    if (buoyRes) buoyRes.lamp.emissiveIntensity = (t % 1.4) < 0.25 ? 2.2 : 0.35;
  };

  const DECOR_PLANET = [0xd98cc8, 0x7fb0e0, 0xe8b860, 0x5fb89a, 0xe89a6a, 0xb49cf0];
  SA.makeDecor = function (kind, rand) {
    const root = new THREE.Group();
    if (kind === 'planet') {
      const r = 0.8 + rand() * 0.8;
      const p = inked(ball(r, 22, 16), toy(DECOR_PLANET[Math.floor(rand() * DECOR_PLANET.length)], { roughness: 0.7 }));
      root.add(p);
      if (rand() < 0.7) {
        const rg = new THREE.TorusGeometry(r * 1.55, 0.1 + r * 0.05, 8, 40);
        rg.rotateX(Math.PI / 2);
        const ring = inked(rg, toy(rand() < 0.5 ? 0xf2ecff : 0xffe3a8, { roughness: 0.6 }));
        ring.rotation.set((rand() - 0.5) * 0.7, 0, (rand() - 0.5) * 0.7);
        root.add(ring);
      }
      root.userData.lift = r + 0.4;
      root.userData.spin = p;
    } else if (kind === 'crystal') {
      const m = toy(rand() < 0.5 ? 0x7ee0d8 : 0xf0a8e0, { roughness: 0.3, emissive: 0x6e5ac8, emissiveIntensity: 0.1 });
      const n = 3 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        const c = inked(new THREE.OctahedronGeometry(0.35 + rand() * 0.25, 0), m);
        c.scale.y = 2 + rand() * 1.2;
        c.position.set((rand() - 0.5) * 1.1, 0.4 + rand() * 0.2, (rand() - 0.5) * 1.1);
        c.rotation.set((rand() - 0.5) * 0.7, rand() * 3, (rand() - 0.5) * 0.7);
        root.add(c);
      }
      root.userData.lift = 0;
    } else {
      const r = 0.9 + rand() * 1.1;
      const rock = inked(blob(r, rand() * 50, 0.6), toy(0x8074c8, { roughness: 0.9 }));
      root.add(rock);
      const craterM = toy(0x6a5eb0, { roughness: 0.95 });
      for (let i = 0; i < 2; i++) {
        const c = plain(ball(r * 0.28, 12, 8), craterM, false);
        c.scale.y = 0.25;
        const a = rand() * Math.PI * 2;
        c.position.set(Math.cos(a) * r * 0.45, r * 0.5, Math.sin(a) * r * 0.45);
        root.add(c);
      }
      root.userData.lift = r * 0.3;
    }
    return root;
  };

  /* ---------- persistent-phases boss health ----------
   *  const hp = new SA.BossHealth(90, 3);
   *  hp.damage(10) -> 'hit' | 'retreat' | 'defeated'
   *  On 'retreat' the boss warps out; its hp stays where it is. Next spawn continues from there.
   */
  SA.BossHealth = class {
    constructor(max, phases) { this.max = max || 90; this.phases = phases || 3; this.hp = this.max; }
    get fraction() { return this.hp / this.max; }
    get step() { return this.max / this.phases; }
    get retreatAt() { return Math.max(0, Math.ceil(this.hp / this.step - 1e-9) * this.step - this.step); }
    damage(n) {
      if (this.hp <= 0) return 'defeated';
      const floor = this.retreatAt;
      this.hp = Math.max(floor, this.hp - n);
      if (this.hp <= 0) return 'defeated';
      if (this.hp <= floor + 1e-9) return 'retreat';
      return 'hit';
    }
    reset() { this.hp = this.max; }
  };

  global.SpaceAssets = SA;
})(typeof window !== 'undefined' ? window : globalThis);
