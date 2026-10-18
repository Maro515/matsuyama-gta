'use strict';
/* =========================================================
   自転車（ママチャリ）に乗る人
   松山は自転車の街。歩道（狭い道は道の端）を時速13〜18kmで走り、交差点で曲がり、
   前に人がいると減速してベルを鳴らす。自分の車ではねると転んで歩行者になる（はねた扱い）。
   描画は自転車の部品ごとに1回（フレームの色はインスタンス色）、乗る人はペダル角4段階ごとに1回
   ========================================================= */
G3.cyclists = (function () {
  const THREE = G3.THREE, U = G3.U;
  const MAX = 24;
  const list = [];
  const events = [];   // ベル（game.html の環境音が拾う）
  const FRAME_COLS = ['#c8c9cc', '#2a4f8e', '#8a2a2a', '#e8e4da', '#2a2c30', '#d8a8b8', '#3a6a4a'];
  const SHIRTS = ['#e8e8e4', '#3a4a6a', '#c05848', '#b8c8e0', '#2a2c30', '#e8d8b0', '#556b3e', '#d0d4d8', '#1e2a4a'];
  const SKIN = ['#e8c8a0', '#f0d4b0', '#d8b088', '#c89870'], HAIR = ['#2c2620', '#141414', '#4a3826', '#6e6258'];
  let bikeIMs = [], riderIMs = [], built = false;
  const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

  function riderMaterial() {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    m.name = 'CycRider';
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float part;\nattribute vec3 iShirt, iPants, iSkin, iHair;\nvarying vec3 vPC;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vPC = part < 0.5 ? iShirt : part < 1.5 ? iPants : part < 2.5 ? vec3(0.024, 0.018, 0.016) : part < 3.5 ? iSkin : part < 4.5 ? vec3(0.008) : iHair;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPC;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( vPC, opacity );');
    };
    m.customProgramCacheKey = () => 'cyc-rider-1';
    return m;
  }
  function build(scene) {
    const node = G3.glbNode('street', 'bicycle_a');
    const geos = G3.dyn && G3.dyn.cyclistGeometries && G3.dyn.cyclistGeometries();
    if (!node || !geos) return;
    node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    node.traverse(o => {
      if (!o.isMesh) return;
      const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const im = new THREE.InstancedMesh(o.geometry, o.material, MAX);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.userData.local = local;
      im.userData.frame = /^SP_Bike_/.test(o.material.name || '');
      if (im.userData.frame) { im.material = o.material.clone(); im.material.color.set(0xffffff); im.setColorAt(0, _c.set('#ffffff')); }
      im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
      bikeIMs.push(im);
    });
    const mat = riderMaterial();
    for (const g0 of geos) {
      const g = g0.clone();
      const atts = {};
      for (const nm of ['iShirt', 'iPants', 'iSkin', 'iHair']) { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(nm, a); atts[nm] = a; }
      const im = new THREE.InstancedMesh(g, mat, MAX);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.userData.atts = atts;
      im.count = 0; im.frustumCulled = false; im.castShadow = true; im.receiveShadow = true;
      scene.add(im);
      riderIMs.push(im);
    }
    built = true;
  }

  /* ---------- 動き ---------- */
  const rnd = Math.random;
  const offFor = r => r.kind === 'lane' ? r.w / 2 - 1.1 : r.w / 2 + 3.4;   // 歩道の真ん中（狭い道は道の端）
  function spawn() {
    for (let t = 0; t < 10; t++) {
      const ang = rnd() * Math.PI * 2, dd = 70 + rnd() * 360;
      const ri = roadInfo(S.px + Math.cos(ang) * dd, S.py + Math.sin(ang) * dd);
      if (!ri || ri.road.kind === 'arcade') continue;
      const r = ri.road, d = dOnPl(r.pl, ri.x, ri.y), side = rnd() < 0.5 ? 1 : -1;
      const q = plAt(r.pl, d), o = side * offFor(r), x = q.x + Math.sin(q.a) * o, y = q.y - Math.cos(q.a) * o;
      if (typeof inViewAhead === 'function' && inViewAhead(x, y, 150, true)) continue;
      if (blockedAt(x, y, 1.0)) continue;
      const cs = SHIRTS[(rnd() * SHIRTS.length) | 0];
      list.push({ r, d, dir: rnd() < 0.5 ? 1 : -1, side, x, y, a: 0, sp: 0, cruise: (13 + rnd() * 5) / 3.6 * U,   // km/h → 単位/秒
        ph: rnd() * 6.28, bellT: 0, frame: FRAME_COLS[(rnd() * FRAME_COLS.length) | 0],
        cols: [cs, ['#3c4250', '#2e3844', '#55584e', '#6b4a3c', '#1e2a4a'][(rnd() * 5) | 0], SKIN[(rnd() * 4) | 0], HAIR[(rnd() * 4) | 0]] });
      return;
    }
  }
  function step(c, dt) {
    const r = c.r;
    // 前の人・自分（プレイヤー）
    const hx = Math.cos(c.a), hy = Math.sin(c.a);
    let slow = 0;
    const chk = (x, y, R) => { const rx = x - c.x, ry = y - c.y, f = rx * hx + ry * hy; return f > 0 && f < R && Math.abs(-rx * hy + ry * hx) < 2.2; };
    if (S.mode === 'foot' && chk(S.px, S.py, 9)) slow = 2;
    else for (const p of peds) if (!p.down && chk(p.x, p.y, 7)) { slow = 1; break; }
    const tgt = slow === 2 ? 0 : slow === 1 ? c.cruise * 0.35 : c.cruise;
    c.sp += clamp(tgt - c.sp, -30 * dt, 10 * dt);
    if (slow && (c.bellT -= dt) <= 0 && hyp(c.x - S.px, c.y - S.py) < 60) { c.bellT = 2.5 + rnd() * 2; events.push({ x: c.x, y: c.y }); }
    const pd = c.d;
    c.d += c.dir * c.sp * dt;
    // 交差点で時々曲がる
    for (const j of r.junc) {
      const passed = c.dir > 0 ? (j.d > pd && j.d <= c.d) : (j.d < pd && j.d >= c.d);
      if (!passed || j.road.kind === 'arcade' || rnd() > 0.35) continue;
      c.r = j.road; c.d = clamp(j.od, 0, j.road.pl.len); c.dir = rnd() < 0.5 ? 1 : -1;
      break;
    }
    if (c.d < 0 || c.d > c.r.pl.len) { c.d = clamp(c.d, 0, c.r.pl.len); c.dir *= -1; }
    const q = plAt(c.r.pl, c.d), o = c.side * offFor(c.r);
    const nx = q.x + Math.sin(q.a) * o, ny = q.y - Math.cos(q.a) * o;
    const mv = hyp(nx - c.x, ny - c.y);
    if (mv > 0.01) c.a = Math.atan2(ny - c.y, nx - c.x);
    // 曲がり角で急に飛ばない（大きく移る時は数フレームかけて寄せる）
    if (mv > 6) { c.x += (nx - c.x) * Math.min(1, dt * 6); c.y += (ny - c.y) * Math.min(1, dt * 6); } else { c.x = nx; c.y = ny; }
    c.ph += c.sp * dt * 0.19;   // ペダル（ギア比 2.5、車輪径 0.66m の速さ）
    // 自分の車にはねられる → 転んで歩行者に（はねた扱いは歩行者側の判定で）
    if (S.mode === 'car' && S.pcar && Math.abs(S.pcar.v) > 14 && hyp(S.pcar.x - c.x, S.pcar.y - c.y) < 14 &&
      carCircles(S.pcar, S.pcar.x, S.pcar.y, S.pcar.a).some(qq => hyp(qq[0] - c.x, qq[1] - c.y) < qq[2] + 1.6)) {
      const p = spawnPedAt(c.x, c.y, false);
      p.c = c.cols[0]; p.pc = c.cols[1]; p.sk = c.cols[2]; p.hc = c.cols[3];
      reattachPed(p);
      c.gone = true;
    }
  }
  let popT = 0;
  function update(dt) {
    if (!built) return;
    const night = G3.day < 0.3, rain = S.rainI > 0.4;
    const target = rain ? 5 : night ? 8 : 16;
    if ((popT -= dt) <= 0) {
      popT = 0.6;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].gone || hyp(list[i].x - S.px, list[i].y - S.py) > 620) list.splice(i, 1);
      if (list.length < target && list.length < MAX) spawn();
    }
    for (const c of list) step(c, dt);
    for (let i = list.length - 1; i >= 0; i--) if (list[i].gone) list.splice(i, 1);
    // 描画
    const cnt = [0, 0, 0, 0];
    let n = 0;
    for (const c of list) {
      const y = typeof G3.onSidewalkY === 'function' ? G3.onSidewalkY(c.x, c.y) : heightAt(c.x, c.y);
      _e.set(0, -c.a, 0); _q.setFromEuler(_e); _p.set(c.x, y, c.y); _s.setScalar(U);
      _m.compose(_p, _q, _s);
      for (const im of bikeIMs) {
        im.setMatrixAt(n, _m2.multiplyMatrices(_m, im.userData.local));
        if (im.userData.frame) im.setColorAt(n, _c.set(c.frame));
      }
      n++;
      const k = (((Math.floor(c.ph / (Math.PI / 2)) % 4) + 4) % 4);
      const im = riderIMs[k], j = cnt[k]++;
      im.setMatrixAt(j, _m);
      const at = im.userData.atts;
      ['iShirt', 'iPants', 'iSkin', 'iHair'].forEach((nm, t) => { _c.set(c.cols[t]); at[nm].setXYZ(j, _c.r, _c.g, _c.b); });
    }
    for (const im of bikeIMs) { im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
    riderIMs.forEach((im, k) => { im.count = cnt[k]; im.instanceMatrix.needsUpdate = true; for (const a of Object.values(im.userData.atts)) a.needsUpdate = true; });
  }
  return { build, update, events, stats: () => ({ n: list.length }) };
})();
