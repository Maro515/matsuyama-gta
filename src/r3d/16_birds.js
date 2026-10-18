'use strict';
/* =========================================================
   鳥（ハト・カラス・カモメ）
   ハトは駅前・公園・寺社の広場で地面をついばみ、人や車が近づくと一斉に飛び立ち、輪を描いて近くへ降りる。
   カラスは電線に止まり、近づくと飛び移る。カモメは港と浜の上を舞う。
   全部を1つのインスタンスメッシュで描き、羽ばたきは頂点シェーダーで動かす。夜と強い雨の時は姿を消す
   ========================================================= */
G3.birds = (function () {
  const THREE = G3.THREE, U = G3.U;
  const MAX = 220;
  const KIND = {
    pigeon: { col: '#7d8494', s: 1.0, rate: 19 },
    crow: { col: '#141518', s: 1.45, rate: 13 },
    gull: { col: '#eeeeea', s: 1.75, rate: 7 },
  };
  const UNI = { uBT: { value: 0 } };
  let mesh = null, aBird = null;
  const birds = [];
  const flocks = [];   // ハトの群れの居場所 {x, y, pts:[[x,y]...], n, live}
  const wires = [];    // 電線 [x0,y0,z0,x1,y1,z1]
  const GULL_SPOTS = [[1000, 1790, 260], [1330, 648, 300], [1195, 965, 240], [1100, 1300, 220]];
  const events = [];   // 音のきっかけ（飛び立ち）。game.html の環境音が拾う

  /* ---------- 形（m、+X が前） ---------- */
  function birdGeometry() {
    const P = [], E = [];
    const tri = (a, b, c, ea = [0, 0], eb = [0, 0], ec = [0, 0]) => { P.push(...a, ...b, ...c); E.push(...ea, ...eb, ...ec); };
    const nose = [0.19, 0.03, 0], tail = [-0.13, 0.02, 0], top = [0.02, 0.09, 0], bot = [0.0, -0.04, 0], l = [0.0, 0.02, 0.065], r = [0.0, 0.02, -0.065];
    const head = [0.12, 0.13, 0];
    // 胴（八面体）と頭
    tri(nose, top, l); tri(nose, r, top); tri(nose, l, bot); tri(nose, bot, r);
    tri(tail, l, top); tri(tail, top, r); tri(tail, bot, l); tri(tail, r, bot);
    tri(head, [0.2, 0.06, 0], [0.08, 0.07, 0.04]); tri(head, [0.08, 0.07, -0.04], [0.2, 0.06, 0]);
    tri(head, [0.08, 0.07, 0.04], [0.08, 0.07, -0.04]);
    // 尾羽
    tri([-0.1, 0.03, 0.035], [-0.27, 0.025, 0], [-0.1, 0.03, -0.035]);
    // 翼（たたむと胴に沿う。開くと先端が外へ。羽ばたきは先端ほど大きく）
    for (const s of [1, -1]) {
      const rf = [0.07, 0.04, s * 0.05], rb = [-0.07, 0.04, s * 0.05], tf = [0.01, 0.04, s * 0.06], tb = [-0.12, 0.04, s * 0.055];
      const ef = [s * 0.27, 1], eb = [s * 0.27, 1];
      tri(rf, rb, tb, [0, 0], [0, 0], eb); tri(rf, tb, tf, [0, 0], eb, ef);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aExt', new THREE.Float32BufferAttribute(E, 2));
    g.computeVertexNormals();
    return g;
  }

  /* ---------- 居場所 ---------- */
  function freeGround(x, y) {
    if (inWaterRaw(x, y) || blockedAt(x, y, 0.8)) return false;
    const ri = roadInfo(x, y);
    return !(ri && ri.road.kind !== 'arcade' && ri.d < ri.road.w / 2 + 1);   // 車道には降りない
  }
  function buildSpots() {
    const C = [[4725, 2990], [5880, 3700], [7395, 2340], [7434, 2245], [5700, 2990], [5720, 3110], [5640, 3200], [5834, 2790], [8114, 2560], [5563, 1855], [5210, 5210], [5100, 5100], [7430, 2585]];
    for (const q of LMS) if (/^(isaniwa|yujinja|hogonji|shinonome|asuka|shikido|garden|temple|shrine)$/.test(q.t)) {
      const ri = roadInfo(q.x, q.y);
      C.push(ri ? [(q.x + ri.x) / 2, (q.y + ri.y) / 2] : [q.x, q.y + 30]);
    }
    const rr = mulberry32(8801);
    for (const [cx, cy] of C) {
      const pts = [];
      for (let k = 0; k < 60 && pts.length < 14; k++) {
        const a = rr() * Math.PI * 2, d = 3 + rr() * 26, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
        if (freeGround(x, y)) pts.push([x, y]);
      }
      if (pts.length >= 6) flocks.push({ x: cx, y: cy, pts, n: 7 + ((rr() * 6) | 0), live: 0 });
    }
    // 電線（電柱と電柱の間）
    for (const p of POLES) if (p.lx != null) wires.push([p.x, p.y, heightAt(p.x, p.y) + 21.5, p.lx, p.ly, heightAt(p.lx, p.ly) + 21.5]);
  }

  function build(scene) {
    buildSpots();
    const g = birdGeometry();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
    mat.onBeforeCompile = sh => {
      sh.uniforms.uBT = UNI.uBT;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 aExt;\nattribute vec3 aBird;\nuniform float uBT;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float fl = sin(uBT * aBird.y + aBird.x);
          transformed.z += aExt.x * aBird.z * (1.0 - 0.3 * fl * fl);
          transformed.y += aExt.y * aBird.z * fl * 0.2;`);
    };
    mat.customProgramCacheKey = () => 'birds1';
    mesh = new THREE.InstancedMesh(g, mat, MAX);
    aBird = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    aBird.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aBird', aBird);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    mesh.name = 'birds';
    scene.add(mesh);
  }

  /* ---------- 動き ---------- */
  const rnd = Math.random;
  function spawnPigeon(f) {
    if (birds.length >= MAX) return;
    const p = f.pts[(rnd() * f.pts.length) | 0];
    birds.push({ k: 'pigeon', f, x: p[0] + (rnd() - 0.5) * 3, y: p[1] + (rnd() - 0.5) * 3, z: 0, a: rnd() * Math.PI * 2, st: 'ground',
      vx: 0, vy: 0, vz: 0, t: rnd() * 2, open: 0, ph: rnd() * 6.28, peck: 0 });
  }
  function threatNear(x, y, r) {
    if (hyp(S.px - x, S.py - y) < r) return [S.px, S.py];
    if (S.mode === 'car' && S.pcar && hyp(S.pcar.x - x, S.pcar.y - y) < r * 1.5) return [S.pcar.x, S.pcar.y];
    for (const c of traffic) if (c.v > 20 && hyp(c.x - x, c.y - y) < r * 0.8) return [c.x, c.y];
    return null;
  }
  function takeOff(b, from) {
    const a = from ? Math.atan2(b.y - from[1], b.x - from[0]) + (rnd() - 0.5) * 1.2 : rnd() * 6.28;
    const sp = 14 + rnd() * 6;
    b.st = 'fly'; b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.vz = 10 + rnd() * 5;
    b.t = 5 + rnd() * 5; b.cx = b.x + Math.cos(a) * 40; b.cy = b.y + Math.sin(a) * 40; b.alt = 14 + rnd() * 14;
    b.spin = (rnd() < 0.5 ? 1 : -1) * (0.5 + rnd() * 0.4);
  }
  function stepPigeon(b, dt) {
    const gz = heightAt(b.x, b.y);
    if (b.st === 'ground') {
      b.z = gz; b.open = Math.max(0, b.open - dt * 3);
      b.t -= dt;
      if (b.t <= 0) {   // ちょこちょこ歩く・向きを変える・ついばむ
        b.t = 0.6 + rnd() * 2;
        const r = rnd();
        if (r < 0.45) { const a = b.a + (rnd() - 0.5) * 1.6, d = 0.6 + rnd() * 1.2, nx = b.x + Math.cos(a) * d, ny = b.y + Math.sin(a) * d; if (freeGround(nx, ny) && hyp(nx - b.f.x, ny - b.f.y) < 34) { b.a = a; b.tx = nx; b.ty = ny; } }
        else if (r < 0.8) b.peck = 0.5;
        else b.a += (rnd() - 0.5) * 2;
      }
      if (b.tx != null) { const dx = b.tx - b.x, dy = b.ty - b.y, d = hyp(dx, dy); if (d < 0.1) b.tx = null; else { const s = Math.min(d, 1.4 * dt); b.x += dx / d * s; b.y += dy / d * s; } }
      b.peck = Math.max(0, b.peck - dt);
      const th = threatNear(b.x, b.y, 16);
      if (th) {
        let n = 1;
        takeOff(b, th);
        for (const o of birds) if (o !== b && o.f === b.f && o.st === 'ground' && hyp(o.x - b.x, o.y - b.y) < 14) { takeOff(o, th); n++; }   // 群れごと飛び立つ
        if (events.length < 8) events.push({ k: 'flutter', x: b.x, y: b.y, n });
      }
      return;
    }
    // 飛行: 上昇しながら輪を描き、脅威が去ったら群れの居場所へ降りる
    b.open = Math.min(1, b.open + dt * 6);
    b.t -= dt;
    const home = b.f, safe = !threatNear(home.x, home.y, 30);
    let tx, ty, tz;
    if (b.t > 0 || !safe) {
      b.cx += (home.x - b.cx) * dt * 0.05; b.cy += (home.y - b.cy) * dt * 0.05;
      const ang = Math.atan2(b.y - b.cy, b.x - b.cx) + b.spin * dt * 1.4;
      tx = b.cx + Math.cos(ang) * 32; ty = b.cy + Math.sin(ang) * 32; tz = gz + b.alt;
      if (!safe && b.t < -12) { b.gone = true; return; }   // ずっと人がいる → よそへ行く
    } else {
      if (!b.land) b.land = home.pts[(rnd() * home.pts.length) | 0];
      tx = b.land[0]; ty = b.land[1]; tz = heightAt(tx, ty);
      if (hyp(tx - b.x, ty - b.y) < 1.2 && b.z - tz < 1.0) { b.st = 'ground'; b.land = null; b.x = tx; b.y = ty; b.vx = b.vy = b.vz = 0; b.t = 1 + rnd() * 2; return; }
    }
    const dx = tx - b.x, dy = ty - b.y, dz = tz - b.z, d = Math.hypot(dx, dy, dz) || 1;
    const sp = b.land ? Math.min(16, 3 + d * 0.8) : 17;
    b.vx += (dx / d * sp - b.vx) * Math.min(1, dt * 2.2); b.vy += (dy / d * sp - b.vy) * Math.min(1, dt * 2.2); b.vz += (dz / d * sp - b.vz) * Math.min(1, dt * 2.2);
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.z < gz) b.z = gz;
    b.a = Math.atan2(b.vy, b.vx);
  }
  function stepCrow(b, dt) {
    if (b.st === 'perch') {
      b.open = Math.max(0, b.open - dt * 3);
      b.t -= dt;
      if (b.t <= 0) { b.t = 3 + rnd() * 6; b.a += (rnd() < 0.5 ? Math.PI : 0); }   // 時々向きを変える
      if (hyp(S.px - b.x, S.py - b.y) < 9 || (S.mode === 'car' && S.pcar && hyp(S.pcar.x - b.x, S.pcar.y - b.y) < 14)) {
        // 別の電線へ
        const w = wires[(rnd() * wires.length) | 0];
        if (w && hyp(w[0] - b.x, w[1] - b.y) < 260) { const u = 0.2 + rnd() * 0.6; b.st = 'fly'; b.tx = w[0] + (w[3] - w[0]) * u; b.ty = w[1] + (w[4] - w[1]) * u; b.tz = w[2] + (w[5] - w[2]) * u - Math.sin(u * Math.PI) * 1.6 + 0.15; b.wa = Math.atan2(w[4] - w[1], w[3] - w[0]); }
      }
      return;
    }
    b.open = Math.min(1, b.open + dt * 5);
    const dx = b.tx - b.x, dy = b.ty - b.y, d2 = hyp(dx, dy), arc = Math.min(12, d2 * 0.3);
    const dz = b.tz + arc - b.z;
    const sp = 15;
    if (d2 < 1.0) { b.st = 'perch'; b.x = b.tx; b.y = b.ty; b.z = b.tz; b.a = b.wa + Math.PI / 2 * (rnd() < 0.5 ? 1 : -1); b.t = 2; return; }
    b.x += dx / d2 * sp * dt; b.y += dy / d2 * sp * dt; b.z += clamp(dz, -8 * dt, 8 * dt);
    b.a = Math.atan2(dy, dx);
  }
  function stepGull(b, dt) {
    b.open = 1;
    b.ang += b.spin * dt;
    const R = b.R * (0.85 + 0.15 * Math.sin(b.ang * 0.7 + b.ph));
    const x = b.cx + Math.cos(b.ang) * R, y = b.cy + Math.sin(b.ang) * R;
    b.a = Math.atan2(y - b.y, x - b.x);
    b.x = x; b.y = y; b.z = b.alt + Math.sin(b.ang * 1.3 + b.ph) * 4;
    b.flapT -= dt;
    if (b.flapT <= 0) { b.flapping = !b.flapping; b.flapT = b.flapping ? 0.8 + rnd() * 1.2 : 2 + rnd() * 4; }
  }

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  let popT = 0;
  function update(dt) {
    if (!mesh) return;
    const on = G3.day > 0.25 && S.rainI < 0.5;
    mesh.visible = on;
    if (!on) { if (birds.length) birds.length = 0; for (const f of flocks) f.live = 0; return; }
    UNI.uBT.value = (UNI.uBT.value + dt) % 1000;
    // 近くの群れを出し、遠くは消す（0.5秒ごと）
    if ((popT -= dt) <= 0) {
      popT = 0.5;
      for (const f of flocks) {
        const d = hyp(f.x - S.px, f.y - S.py);
        if (d < 420 && !f.live && d > 60) { for (let i = 0; i < f.n; i++) spawnPigeon(f); f.live = 1; }
        else if (d > 600 && f.live) f.live = 0;
      }
      for (let i = birds.length - 1; i >= 0; i--) {
        const b = birds[i];
        const far = hyp(b.x - S.px, b.y - S.py) > (b.k === 'gull' ? 900 : 640);
        if (b.gone || far || (b.k === 'pigeon' && !b.f.live)) birds.splice(i, 1);
      }
      // カラス: 近くの電線に数羽（電線1本に2羽まで、全部で10羽まで）
      let nc = 0; for (const b of birds) if (b.k === 'crow') nc++;
      const nearW = wires.filter(w => { const d = hyp(w[0] - S.px, w[1] - S.py); return d < 380 && d > 60; });
      for (let t = 0; t < 4 && nc < Math.min(10, nearW.length * 2) && birds.length < MAX; t++) {
        const w = nearW[(rnd() * nearW.length) | 0];
        const u = 0.2 + rnd() * 0.6, wa = Math.atan2(w[4] - w[1], w[3] - w[0]);
        const x = w[0] + (w[3] - w[0]) * u, y = w[1] + (w[4] - w[1]) * u, z = w[2] + (w[5] - w[2]) * u - Math.sin(u * Math.PI) * 1.6 + 0.15;
        birds.push({ k: 'crow', x, y, z, a: wa + Math.PI / 2 * (rnd() < 0.5 ? 1 : -1), st: 'perch', t: rnd() * 4, open: 0, ph: rnd() * 6.28, wa });
        nc++;
      }
      // カモメ: 港・浜の近くにいる時
      for (const [gx, gy, gr] of GULL_SPOTS) {
        if (hyp(gx - S.px, gy - S.py) > 800) continue;
        let n = 0; for (const b of birds) if (b.k === 'gull' && b.cx === gx) n++;
        for (; n < 7 && birds.length < MAX; n++) birds.push({ k: 'gull', cx: gx, cy: gy, R: gr * (0.3 + rnd() * 0.5), ang: rnd() * 6.28, spin: (rnd() < 0.5 ? 1 : -1) * (0.08 + rnd() * 0.1),
          alt: heightAt(gx, gy) + 25 + rnd() * 25, x: gx, y: gy, z: 40, a: 0, ph: rnd() * 6.28, open: 1, flapping: false, flapT: rnd() * 3 });
      }
    }
    let n = 0;
    for (const b of birds) {
      if (b.k === 'pigeon') stepPigeon(b, dt); else if (b.k === 'crow') stepCrow(b, dt); else stepGull(b, dt);
      if (n >= MAX) continue;
      const K = KIND[b.k];
      const pitch = b.k === 'pigeon' && b.st === 'ground' ? (b.peck > 0 ? -0.5 * Math.sin(b.peck * 12.5) : 0) : clamp((b.vz || 0) * 0.03, -0.4, 0.4);
      _e.set(0, -b.a, pitch, 'YZX'); _q.setFromEuler(_e);
      _p.set(b.x, b.z + 0.02, b.y); _s.setScalar(U * K.s);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(n, _m);
      mesh.setColorAt(n, _c.set(K.col));
      const flap = b.k === 'gull' ? (b.flapping ? K.rate : 0.6) : (b.open > 0.05 ? K.rate : 0);
      aBird.setXYZ(n, b.ph, flap, b.open);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    aBird.needsUpdate = true;
  }
  // 近くの鳥の数（鳴き声用）
  function near(kind, r) { let n = 0; for (const b of birds) if (b.k === kind && hyp(b.x - S.px, b.y - S.py) < r) n++; return n; }
  return { build, update, near, events, stats: () => ({ birds: birds.length, flocks: flocks.length, wires: wires.length }) };
})();
