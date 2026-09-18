/*  space-assets.js — procedural three.js (r128+) assets for the top-down shooter
 *
 *  Conventions
 *    - Y is up. The play field is the XZ plane. Every ship/turret faces -Z (screen-up in a top-down camera).
 *    - Each factory returns a THREE.Group. Call  obj.userData.update(time, dt)  every frame.
 *    - Glows are additive sprites + over-bright MeshBasicMaterials; they look best with an UnrealBloomPass
 *      (threshold ~0.85) but still read without post-processing.
 *    - Call SA.createEnvironment(renderer) once and assign it to scene.environment so the metals reflect.
 *
 *  Factories
 *    makePlayerShip()   fire(), setThrust(0..1), setBank(-1..1)
 *    makePlayerBolt()
 *    makeReticle()      pulse(), setLock(bool)
 *    makeTower()        aimAt(Vector3), charge(0..1), fire()
 *    makeTowerShot()
 *    makeGold()         collect()
 *    makeRing()         setState('waiting' | 'next' | 'cleared')
 *    makeRingSet(n)     clearNext(), reset(), rings[]
 *    makeBossUFO()      setHealth(0..1), hitFlash(), warpOut(), warpIn()
 *    makeSpaceLion()    roar(), setHealth(0..1), hitFlash()
 *    BossHealth         persistent-thirds health model (see bottom)
 */
