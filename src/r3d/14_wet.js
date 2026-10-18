'use strict';
/* =========================================================
   濡れた路面の映り込み（雨の夜）
   ---------------------------------------------------------
   濡れたアスファルトは街灯・看板・信号・自販機・車のライトを、縦に長い光の筋として映す。
   光源ごとに「路面の下の鏡像」を通る鉛直な板をカメラへ向けて立て、
   板の各点をカメラからの視線で路面へ落として描く。
   画面上の形は鏡像どおり、深度は路面そのものなので、手前の車・人・建物にはちゃんと隠れる。
   建物の陰になった光源（裏通りの街灯など）はカメラからの見通しで消す。
   ========================================================= */
G3.refl = (function () {
  const THREE = G3.THREE;
  const MAXD = 256;            // 車のライト（毎フレーム詰め直す）
  const SP = [], SS = [], SC = [];   // 静的な光源: [x, z, 地面, 高さ] [半幅, 縦の半分, 向きx, 向きz] [r, g, b, 種類]
  let ns = 0;
  const _c = new THREE.Color();
  // 光源を登録（各所の build から呼ばれる）。y は光の中心の高さ（絶対値）。kind: 0=通常 1,2=信号の現示グループ
  function add(x, z, y, w, hv, col, k, fx = 0, fz = 0, kind = 0) {
    const ri = roadInfo(x, z);
    if (ri && ri.road.kind === 'arcade' && ri.d < ri.road.w / 2 + 3) return;   // アーケードの下は濡れない
    _c.set(col);
    const g = heightAt(x, z);
    const fl = Math.hypot(fx, fz) || 1;
    SP.push(x, z, g, Math.max(0.5, y - g));
    SS.push(w, hv, fx / fl, fz / fl);
    SC.push(_c.r * k, _c.g * k, _c.b * k, kind);
    ns++;
  }

  // 街灯の灯具（光の円錐 24_beams.js でも使う）
  const LAMPS3 = [];
  function lamp(x, z, y) { LAMPS3.push([x, z, y]); add(x, z, y, 0.7, 0.3, 0xfff0d2, 1.25); }

  /* ---------- 見通し（建物の高さのラスター） ---------- */
  const LC = 6, LW = Math.ceil(W / LC), LH = Math.ceil(H / LC);
  let occ = null;
  function buildOcc() {
    occ = new Uint16Array(LW * LH);
    // マスの中心が建物の中にあるマスだけ塗る（歩道側へはみ出さない）
    const fill = (x0, y0, x1, y1, top) => {
      const v = Math.min(65535, Math.max(1, Math.round(top * 4)));
      const i0 = clamp(Math.ceil(x0 / LC - 0.5), 0, LW - 1), i1 = clamp(Math.floor(x1 / LC - 0.5), 0, LW - 1);
      const j0 = clamp(Math.ceil(y0 / LC - 0.5), 0, LH - 1), j1 = clamp(Math.floor(y1 / LC - 0.5), 0, LH - 1);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const q = j * LW + i; if (occ[q] < v) occ[q] = v; }
    };
    for (const b of buildings) {
      if (b.noDraw || b.x1 - b.x0 < 4 || b.y1 - b.y0 < 4) continue;
      fill(b.x0 + 1.5, b.y0 + 1.5, b.x1 - 1.5, b.y1 - 1.5, heightAt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2) + b.hW);
    }
    for (const q of LMS) if (q.solid) { const s = q.solid; fill(s[0] + 3, s[1] + 3, s[2] - 3, s[3] - 3, heightAt(q.x, q.y) + (LMH[q.t] || 20)); }
  }
  // カメラ (cx,cy,cz) から光源 (lx,ly,lz) が見えるか。カメラのそば（壁際に寄ったとき）と光源の手前 12（取り付けた壁の分）は見ない
  function los(cx, cy, cz, lx, ly, lz) {
    const dx = lx - cx, dz = lz - cz, D = Math.hypot(dx, dz);
    const n = Math.floor(D / 4) - 3;
    let run = 0;   // 角をかすめただけでは隠さない（2 点続けて建物の中なら隠れる）
    for (let s = 2; s <= n; s++) {
      const t = s * 4 / D;
      const i = ((cx + dx * t) / LC) | 0, j = ((cz + dz * t) / LC) | 0;
      if (i < 0 || j < 0 || i >= LW || j >= LH) { run = 0; continue; }
      const v = occ[j * LW + i];
      if (v && v * 0.25 > cy + (ly - cy) * t) { if (++run >= 2) return false; } else run = 0;
    }
    return true;
  }

  /* ---------- 光を映す面（舗装・水面）のマスク: 畑・芝生・アーケードの下には映さない ---------- */
  const MK = 5, MW = Math.ceil(W / MK), MH = Math.ceil(H / MK);
  const lots = [];   // 駐車場など（各所の build から paved() で登録）
  const PLAZAS = [[4620, 2900, 4830, 3080], [7330, 2280, 7460, 2400], [5770, 3600, 5990, 3790], [880, 1580, 1250, 1900], [1200, 500, 1500, 800]];   // 駅前広場・港
  function paved(pts) { lots.push(pts.map(p => p.x !== undefined ? [p.x, p.y] : [p[0], p[1]])); }
  function buildMask() {
    const cv = document.createElement('canvas'); cv.width = MW; cv.height = MH;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, MW, MH);
    g.setTransform(1 / MK, 0, 0, 1 / MK, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const path = pts => { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); };
    const poly = (pts, col) => { g.fillStyle = col; path(pts); g.closePath(); g.fill(); };
    const line = (pts, w, col) => { g.strokeStyle = col; g.lineWidth = w; path(pts); g.stroke(); };
    // 水面（海・川・堀・用水路）
    poly(SEA, '#fff'); poly(ISLAND, '#000');
    for (const r of RIVERS) line(r.pl.pts, r.w, '#fff');
    for (const m of MOATS) line(m.pl.pts, m.w, '#fff');
    for (const cn of CANALS) line(cn.vert ? [[cn.c, cn.t0], [cn.c, cn.t1]] : [[cn.t0, cn.c], [cn.t1, cn.c]], CANAL_W, '#fff');
    // 舗装（車道と歩道・路地・駅前広場・駐車場）
    for (const r of ROADS) if (r.kind !== 'arcade') line(r.pts, r.w + (r.kind === 'lane' ? 2 : 2 * G3.SW + 1), '#fff');
    for (const a of ALLEYS) line(a.pts, a.w + 1, '#fff');
    for (const q of lots) poly(q, '#fff');
    g.fillStyle = '#fff';
    for (const [x0, y0, x1, y1] of PLAZAS) g.fillRect(x0, y0, x1 - x0, y1 - y0);
    // アーケードの下は濡れない
    for (const r of ROADS) if (r.kind === 'arcade') line(r.pts, r.w + 2, '#000');
    const im = g.getImageData(0, 0, MW, MH).data, d = new Uint8Array(MW * MH);
    for (let i = 0; i < d.length; i++) d[i] = im[i * 4];
    const t = new THREE.DataTexture(d, MW, MH, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true;
    return t;
  }

  /* ---------- シェーダー ---------- */
  const VS = `
    attribute vec2 corner;   // x: 横 -1..1 / y: 0=上端（光源の根元側）..1=下端（手前）
    attribute vec4 iP;       // 光源 x, z, 地面の高さ, 地面からの高さ
    attribute vec4 iS;       // 半幅, 縦の半分, 向き x, z（0,0 = 全方向）
    attribute vec4 iC;       // 色（強さ込み）, 種類
    attribute float iV;      // 見通し
    uniform float uInt, uUp, uDown, uLat, uFar, uCamG, uFogN, uFogF, uGain;
    uniform vec3 uSig0, uSig1;
    varying vec4 vA;
    varying vec3 vB;
    varying vec3 vCol;
    varying vec3 vQ;
    varying vec2 vG;
    void main() {
      vec3 C = cameraPosition;
      vec2 L = iP.xy;
      float g = iP.z, h = iP.w, hv = iS.y;
      vec2 dv = C.xz - L;
      float D = max(length(dv), 1e-3);
      vec3 col = iC.rgb;
      if (iC.w > 0.5) col *= iC.w < 1.5 ? uSig0 : uSig1;
      vec2 f = iS.zw;
      float dirK = dot(f, f) > 0.0 ? smoothstep(-0.15, 0.45, dot(f, dv) / D) : 1.0;
      float hc = C.y - g, fc = C.y - uCamG - 0.13;   // 路面（地形 +0.05・白線 +0.07）の少し上に落とす
      float fade = (1.0 - smoothstep(uFar * 0.5, uFar, D)) * smoothstep(4.0, 16.0, D) * (1.0 - smoothstep(uFogN, uFogF, D) * 0.85);
      float k = uInt * iV * dirK * fade;
      if (k < 0.002 || hc < 0.6 || fc < 0.3) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
      vec2 dn = dv / D;
      vec3 right = vec3(-dn.y, 0.0, dn.x);
      float phiV = atan(hc + h, D);               // 鏡像（光の中心）の俯角
      float phiB = atan(hc, D);                   // 光源の根元
      float src = atan(hv, D);                    // 縦に長い光源は鏡像も長い
      float phiT = max(phiB, phiV - src - uUp);
      float phiN = min(phiV + src + uDown, 1.35);
      float phi = mix(phiT, phiN, corner.y);
      float yb = C.y - D * tan(phi);
      float wb = (iS.x + D * uLat) * 2.0;
      vec3 Q = vec3(L.x, yb, L.y) + right * (corner.x * wb);
      // 路面（光源の根元とカメラ直下を結ぶ面）へ視線で落とす
      float t = fc / max(fc - (yb - g - 0.13), 1e-4);
      vec3 P = C + (Q - C) * t;
      vec4 cq = projectionMatrix * viewMatrix * vec4(Q, 1.0);
      vec4 cp = projectionMatrix * viewMatrix * vec4(P, 1.0);
      gl_Position = cq;
      gl_Position.z = cp.z / cp.w * cq.w;
      float fr = 0.18 + 0.82 * pow(1.0 - sin(phiV), 5.0);   // 浅い角度ほど強く映る
      vCol = col * k * fr * uGain;
      vA = vec4(corner.x, C.y - yb, D, phiV);
      vB = vec3(src, uUp, uDown);
      vQ = Q;
      vG = vec2(g + 0.13, fc);
    }`;
  const FS = `
    uniform float uTime;
    uniform sampler2D uMask;
    uniform vec2 uMaskK;
    varying vec4 vA;
    varying vec3 vB;
    varying vec3 vCol;
    varying vec3 vQ;
    varying vec2 vG;
    void main() {
      // この画素が映している路面の位置（板の点を視線で路面へ落とす）→ 舗装・水面だけ光を映す
      float tg = vG.y / max(vG.y - (vQ.y - vG.x), 1e-4);
      vec2 pg = cameraPosition.xz + (vQ.xz - cameraPosition.xz) * tg;
      float wetM = texture2D(uMask, pg * uMaskK).r;
      if (wetM < 0.01) discard;
      float phi = atan(vA.y, vA.z);
      float a = phi - vA.w;
      float s = max(abs(a) - vB.x, 0.0) / (a < 0.0 ? vB.y : vB.z);
      // 鋭い芯＋長い裾（GGX の鏡面ローブに近い形）
      float lobe = 1.0 / (1.0 + s * s * 40.0) + 0.3 / (1.0 + s * s * 5.0);
      lobe *= 1.0 - smoothstep(0.55, 1.0, s);
      float x2 = vA.x * vA.x;
      float lat = exp(-x2 * 14.0) + 0.22 * exp(-x2 * 3.0);
      // 雨粒の波紋で筋が細かく途切れてちらつく
      float rip = 0.86 + 0.14 * sin(phi * 1700.0 + uTime * 11.0 + vA.z * 0.37) * sin(phi * 610.0 - uTime * 7.0);
      gl_FragColor = vec4(vCol * (lobe * lat * rip * wetM), 1.0);
    }`;
  const UNI = {
    uInt: { value: 0 }, uGain: { value: 2.2 }, uUp: { value: 0.055 }, uDown: { value: 0.2 }, uLat: { value: 0.0025 }, uFar: { value: 900 },
    uCamG: { value: 0 }, uFogN: { value: 160 }, uFogF: { value: 1700 }, uTime: { value: 0 },
    uSig0: { value: new THREE.Color(1, 1, 1) }, uSig1: { value: new THREE.Color(1, 1, 1) },
    uMask: { value: null }, uMaskK: { value: new THREE.Vector2(1 / (MW * MK), 1 / (MH * MK)) },
  };
  let mat = null, mesh = null, dmesh = null, dgeo = null;
  function baseGeo(count) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, 0, 1, 0, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = count;
    return g;
  }
  const iattr = (g, name, arr, sz, dyn) => {
    const a = new THREE.InstancedBufferAttribute(arr, sz);
    if (dyn) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    return a;
  };
  const bucket = new Map();   // 300 単位のマス → 光源番号
  let vis = null, visT = null, attrV = null;
  function build(scene) {
    buildOcc();
    UNI.uMask.value = buildMask();
    mat = new THREE.ShaderMaterial({ uniforms: UNI, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -90 });
    const g = baseGeo(ns);
    iattr(g, 'iP', new Float32Array(SP), 4);
    iattr(g, 'iS', new Float32Array(SS), 4);
    iattr(g, 'iC', new Float32Array(SC), 4);
    vis = new Float32Array(ns); visT = new Float32Array(ns);
    attrV = iattr(g, 'iV', vis, 1, true);
    mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false; mesh.name = 'wet_refl';
    scene.add(mesh);
    for (let i = 0; i < ns; i++) {
      const q = ((SP[i * 4 + 1] / 300) | 0) * 64 + ((SP[i * 4] / 300) | 0);
      let a = bucket.get(q); if (!a) bucket.set(q, a = []); a.push(i);
    }
    dgeo = baseGeo(0);
    for (const [nm, sz] of [['iP', 4], ['iS', 4], ['iC', 4], ['iV', 1]]) iattr(dgeo, nm, new Float32Array(MAXD * sz), sz, true);
    dmesh = new THREE.Mesh(dgeo, mat);
    dmesh.frustumCulled = false; dmesh.renderOrder = 3; dmesh.visible = false; dmesh.name = 'wet_refl_cars';
    scene.add(dmesh);
    G3.street && G3.street.stats && (G3.street.stats.wet_refl = ns);
  }

  /* ---------- 毎フレーム ---------- */
  let cand = [], inCand = null, candT = 0, lastX = 1e9, lastZ = 1e9, rr = 0;
  const R = 900;
  function gather(cx, cz) {
    if (!inCand) inCand = new Uint8Array(ns);
    const prev = cand;
    cand = [];
    const i0 = Math.max(0, ((cx - R) / 300) | 0), i1 = ((cx + R) / 300) | 0, j0 = Math.max(0, ((cz - R) / 300) | 0), j1 = ((cz + R) / 300) | 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const a = bucket.get(j * 64 + i);
      if (a) for (const k of a) { const dx = SP[k * 4] - cx, dz = SP[k * 4 + 1] - cz; if (dx * dx + dz * dz < R * R) cand.push(k); }
    }
    for (const k of prev) inCand[k] = 2;
    for (const k of cand) { if (inCand[k] !== 2) { vis[k] = 0; visT[k] = -1; } inCand[k] = 1; }
    for (const k of prev) if (inCand[k] === 2) { inCand[k] = 0; vis[k] = 0; }
  }
  function carLights(cam) {
    const aP = dgeo.attributes.iP.array, aS = dgeo.attributes.iS.array, aC = dgeo.attributes.iC.array, aV = dgeo.attributes.iV.array;
    let n = 0;
    const push = (x, z, g, h, w, fx, fz, r, gg, b, v) => {
      if (n >= MAXD) return;
      const o = n * 4;
      aP[o] = x; aP[o + 1] = z; aP[o + 2] = g; aP[o + 3] = h;
      aS[o] = w; aS[o + 1] = 0.3; aS[o + 2] = fx; aS[o + 3] = fz;
      aC[o] = r; aC[o + 1] = gg; aC[o + 2] = b; aC[o + 3] = 0;
      aV[n] = v;
      n++;
    };
    const one = (c) => {
      const dx = c.x - cam.x, dz = c.y - cam.z;
      if (dx * dx + dz * dz > 520 * 520 || n + 4 > MAXD) return;
      const t = CARTYPES[c.type] || CARTYPES.sedan, ca = Math.cos(c.a), sa = Math.sin(c.a);
      const g = heightAt(c.x, c.y);
      const v = los(cam.x, cam.y, cam.z, c.x, g + 2, c.y) ? 1 : 0;
      if (!v) return;
      const fh = t.l / 2 - 0.2, lat = Math.max(0, t.w / 2 - 0.8);
      const brk = c.brakeL ? 2.0 : 0.85;
      if (c.type === 'bike') {
        push(c.x + ca * fh, c.y + sa * fh, g, 2.3, 0.35, ca, sa, 1.9, 1.75, 1.5, v);
        push(c.x - ca * fh, c.y - sa * fh, g, 2.0, 0.3, -ca, -sa, brk, brk * 0.1, brk * 0.05, v);
        return;
      }
      for (const s of [-1, 1]) {
        const ox = -sa * lat * s, oz = ca * lat * s;
        push(c.x + ca * fh + ox, c.y + sa * fh + oz, g, 1.9, 0.45, ca, sa, 2.1, 1.95, 1.7, v);
        push(c.x - ca * fh + ox, c.y - sa * fh + oz, g, 2.2, 0.4, -ca, -sa, brk, brk * 0.1, brk * 0.05, v);
      }
    };
    for (const c of traffic) one(c);
    for (const c of polices) one(c);
    if (S.mode === 'car' && S.pcar) one(S.pcar);
    dgeo.instanceCount = n;
    for (const nm of ['iP', 'iS', 'iC', 'iV']) { const a = dgeo.attributes[nm]; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
  }
  function update(dt) {
    if (!mesh) return;
    const night = clamp(1 - G3.day * 1.6, 0, 1);
    const w0 = clamp((G3.wet - 0.05) / 0.55, 0, 1), wk = w0 * w0 * (3 - 2 * w0);
    const I = night * wk;
    UNI.uInt.value = I;
    const on = I > 0.004 && !G3.reflOff;
    mesh.visible = dmesh.visible = on;
    if (!on) { lastX = 1e9; return; }
    const cam = G3.camera.position;
    UNI.uCamG.value = heightAt(cam.x, cam.z);
    UNI.uTime.value = (UNI.uTime.value + dt) % 600;
    const fog = G3.scene.fog;
    if (fog) { UNI.uFogN.value = fog.near; UNI.uFogF.value = fog.far; }
    UNI.uSig0.value.set(sigCol(0)); UNI.uSig1.value.set(sigCol(1));
    candT -= dt;
    if (candT <= 0 || Math.abs(cam.x - lastX) + Math.abs(cam.z - lastZ) > 50) { candT = 0.5; lastX = cam.x; lastZ = cam.z; gather(cam.x, cam.z); }
    // 見通しは 1 フレームに 150 本まで（新しく候補に入ったものは即時）
    const nc = cand.length;
    for (let s = 0; s < Math.min(150, nc); s++) {
      const k = cand[(rr + s) % nc];
      visT[k] = los(cam.x, cam.y, cam.z, SP[k * 4], SP[k * 4 + 2] + SP[k * 4 + 3], SP[k * 4 + 1]) ? 1 : 0;
    }
    rr = nc ? (rr + 150) % nc : 0;
    const a = Math.min(1, dt * 6);
    for (const k of cand) {
      if (visT[k] < 0) { visT[k] = los(cam.x, cam.y, cam.z, SP[k * 4], SP[k * 4 + 2] + SP[k * 4 + 3], SP[k * 4 + 1]) ? 1 : 0; vis[k] = visT[k]; }
      else vis[k] += (visT[k] - vis[k]) * a;
    }
    attrV.needsUpdate = true;
    carLights(cam);
  }
  return { add, lamp, lamps: LAMPS3, paved, build, update, los, mask: () => UNI.uMask.value, maskK: () => UNI.uMaskK.value,
    stats: () => ({ ns, cand: cand.length, cars: dgeo ? dgeo.instanceCount : 0 }) };
})();