(function (global) {
  const THREE = global.THREE;
  const SA = {};

  const COLORS = {
    hull: 0xdfe6f2,
    hullShade: 0xa9b5cc,
    gunmetal: 0x2b3148,
    cyan: 0x4fe3ff,
    amber: 0xffb347,
    hostile: 0xff4470,
    gold: 0xffc247,
    plasma: 0xff8a3d,
    violet: 0xb65bff,
    rock: 0x2a2536,
  };
  SA.COLORS = COLORS;

  /* ---------- shared helpers ---------- */

  let glowTex = null;
  function glowTexture() {
    if (glowTex) return glowTex;
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.18, 'rgba(255,255,255,0.8)');
    grd.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(c);
    return glowTex;
  }
  function glow(color, size, opacity) {
    const m = new THREE.SpriteMaterial({
      map: glowTexture(), color, transparent: true, opacity: opacity == null ? 1 : opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    return s;
  }
  function std(color, o) {
    return new THREE.MeshStandardMaterial(Object.assign({ color, metalness: 0.55, roughness: 0.38 }, o || {}));
  }
  // over-bright unlit material: values > 1 feed the bloom pass
  function lit(color, k) {
    return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar((k == null ? 2 : k) * 0.8), toneMapped: false });
  }
  function additive(color, opacity) {
    return new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: opacity == null ? 1 : opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    });
  }
  function mirrorShape(rightHalf) {
    // rightHalf: [[x,y],...] from top of the centre line to bottom of the centre line
    const s = new THREE.Shape();
    s.moveTo(rightHalf[0][0], rightHalf[0][1]);
    for (let i = 1; i < rightHalf.length; i++) s.lineTo(rightHalf[i][0], rightHalf[i][1]);
    for (let i = rightHalf.length - 2; i > 0; i--) s.lineTo(-rightHalf[i][0], rightHalf[i][1]);
    s.closePath();
    return s;
  }
  // extrude a 2D silhouette (drawn with +Y = forward) so it lies flat, nose toward -Z
  function flatExtrude(shape, depth, bevel) {
    const b = bevel == null ? 0.04 : bevel;
    const g = new THREE.ExtrudeGeometry(shape, {
      depth, bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 12,
    });
    g.rotateX(-Math.PI / 2);
    return g;
  }
  function hash3(x, y, z) {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return s - Math.floor(s);
  }
  function smoothNoise(x, y, z) {
    return (Math.sin(x * 1.7 + z * 0.9) * Math.cos(y * 2.3 - x * 0.6) + Math.sin(z * 2.9 + y * 1.3) * 0.5) * 0.5;
  }
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  SA.glow = glow;

  /* ---------- environment for metal reflections ---------- */

  SA.createEnvironment = function (renderer) {
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const col = [];
    const pos = geo.attributes.position;
    const top = new THREE.Color(0x3d4f9e), mid = new THREE.Color(0x1a1f4a), bot = new THREE.Color(0x0a0c1c);
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 50;
      if (y > 0) tmp.copy(mid).lerp(top, y); else tmp.copy(mid).lerp(bot, -y);
      col.push(tmp.r, tmp.g, tmp.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    envScene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const panel = (c, k, x, y, z, w, h) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z); m.lookAt(0, 0, 0); envScene.add(m);
    };
    panel(0xfff1dc, 3, -20, 35, 15, 22, 14);   // warm key
    panel(0x6fe8ff, 1.6, 30, 10, -25, 10, 30);   // cyan rim
    panel(0xc47bff, 2, -25, -5, -30, 16, 8);   // violet fill
    panel(0xffffff, 1.5, 5, 45, -10, 8, 8);      // top spec
    panel(0xffb866, 1.4, 10, -20, 30, 40, 18);   // warm bounce so gold reads as gold
    const pm = new THREE.PMREMGenerator(renderer);
    const tex = pm.fromScene(envScene, 0.02).texture;
    pm.dispose();
    return tex;
  };

  /* ---------- player ship ---------- */

  SA.makePlayerShip = function () {
    const root = new THREE.Group();
    root.name = 'PlayerShip';
    const body = new THREE.Group(); // banks independently of heading
    root.add(body);

    const hullMat = std(COLORS.hull, { metalness: 0.6, roughness: 0.28 });
    const shadeMat = std(COLORS.hullShade, { metalness: 0.7, roughness: 0.35 });
    const darkMat = std(COLORS.gunmetal, { metalness: 0.8, roughness: 0.35 });

    const hull = new THREE.Mesh(flatExtrude(mirrorShape([
      [0, 1.15], [0.2, 0.62], [0.3, 0.05], [1.0, -0.42], [1.08, -0.72],
      [0.62, -0.62], [0.42, -0.9], [0.16, -0.78], [0, -0.7],
    ]), 0.1), hullMat);
    body.add(hull);

    const spine = new THREE.Mesh(flatExtrude(mirrorShape([
      [0, 1.02], [0.13, 0.55], [0.21, -0.1], [0.23, -0.68], [0, -0.8],
    ]), 0.12, 0.05), shadeMat);
    spine.position.y = 0.1;
    body.add(spine);

    // dark underside keel so the silhouette has depth when banking
    const keel = new THREE.Mesh(flatExtrude(mirrorShape([
      [0, 0.8], [0.25, 0.1], [0.7, -0.4], [0.3, -0.7], [0, -0.6],
    ]), 0.06, 0.02), darkMat);
    keel.position.y = -0.08;
    body.add(keel);

    // wing accent stripes (leading edge)
    const stripeMat = lit(COLORS.cyan, 1.6);
    for (const side of [-1, 1]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.03, 0.05), stripeMat);
      st.position.set(side * 0.6, 0.15, 0.18);
      st.rotation.y = side * -Math.atan2(0.47, 0.7);
      body.add(st);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.14), std(COLORS.amber, { metalness: 0.3, roughness: 0.5 }));
      panel.position.set(side * 0.78, 0.15, 0.55);
      panel.rotation.y = side * 0.12;
      body.add(panel);
    }

    // cockpit canopy
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
      std(0x0d2b4d, { metalness: 0.95, roughness: 0.05, emissive: 0x0a4f78, emissiveIntensity: 0.6 })
    );
    canopy.scale.set(0.15, 0.14, 0.38);
    canopy.position.set(0, 0.22, -0.28);
    body.add(canopy);
    const canopyGlint = glow(COLORS.cyan, 0.35, 0.35);
    canopyGlint.position.set(0, 0.34, -0.36);
    body.add(canopyGlint);

    // engines, nozzles, flames
    const flames = [];
    for (const side of [-1, 1]) {
      const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.52, 20), darkMat);
      eng.rotation.x = Math.PI / 2;
      eng.position.set(side * 0.3, 0.13, 0.6);
      body.add(eng);
      const cowl = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.12, 20), hullMat);
      cowl.rotation.x = Math.PI / 2;
      cowl.position.set(side * 0.3, 0.13, 0.42);
      body.add(cowl);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.025, 8, 24), lit(COLORS.cyan, 2.2));
      ring.position.set(side * 0.3, 0.13, 0.87);
      body.add(ring);
      const core = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), lit(0xdffaff, 3));
      core.position.set(side * 0.3, 0.13, 0.875);
      body.add(core);

      const flame = new THREE.Group();
      flame.position.set(side * 0.3, 0.13, 0.88);
      const outer = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.8, 16, 1, true), additive(COLORS.cyan, 0.75));
      outer.geometry.translate(0, -0.4, 0);
      outer.rotation.x = -Math.PI / 2;
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.45, 12, 1, true), additive(0xffffff, 0.95));
      inner.geometry.translate(0, -0.225, 0);
      inner.rotation.x = -Math.PI / 2;
      const fg = glow(COLORS.cyan, 0.9, 0.8);
      fg.position.z = 0.15;
      flame.add(outer, inner, fg);
      body.add(flame);
      flames.push(flame);
    }

    // wing-root cannons
    const muzzles = [];
    for (const side of [-1, 1]) {
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.5, 10), darkMat);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(side * 0.38, 0.12, -0.18);
      body.add(gun);
      const flash = glow(COLORS.cyan, 0.7, 0);
      flash.position.set(side * 0.38, 0.12, -0.5);
      body.add(flash);
      muzzles.push(flash);
    }

    // blinking wingtip lights
    const tips = [];
    for (const side of [-1, 1]) {
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), lit(COLORS.amber, 3));
      bulb.position.set(side * 1.06, 0.13, 0.66);
      const halo = glow(COLORS.amber, 0.45, 0.9);
      halo.position.copy(bulb.position);
      body.add(bulb, halo);
      tips.push(halo);
    }

    let thrust = 0.75, bank = 0, bankTarget = 0, muzzleT = 0;
    root.userData = {
      body,
      fire() { muzzleT = 1; },
      setThrust(v) { thrust = clamp01(v); },
      setBank(v) { bankTarget = Math.max(-1, Math.min(1, v)); },
      update(t, dt) {
        const fl = 0.85 + Math.sin(t * 60) * 0.08 + Math.sin(t * 37) * 0.07;
        for (const f of flames) { f.scale.set(1, 1, (0.45 + thrust * 0.9) * fl); }
        bank += (bankTarget - bank) * Math.min(1, dt * 6);
        body.rotation.z = -bank * 0.55;
        body.position.y = Math.sin(t * 2.2) * 0.04;
        const blink = (t % 1.2) < 0.12 ? 1 : 0.15;
        for (const tp of tips) tp.material.opacity = blink;
        muzzleT = Math.max(0, muzzleT - dt * 9);
        for (const m of muzzles) { m.material.opacity = muzzleT; m.scale.setScalar(0.4 + muzzleT * 0.5); }
      },
    };
    return root;
  };

  SA.makePlayerBolt = function () {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), lit(0xe8fdff, 3));
    core.scale.z = 4;
    const sheath = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), additive(COLORS.cyan, 0.55));
    sheath.scale.z = 4.5;
    const halo = glow(COLORS.cyan, 0.9, 0.9);
    g.add(core, sheath, halo);
    g.userData = { update() {} };
    return g;
  };

  /* ---------- reticle ---------- */

  SA.makeReticle = function () {
    const root = new THREE.Group();
    const flat = new THREE.Group();
    flat.rotation.x = -Math.PI / 2;
    root.add(flat);
    const mat = additive(COLORS.cyan, 0.95);
    const matSoft = additive(COLORS.cyan, 0.35);

    const outer = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const arc = new THREE.Mesh(new THREE.RingGeometry(0.56, 0.61, 32, 1, i * Math.PI / 2 + 0.22, Math.PI / 2 - 0.44), mat);
      outer.add(arc);
    }
    flat.add(outer);

    const inner = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4;
      const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.035), mat);
      tick.position.set(Math.cos(a) * 0.33, Math.sin(a) * 0.33, 0);
      tick.rotation.z = a;
      inner.add(tick);
    }
    flat.add(inner);

    const halo = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.5, 48), matSoft);
    halo.material = additive(COLORS.cyan, 0.08);
    flat.add(halo);

    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.05, 4), mat);
    flat.add(dot);

    // forward chevron
    const chev = new THREE.Shape();
    chev.moveTo(0, 0.9); chev.lineTo(0.14, 0.74); chev.lineTo(0.08, 0.74); chev.lineTo(0, 0.82);
    chev.lineTo(-0.08, 0.74); chev.lineTo(-0.14, 0.74); chev.closePath();
    const chevron = new THREE.Mesh(new THREE.ShapeGeometry(chev), mat);
    flat.add(chevron);

    const g = glow(COLORS.cyan, 1.6, 0.18);
    root.add(g);

    let pulseT = 0, lock = 0, lockTarget = 0;
    const cA = new THREE.Color(COLORS.cyan), cB = new THREE.Color(COLORS.hostile), cur = new THREE.Color();
    root.userData = {
      pulse() { pulseT = 1; },
      setLock(v) { lockTarget = v ? 1 : 0; },
      update(t, dt) {
        pulseT = Math.max(0, pulseT - dt * 5);
        lock += (lockTarget - lock) * Math.min(1, dt * 8);
        outer.rotation.z = t * (0.6 + lock * 2) + pulseT * 0.6;
        inner.rotation.z = -t * 0.3;
        const s = 1 + pulseT * 0.28 - lock * 0.18 + Math.sin(t * 3) * 0.02;
        outer.scale.setScalar(s);
        inner.scale.setScalar(1 - pulseT * 0.2 + lock * 0.15);
        cur.copy(cA).lerp(cB, lock);
        mat.color.copy(cur);
        halo.material.color.copy(cur);
        g.material.color.copy(cur);
        halo.material.opacity = 0.08 + pulseT * 0.25;
        g.material.opacity = 0.18 + pulseT * 0.4;
        chevron.position.y = Math.sin(t * 4) * 0.03;
      },
    };
    return root;
  };

  /* ---------- asteroid platform (used under towers) ---------- */

  function makeRock(radius, seed, plateau) {
    const geo = new THREE.IcosahedronGeometry(radius, 2);
    const p = geo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = smoothNoise(v.x * 1.3 + seed, v.y * 1.3, v.z * 1.3 - seed) * 0.22 + (hash3(Math.round(v.x * 9), Math.round(v.y * 9), Math.round(v.z * 9) + seed) - 0.5) * 0.12;
      v.multiplyScalar(1 + n);
      v.y *= 0.55;
      if (plateau != null && v.y > plateau) v.y = plateau + (v.y - plateau) * 0.08;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, std(COLORS.rock, { metalness: 0.05, roughness: 0.95, flatShading: true, envMapIntensity: 0.15 }));
  }
  SA.makeRock = makeRock;

  /* ---------- enemy tower ---------- */

  SA.makeTower = function (seed) {
    seed = seed || 1;
    const root = new THREE.Group();
    root.name = 'Tower';
    const rock = makeRock(1.5, seed, 0.28);
    rock.position.y = -0.1;
    root.add(rock);

    const metal = std(COLORS.gunmetal, { metalness: 0.85, roughness: 0.32 });
    const plate = std(0x464f6e, { metalness: 0.8, roughness: 0.4 });
    const redLit = lit(COLORS.hostile, 2.4);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.9, 0.36, 6), metal);
    base.position.y = 0.36;
    root.add(base);
    const trim = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.76, 0.05, 6), redLit);
    trim.position.y = 0.55;
    root.add(trim);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.1, 6), plate);
    deck.position.y = 0.62;
    root.add(deck);
    // buttresses
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + Math.PI / 6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, 0.5), plate);
      b.position.set(Math.cos(a) * 0.82, 0.32, Math.sin(a) * 0.82);
      b.rotation.y = -a;
      root.add(b);
      const lamp = glow(COLORS.hostile, 0.35, 0.8);
      lamp.position.set(Math.cos(a) * 0.98, 0.5, Math.sin(a) * 0.98);
      root.add(lamp);
    }

    // range ring decal on the rock
    const rangeRing = new THREE.Mesh(new THREE.RingGeometry(1.25, 1.32, 64), additive(COLORS.hostile, 0.35));
    rangeRing.rotation.x = -Math.PI / 2;
    rangeRing.position.y = 0.2;
    root.add(rangeRing);

    // yawing turret head
    const head = new THREE.Group();
    head.position.y = 0.67;
    root.add(head);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.48, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    dome.scale.y = 0.75;
    head.add(dome);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.04, 8, 32), plate);
    collar.rotation.x = Math.PI / 2;
    head.add(collar);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.3), plate);
    visor.position.set(0, 0.26, -0.26);
    head.add(visor);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), redLit.clone());
    eye.position.set(0, 0.3, -0.12);
    head.add(eye);
    const eyeGlow = glow(COLORS.hostile, 0.9, 0.7);
    eyeGlow.position.copy(eye.position);
    head.add(eyeGlow);

    const barrels = new THREE.Group();
    head.add(barrels);
    const flashes = [];
    for (const side of [-1, 1]) {
      const br = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.075, 0.95, 12), metal);
      br.rotation.x = Math.PI / 2;
      br.position.set(side * 0.15, 0.18, -0.55);
      barrels.add(br);
      const tip = new THREE.Mesh(new THREE.TorusGeometry(0.065, 0.02, 6, 16), redLit);
      tip.position.set(side * 0.15, 0.18, -1.02);
      barrels.add(tip);
      const fl = glow(COLORS.hostile, 1.0, 0);
      fl.position.set(side * 0.15, 0.18, -1.15);
      barrels.add(fl);
      flashes.push(fl);
    }

    let charge = 0, fireT = 0, targetYaw = 0, manualAim = false;
    root.userData = {
      head,
      muzzleWorld(out) { return barrels.localToWorld(out.set(0, 0.18, -1.1)); },
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
        fireT = Math.max(0, fireT - dt * 6);
        barrels.position.z = fireT * 0.14;
        for (const f of flashes) { f.material.opacity = fireT; f.scale.setScalar(0.6 + fireT * 0.8); }
        const pulse = 0.5 + 0.5 * Math.sin(t * (3 + charge * 18));
        eye.material.color.set(COLORS.hostile).multiplyScalar((1.6 + charge * 3 + pulse * 0.6) * 0.8);
        eyeGlow.material.opacity = 0.45 + charge * 0.55 + pulse * 0.15;
        eyeGlow.scale.setScalar(0.8 + charge * 0.9);
        rangeRing.material.opacity = 0.18 + 0.15 * Math.sin(t * 2 + seed);
        rangeRing.scale.setScalar(1 + ((t * 0.4 + seed) % 1) * 0.08);
      },
    };
    return root;
  };

  SA.makeTowerShot = function () {
    const g = new THREE.Group();
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), lit(0xffd0dc, 3));
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), additive(COLORS.hostile, 0.6));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.02, 6, 24), additive(COLORS.hostile, 0.9));
    const halo = glow(COLORS.hostile, 1.2, 0.9);
    g.add(core, shell, ring, halo);
    g.userData = {
      update(t) { ring.rotation.x = t * 6; ring.rotation.y = t * 4; shell.scale.setScalar(1 + Math.sin(t * 20) * 0.1); },
    };
    return g;
  };

  /* ---------- gold ---------- */

  SA.makeGold = function () {
    const root = new THREE.Group();
    root.name = 'Gold';
    const spin = new THREE.Group();
    root.add(spin);
    const goldMat = std(COLORS.gold, { metalness: 0.75, roughness: 0.26, emissive: 0x6a3f00, emissiveIntensity: 0.55 });
    const goldDeep = std(0xe0962a, { metalness: 0.7, roughness: 0.36, emissive: 0x4a2800, emissiveIntensity: 0.5 });

    const oct = new THREE.Shape();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2 + Math.PI / 8;
      const x = Math.cos(a) * 0.42, y = Math.sin(a) * 0.42;
      if (i === 0) oct.moveTo(x, y); else oct.lineTo(x, y);
    }
    oct.closePath();
    const coinGeo = new THREE.ExtrudeGeometry(oct, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 });
    coinGeo.translate(0, 0, -0.05);
    const coin = new THREE.Mesh(coinGeo, goldMat);
    spin.add(coin);

    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 0.26 : 0.11;
      const a = i / 10 * Math.PI * 2 + Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) star.moveTo(x, y); else star.lineTo(x, y);
    }
    star.closePath();
    const starGeo = new THREE.ExtrudeGeometry(star, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2 });
    for (const side of [-1, 1]) {
      const s = new THREE.Mesh(starGeo, goldDeep);
      s.position.z = side * 0.1;
      if (side < 0) s.rotation.y = Math.PI;
      spin.add(s);
    }
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.02, 6, 8), goldDeep);
    rim.rotation.z = Math.PI / 8;
    const rimB = rim.clone();
    rim.position.z = 0.1; rimB.position.z = -0.1;
    spin.add(rim, rimB);

    spin.rotation.x = -0.9; // tilted so a top-down camera always sees a face
    const halo = glow(COLORS.gold, 1.5, 0.35);
    root.add(halo);
    const sparkle = glow(0xffffff, 0.5, 0);
    sparkle.position.set(0.22, 0.25, -0.1);
    root.add(sparkle);

    let collectT = -1;
    root.userData = {
      collect() { collectT = 0; },
      update(t, dt) {
        spin.rotation.y = t * 2.4;
        spin.position.y = Math.sin(t * 2.5) * 0.12;
        const sp = Math.max(0, Math.sin(t * 3.1) - 0.85) / 0.15;
        sparkle.material.opacity = sp;
        sparkle.scale.setScalar(0.3 + sp * 0.5);
        halo.material.opacity = 0.28 + Math.sin(t * 2.5) * 0.06;
        if (collectT >= 0) {
          collectT += dt;
          const k = Math.min(1, collectT / 0.45);
          spin.position.y += easeOut(k) * 1.4;
          spin.scale.setScalar(1 - k * 0.7);
          halo.scale.setScalar(1.5 + k * 3);
          halo.material.opacity = (1 - k) * 0.9;
          if (collectT > 1.4) { collectT = -1; spin.scale.setScalar(1); halo.scale.setScalar(1.5); }
        }
      },
    };
    return root;
  };

  /* ---------- rings ---------- */

  SA.makeRing = function () {
    const root = new THREE.Group();
    root.name = 'Ring';
    const frameMat = std(0x242b44, { metalness: 0.8, roughness: 0.35 });
    const torus = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.1, 16, 72), frameMat);
    torus.rotation.x = Math.PI / 2;
    root.add(torus);
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.075, 8, 72), lit(COLORS.cyan, 1.8));
    band.rotation.x = Math.PI / 2;
    band.position.y = 0.1;
    root.add(band);

    const pods = new THREE.Group();
    const podMat = lit(COLORS.cyan, 2.4);
    const podList = [];
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      const pod = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.2, 0.34), podMat.clone());
      pod.position.set(Math.cos(a) * 1.25, 0, Math.sin(a) * 1.25);
      pod.rotation.y = -a;
      pods.add(pod);
      podList.push(pod);
    }
    root.add(pods);

    const fieldMat = additive(COLORS.cyan, 0.12);
    const field = new THREE.Mesh(new THREE.CircleGeometry(1.15, 48), fieldMat);
    field.rotation.x = -Math.PI / 2;
    root.add(field);

    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.55); arrowShape.lineTo(0.38, 0.15); arrowShape.lineTo(0.22, 0.15);
    arrowShape.lineTo(0, 0.37); arrowShape.lineTo(-0.22, 0.15); arrowShape.lineTo(-0.38, 0.15); arrowShape.closePath();
    const arrows = new THREE.Group();
    const arrowMat = additive(COLORS.cyan, 0.8);
    for (let i = 0; i < 2; i++) {
      const a = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape), arrowMat);
      a.rotation.x = -Math.PI / 2;
      a.position.set(0, 0.02, -i * 0.4 + 0.2);
      arrows.add(a);
    }
    root.add(arrows);
    const halo = glow(COLORS.cyan, 3.6, 0.15);
    halo.position.y = -0.3;
    root.add(halo);

    const palette = {
      waiting: new THREE.Color(0x3f86b8),
      next: new THREE.Color(COLORS.cyan),
      cleared: new THREE.Color(COLORS.gold),
    };
    let state = 'waiting', clearT = 0;
    const col = new THREE.Color();
    root.userData = {
      get state() { return state; },
      setState(s) { state = s; if (s === 'cleared') clearT = 0; },
      update(t, dt) {
        clearT += dt;
        col.copy(palette[state]);
        const isNext = state === 'next';
        const k = isNext ? 2 + Math.sin(t * 6) * 0.5 : state === 'cleared' ? 1.3 + Math.max(0, 1 - clearT) * 3 : 0.75;
        band.material.color.copy(col).multiplyScalar(k * 0.55);
        podList.forEach((p, i) => {
          const chase = isNext ? 0.5 + 0.5 * Math.sin(t * 8 - i * 0.9) : 0.6;
          p.material.color.copy(col).multiplyScalar(isNext ? 0.5 + chase * 1.3 : state === 'cleared' ? 0.9 : 0.35);
        });
        pods.rotation.y = isNext ? t * 0.8 : pods.rotation.y;
        fieldMat.color.copy(col);
        fieldMat.opacity = isNext ? 0.14 + Math.sin(t * 6) * 0.05 : state === 'cleared' ? Math.max(0.03, 0.4 * (1 - clearT)) : 0.05;
        arrowMat.color.copy(col);
        arrowMat.opacity = isNext ? 0.9 : state === 'cleared' ? 0 : 0.3;
        arrows.position.z = isNext ? -((t * 0.8) % 0.4) : 0;
        halo.material.color.copy(col);
        halo.material.opacity = isNext ? 0.22 : state === 'cleared' ? Math.max(0.05, 0.6 * (1 - clearT)) : 0.06;
        if (state === 'cleared') {
          const s = 1 + Math.max(0, 1 - clearT * 2) * 0.25;
          torus.scale.setScalar(s);
        } else torus.scale.setScalar(1);
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

  /* ---------- boss UFO ---------- */

  SA.makeBossUFO = function () {
    const root = new THREE.Group();
    root.name = 'BossUFO';
    const craft = new THREE.Group();
    root.add(craft);

    const hullMat = std(0x585d7a, { metalness: 0.8, roughness: 0.3 });
    const darkMat = std(0x262a40, { metalness: 0.8, roughness: 0.35 });
    const redLit = lit(COLORS.hostile, 2.4);

    const profile = [[0, -0.55], [0.9, -0.52], [1.9, -0.32], [2.85, -0.06], [3.1, 0.04], [3.0, 0.14], [2.1, 0.38], [1.25, 0.56], [0, 0.6]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    const hull = new THREE.Mesh(new THREE.LatheGeometry(profile, 72), hullMat);
    craft.add(hull);
    const skirt = new THREE.Mesh(new THREE.LatheGeometry([[0, -0.62], [1.6, -0.58], [2.2, -0.4], [2.25, -0.3]].map(([x, y]) => new THREE.Vector2(x, y)), 48), darkMat);
    craft.add(skirt);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.08, 0.06, 8, 96), redLit);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    craft.add(rim);

    // radial armour fins
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2;
      const fin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 0.18), darkMat);
      fin.position.set(Math.cos(a) * 1.9, 0.42, Math.sin(a) * 1.9);
      fin.rotation.y = -a;
      fin.rotation.z = -0.18;
      craft.add(fin);
    }

    // chase lights ring (rotates)
    const lightRing = new THREE.Group();
    craft.add(lightRing);
    const bulbs = [];
    for (let i = 0; i < 20; i++) {
      const a = i / 20 * Math.PI * 2;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), lit(COLORS.hostile, 2));
      b.position.set(Math.cos(a) * 2.55, 0.2, Math.sin(a) * 2.55);
      lightRing.add(b);
      bulbs.push(b);
    }

    // dome + core
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.05, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x1b0f2e, metalness: 0.9, roughness: 0.04, transparent: true, opacity: 0.55 })
    );
    dome.position.y = 0.55;
    craft.add(dome);
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), lit(COLORS.hostile, 2.2));
    core.position.y = 0.92;
    craft.add(core);
    const coreCage = new THREE.Mesh(new THREE.IcosahedronGeometry(0.58, 0), new THREE.MeshBasicMaterial({ color: COLORS.hostile, wireframe: true, transparent: true, opacity: 0.5, toneMapped: false }));
    coreCage.position.y = 0.92;
    craft.add(coreCage);
    const coreGlow = glow(COLORS.hostile, 2.4, 0.6);
    coreGlow.position.y = 0.95;
    craft.add(coreGlow);

    // underside emitters
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2 + Math.PI / 2;
      const pod = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), darkMat);
      pod.position.set(Math.cos(a) * 1.5, -0.5, Math.sin(a) * 1.5);
      craft.add(pod);
      const em = glow(COLORS.hostile, 0.8, 0.8);
      em.position.set(Math.cos(a) * 1.5, -0.72, Math.sin(a) * 1.5);
      craft.add(em);
    }

    // damage fx: sparks + smoke puffs appear as health drops
    const damage = new THREE.Group();
    craft.add(damage);
    const sparks = [];
    const damageSpots = [[1.6, 0.35, 0.9], [-1.4, 0.4, -1.1], [0.4, 0.45, -2.0], [-2.1, 0.25, 0.6]];
    damageSpots.forEach((p, i) => {
      const s = glow(i % 2 ? COLORS.plasma : 0xffe2a0, 0.7, 0);
      s.position.set(p[0], p[1], p[2]);
      damage.add(s);
      const scorch = new THREE.Mesh(new THREE.CircleGeometry(0.35, 12), new THREE.MeshBasicMaterial({ color: 0x0a0608, transparent: true, opacity: 0 }));
      scorch.rotation.x = -Math.PI / 2;
      scorch.position.set(p[0], p[1] + 0.02, p[2]);
      damage.add(scorch);
      sparks.push({ s, scorch, thresh: 1 - (i + 1) * 0.2 });
    });

    const warpRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), additive(COLORS.violet, 0));
    warpRing.rotation.x = -Math.PI / 2;
    root.add(warpRing);

    let health = 1, flashT = 0, warp = 0, warpDir = 0; // warp 0 = present, 1 = gone
    const onWarp = [];
    root.userData = {
      get present() { return warp < 0.01 && warpDir === 0; },
      setHealth(f) { health = clamp01(f); },
      hitFlash() { flashT = 1; },
      warpOut(cb) { warpDir = 1; if (cb) onWarp.push(cb); },
      warpIn(cb) { warpDir = -1; root.visible = true; if (cb) onWarp.push(cb); },
      update(t, dt) {
        craft.position.y = Math.sin(t * 1.3) * 0.12;
        craft.rotation.z = Math.sin(t * 0.9) * 0.04;
        craft.rotation.x = Math.cos(t * 0.7) * 0.04;
        lightRing.rotation.y = t * 0.5;
        bulbs.forEach((b, i) => {
          const on = 0.5 + 0.5 * Math.sin(t * 7 - i * 0.8);
          const dead = health < 0.34 && i % 3 === 0;
          b.material.color.set(COLORS.hostile).multiplyScalar(dead ? 0.1 : 0.6 + on * 1.6);
        });
        core.rotation.y = t * 1.3; core.rotation.x = t * 0.7;
        coreCage.rotation.y = -t * 0.6;
        const flicker = health < 0.34 ? (Math.sin(t * 40) > 0.3 ? 1 : 0.4) : 1;
        flashT = Math.max(0, flashT - dt * 4);
        core.material.color.set(COLORS.hostile).lerp(new THREE.Color(0xffffff), flashT).multiplyScalar(((1.8 + Math.sin(t * 4) * 0.4) * flicker + flashT * 2) * 0.8);
        coreGlow.material.opacity = (0.5 + flashT * 0.5) * flicker;
        hullMat.emissive.setRGB(flashT * 0.8, flashT * 0.8, flashT * 0.9);
        sparks.forEach((sp, i) => {
          const on = health < sp.thresh;
          sp.scorch.material.opacity = on ? 0.75 : 0;
          const burst = on ? Math.max(0, Math.sin(t * (9 + i * 3) + i * 2) - 0.4) / 0.6 : 0;
          sp.s.material.opacity = burst;
          sp.s.scale.setScalar(0.3 + burst * 0.8);
        });
        if (warpDir !== 0) {
          warp = clamp01(warp + warpDir * dt * 1.6);
          if ((warpDir > 0 && warp >= 1) || (warpDir < 0 && warp <= 0)) {
            if (warp >= 1) root.visible = true; // keep ring visible; craft hidden by scale
            warpDir = 0;
            onWarp.splice(0).forEach((f) => f());
          }
        }
        const e = easeOut(1 - warp);
        craft.scale.set(e, Math.max(0.001, e * e), e);
        craft.visible = warp < 0.995;
        const wr = warp > 0 && warp < 1 ? Math.sin(warp * Math.PI) : 0;
        warpRing.material.opacity = wr * 0.9;
        warpRing.scale.setScalar(1 + warp * 4);
      },
    };
    return root;
  };

  /* ---------- Space Lion (final boss) ---------- */

  SA.makeSpaceLion = function () {
    const root = new THREE.Group();
    root.name = 'SpaceLion';
    // Built with the face toward +Z, then tilted so it gazes up at a top-down camera (chin toward the player).
    const tilt = new THREE.Group();
    tilt.rotation.x = -Math.PI * 0.4;
    root.add(tilt);
    const head = new THREE.Group();
    tilt.add(head);

    const gold = std(0xf0b84e, { metalness: 0.72, roughness: 0.3, emissive: 0x5a3400, emissiveIntensity: 0.5 });
    const goldDark = std(0xb87a2c, { metalness: 0.7, roughness: 0.4, emissive: 0x3a2000, emissiveIntensity: 0.5 });
    const fur = std(0x2a1548, { metalness: 0.25, roughness: 0.62 });
    const bone = std(0xf6ecdc, { metalness: 0.1, roughness: 0.35, emissive: 0x4a3a2a, emissiveIntensity: 0.3 });
    const void_ = new THREE.MeshBasicMaterial({ color: 0x07030d });

    // mane — three rings of plasma/gold spikes, plus a halo
    const mane = new THREE.Group();
    mane.position.set(0, 0.15, -0.35);
    head.add(mane);
    const spikes = [];
    const rings = [
      { n: 18, r: 1.3, len: 1.35, w: 0.32, mat: gold, z: 0.05 },
      { n: 24, r: 1.7, len: 1.7, w: 0.28, mat: lit(COLORS.plasma, 1.35), z: -0.25 },
      { n: 30, r: 2.1, len: 2.0, w: 0.24, mat: lit(0xff3f8f, 1.3), z: -0.55 },
    ];
    rings.forEach((ring, ri) => {
      for (let i = 0; i < ring.n; i++) {
        const a = (i + (ri % 2) * 0.5) / ring.n * Math.PI * 2;
        const len = ring.len * (0.82 + hash3(i, ri, 3) * 0.36);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(ring.w, len, 5), ring.mat);
        cone.geometry.translate(0, len / 2, 0);
        const holder = new THREE.Group();
        holder.position.set(Math.cos(a) * ring.r, Math.sin(a) * ring.r, ring.z);
        holder.rotation.z = a - Math.PI / 2;
        cone.rotation.x = -0.25 - ri * 0.12; // sweep back
        holder.add(cone);
        mane.add(holder);
        spikes.push({ holder, phase: hash3(i, ri, 9) * 6.28, ri });
      }
    });
    const halo = new THREE.Mesh(new THREE.TorusGeometry(3.3, 0.05, 8, 120), lit(COLORS.violet, 2.2));
    halo.position.z = -0.8;
    mane.add(halo);
    const halo2 = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.025, 6, 120), lit(COLORS.plasma, 1.8));
    halo2.position.z = -0.9;
    mane.add(halo2);
    const maneGlow = glow(COLORS.plasma, 9, 0.35);
    maneGlow.position.z = -1.2;
    mane.add(maneGlow);

    // skull
    const skull = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), fur);
    skull.scale.set(1.45, 1.4, 1.15);
    skull.position.y = 0.1;
    head.add(skull);

    // forehead shield plate
    const shield = mirrorShape([[0, 1.15], [0.62, 0.95], [0.8, 0.35], [0.36, -0.1], [0, 0.02]]);
    const plate = new THREE.Mesh(new THREE.ExtrudeGeometry(shield, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 3 }), gold);
    plate.position.set(0, 0.35, 0.82);
    plate.rotation.x = -0.42;
    head.add(plate);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 0), lit(COLORS.violet, 3));
    gem.scale.y = 1.4;
    gem.position.set(0, 0.95, 1.12);
    head.add(gem);
    const gemGlow = glow(COLORS.violet, 1.1, 0.8);
    gemGlow.position.copy(gem.position);
    head.add(gemGlow);

    // eyes: dark socket + glowing almond
    const almond = new THREE.Shape();
    almond.moveTo(-0.3, 0);
    almond.quadraticCurveTo(0, 0.2, 0.32, 0.07);
    almond.quadraticCurveTo(0.02, -0.13, -0.3, 0);
    const socket = new THREE.Shape();
    socket.moveTo(-0.38, 0.02);
    socket.quadraticCurveTo(0, 0.3, 0.42, 0.1);
    socket.quadraticCurveTo(0.02, -0.22, -0.38, 0.02);
    const eyeMat = lit(0xd8fbff, 3.2);
    const eyes = [];
    for (const side of [-1, 1]) {
      const g = new THREE.Group();
      g.position.set(side * 0.5, 0.18, 1.02);
      g.rotation.z = side * 0.28;
      g.rotation.y = side * 0.35;
      g.scale.x = side; // mirror so outer corner lifts
      const so = new THREE.Mesh(new THREE.ExtrudeGeometry(socket, { depth: 0.08, bevelEnabled: false }), void_);
      const ey = new THREE.Mesh(new THREE.ExtrudeGeometry(almond, { depth: 0.1, bevelEnabled: false }), eyeMat);
      ey.position.z = 0.03;
      const eg = glow(0x9ff4ff, 0.9, 0.7);
      eg.position.z = 0.2;
      g.add(so, ey, eg);
      head.add(g);
      eyes.push(eg);
      // brow ridge
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.13, 0.2), goldDark);
      brow.position.set(side * 0.5, 0.38, 1.03);
      brow.rotation.z = side * -0.3;
      brow.rotation.y = side * 0.3;
      head.add(brow);
      // cheek plate
      const cheek = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), gold);
      cheek.scale.set(1.1, 0.7, 0.55);
      cheek.position.set(side * 0.85, -0.25, 0.72);
      cheek.rotation.z = side * 0.4;
      head.add(cheek);
      // ears
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.75, 4), gold);
      ear.position.set(side * 1.0, 1.3, 0.05);
      ear.rotation.z = side * -0.55;
      head.add(ear);
      const earIn = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.45, 4), lit(COLORS.violet, 1.6));
      earIn.position.set(side * 0.98, 1.27, 0.2);
      earIn.rotation.z = side * -0.55;
      head.add(earIn);
    }

    // muzzle
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.75, 0.3), gold);
    bridge.position.set(0, -0.08, 1.12);
    bridge.rotation.x = -0.18;
    head.add(bridge);
    for (const side of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), gold);
      pad.scale.set(0.34, 0.27, 0.32);
      pad.position.set(side * 0.25, -0.5, 1.12);
      head.add(pad);
      for (let w = 0; w < 3; w++) {
        const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 4), lit(0xffe6c0, 1.6));
        wh.rotation.z = Math.PI / 2 + side * (0.1 * (w - 1) - 0.08);
        wh.position.set(side * 0.72, -0.5 - w * 0.07, 1.2);
        head.add(wh);
      }
    }
    const noseShape = new THREE.Shape();
    noseShape.moveTo(-0.2, 0.08); noseShape.lineTo(0.2, 0.08); noseShape.lineTo(0, -0.16); noseShape.closePath();
    const nose = new THREE.Mesh(new THREE.ExtrudeGeometry(noseShape, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }), std(0x1c1030, { metalness: 0.6, roughness: 0.3 }));
    nose.position.set(0, -0.28, 1.34);
    head.add(nose);
    for (const side of [-1, 1]) {
      const fang = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.34, 8), bone);
      fang.rotation.x = Math.PI;
      fang.position.set(side * 0.2, -0.82, 1.15);
      head.add(fang);
    }

    // jaw hinges open to reveal the plasma core
    const jaw = new THREE.Group();
    jaw.position.set(0, -0.55, 0.35);
    head.add(jaw);
    const jawMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), goldDark);
    jawMesh.scale.set(0.55, 0.22, 0.62);
    jawMesh.position.set(0, -0.3, 0.55);
    jaw.add(jawMesh);
    for (const side of [-1, 1]) {
      const lf = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.26, 8), bone);
      lf.position.set(side * 0.18, -0.12, 0.98);
      jaw.add(lf);
    }
    const maw = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), lit(COLORS.plasma, 2));
    maw.position.set(0, -0.72, 0.9);
    head.add(maw);
    const mawGlow = glow(COLORS.plasma, 1.4, 0.4);
    mawGlow.position.set(0, -0.72, 1.2);
    head.add(mawGlow);

    // paws gripping the arena edge
    for (const side of [-1, 1]) {
      const paw = new THREE.Group();
      paw.position.set(side * 1.55, -1.75, 0.75);
      paw.rotation.z = side * 0.35;
      const pad = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), gold);
      pad.scale.set(0.62, 0.36, 0.6);
      paw.add(pad);
      const knuckles = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.08, 8, 20, Math.PI), goldDark);
      knuckles.rotation.x = -Math.PI / 2;
      knuckles.position.set(0, 0.15, 0.1);
      paw.add(knuckles);
      for (let c = 0; c < 4; c++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.38, 8), bone);
        claw.position.set((c - 1.5) * 0.26, -0.1, 0.55);
        claw.rotation.x = Math.PI / 2 + 0.35;
        paw.add(claw);
      }
      tilt.add(paw);
    }

    let roarT = -1, health = 1, flashT = 0;
    const baseEye = new THREE.Color(0xd8fbff);
    root.userData = {
      roar() { roarT = 0; },
      setHealth(f) { health = clamp01(f); },
      hitFlash() { flashT = 1; },
      update(t, dt) {
        // breathing mane
        const rage = 1 - health;
        spikes.forEach((s) => {
          const k = 1 + Math.sin(t * (2.4 + rage * 3) + s.phase) * (0.08 + s.ri * 0.04);
          s.holder.scale.set(1, k, 1);
        });
        mane.rotation.z = Math.sin(t * 0.4) * 0.05;
        halo.rotation.z = t * 0.3;
        halo2.rotation.z = -t * 0.2;
        maneGlow.material.opacity = 0.3 + Math.sin(t * 1.5) * 0.06 + rage * 0.2;
        head.rotation.y = Math.sin(t * 0.5) * 0.12;
        head.rotation.x = Math.sin(t * 0.7) * 0.04;
        gem.rotation.y = t * 1.2;

        let open = 0.05 + Math.sin(t * 0.9) * 0.03;
        let charge = 0;
        if (roarT >= 0) {
          roarT += dt;
          const r = roarT;
          if (r < 0.9) { charge = r / 0.9; open = 0.05 + easeOut(charge) * 0.55; }
          else if (r < 1.5) { charge = 1; open = 0.6 + Math.sin(r * 50) * 0.03; }
          else if (r < 2.1) { const k = (r - 1.5) / 0.6; charge = 1 - k; open = 0.6 * (1 - k) + 0.05; }
          else roarT = -1;
        }
        jaw.rotation.x = open;
        maw.material.color.set(COLORS.plasma).lerp(new THREE.Color(0xfff2c8), charge * 0.6).multiplyScalar((1.6 + charge * 3) * 0.8);
        maw.scale.setScalar(1 + charge * 0.4);
        mawGlow.material.opacity = 0.35 + charge * 0.65;
        mawGlow.scale.setScalar(1.4 + charge * 3.5);
        flashT = Math.max(0, flashT - dt * 4);
        eyeMat.color.copy(baseEye).lerp(new THREE.Color(COLORS.hostile), charge * 0.6 + rage * 0.3).multiplyScalar((2.6 + charge * 2 + flashT * 2) * 0.8);
        eyes.forEach((e) => { e.material.opacity = 0.6 + charge * 0.4; });
        gold.emissive.setRGB(0.35 + flashT, 0.2 + flashT * 0.8, flashT * 0.6);
      },
    };
    return root;
  };

  /* ---------- persistent-thirds boss health ----------
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
