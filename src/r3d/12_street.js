'use strict';
/* =========================================================
   街のこまごまとした街具（street.glb）
   Googleストリートビューで見た松山の街角を参考に、地区ごとに配置する。
   乱数は独立したシードを使う（建物配置の乱数列には触れない）。
   座標: 道路のオフセット o は n=(-sin a, cos a) 方向が正（10_world の L 側）。
   ========================================================= */
G3.street = (function () {
  const THREE = G3.THREE;
  const U = G3.U;
  const TAU = Math.PI * 2;
  const stats = {};
  let lists = {};

  /* ---------- 地区 ---------- */
  function zoneOf(x, y) {
    if (hyp(x - 7400, y - 2300) < 480) return 'dogo';
    if (x > 5400 && x < 6950 && y > 2180 && y < 3720) return 'center';
    if (x > 4560 && x < 5400 && y > 2880 && y < 3200) return 'center';
    if (x < 1700 && y < 2050) return 'port';
    return 'suburb';
  }

  /* ---------- 道路上の位置 ---------- */
  function at(r, d, o) {
    const p = plAt(r.pl, clamp(d, 0, r.pl.len));
    const nx = -Math.sin(p.a), ny = Math.cos(p.a);
    return { x: p.x + nx * o, y: p.y + ny * o, a: p.a };
  }
  // 当たり判定（Blender の m 単位・モデル座標）: [cx, cy, hx, hy, m] は回転箱、[cx, cy, r, m] は円。m: 1=歩行者 2=車 3=両方
  const POLE = [[0, 0, 0.06, 3]];
  const COLL = {
    guard_pipe: [[1.0, 0, 1.0, 0.06, 3]], guardrail: [[2.0, -0.08, 2.0, 0.12, 3]], bollard: [[0, 0, 0.08, 2]], end_marker: [[0, 0, 0.07, 2]],
    hedge_planter: [[1.5, 0, 1.5, 0.5, 3]], sign_stop: POLE, sign_speed: POLE, sign_noparking: POLE, sign_pedonly: POLE, sign_crosswalk: POLE,
    curve_mirror: POLE, hydrant_sign: POLE, hydrant: [[0, 0, 0.16, 3]], tram_stop: [[0, 0, 6.0, 0.8, 2]], post_round: [[0, 0, 0.25, 3]], post_square: [[0, 0, 0.21, 0.28, 3]],
    phone_booth: [[0, 0, 0.46, 0.46, 3]], bicycle_a: [[0.05, 0, 0.88, 0.2, 3]], bicycle_b: [[0.05, 0, 0.88, 0.2, 3]], bicycle_c: [[0.05, 0, 0.88, 0.2, 3]],
    bike_rack: [[1.5, 0, 1.8, 0.4, 3]], recycle_box: [[0, 0, 0.21, 0.46, 3]], utility_box: [[0, 0, 0.3, 0.62, 3]], bench: [[-0.08, 0, 0.3, 0.85, 3]],
    map_board: [[0, 0, 0.12, 1.0, 3]], planter_box: [[0, 0, 0.6, 0.25, 3]], parking_sign: [[0, 0, 0.08, 3], [0.9, 0, 0.2, 0.23, 3]],
    car_stop: [[0, 0, 0.08, 0.6, 2]], xlamp: [[0, 0, 0.16, 3]], xpole: [[0, 0, 0.2, 3]], clock_pole: [[0, 0, 0.22, 3]], stand_sign: [[0, 0, 0.25, 3]], iron_fence: [[1.0, 0, 1.0, 0.05, 3]],
    stone_lantern: [[0, 0, 0.42, 3]], karakuri_clock: [[0, 0, 1.7, 3]], block_wall: [[1.0, 0, 1.0, 0.1, 3]], propane: [[0, 0, 0.2, 0.42, 3]],
    ac_unit: [[0, 0, 0.17, 0.42, 3]], gomi_station: [[0, 0, 0.5, 0.9, 3]], mooring_bollard: [[0, 0, 0.3, 3]], potted_plant: [[0, 0, 0.22, 3]],
    container_a: [[0, 0, 3.03, 1.22, 3]], container_b: [[0, 0, 3.03, 1.22, 3]], container_c: [[0, 0, 3.03, 1.22, 3]], container_d: [[0, 0, 3.03, 1.22, 3]],
    wcont_a: [[0, 0, 3.03, 1.22, 3]], wcont_b: [[0, 0, 3.03, 1.22, 3]], wcont_c: [[0, 0, 3.03, 1.22, 3]],
    crossing_post: [[0, 0, 0.12, 3], [0, -0.5, 0.2, 0.2, 3]], catenary_pole: [[0, 0, 0.18, 3]], slide: [[-0.4, 0, 1.4, 0.45, 3]],
    swing: [[0, -1.3, 0.45, 0.06, 3], [0, 1.3, 0.45, 0.06, 3]], jungle_gym: [[0, 0, 0.92, 0.92, 3]], park_toilet: [[0, 0, 1.55, 2.05, 3]],
    park_lamp: [[0, 0, 0.08, 3]], fountain: [[0, 0, 0.3, 3]], gs_pump: [[0, 0, 1.8, 0.5, 3]], gs_sign: [[0, 0, 0.25, 0.25, 3]],
    gs_office: [[0, 0, 2.5, 3.5, 3]], traffic_cone: [[0, 0, 0.18, 3]], barricade: [[0, 0, 0.9, 0.2, 3]], koji_sign: [[0, 0, 0.2, 0.36, 3]],
    bus_shelter: [[-0.7, 0, 0.05, 2.0, 3], [-0.15, -1.95, 0.6, 0.05, 3], [-0.15, 1.95, 0.6, 0.05, 3]],
    konbini: [[0, 0, 6.0, 9.0, 3]], konbini_sign: [[0, 0, 0.2, 0.2, 3]], farm_hut: [[0, 0, 1.5, 2.0, 3]], taxi_sign: [[0, 0, 0.06, 3]],
    soccer_goal: [[0, -3.66, 0.08, 3], [0, 3.66, 0.08, 3]],
    nobori_a: [[0, 0, 0.16, 3]], nobori_b: [[0, 0, 0.16, 3]], nobori_c: [[0, 0, 0.16, 3]], nobori_d: [[0, 0, 0.16, 3]], nobori_e: [[0, 0, 0.16, 3]],
  };
  // 車でぶつかると倒れる物（値 = 壊れるのに必要な車速）
  const BREAK = { xlamp: 95, sign_stop: 40, sign_speed: 40, sign_noparking: 40, sign_pedonly: 40, sign_crosswalk: 40, curve_mirror: 40, hydrant_sign: 40,
    guard_pipe: 55, end_marker: 30, traffic_cone: 10, barricade: 20, koji_sign: 20, stand_sign: 15, nobori_a: 15, nobori_b: 15, nobori_c: 15,
    nobori_d: 15, nobori_e: 15, bicycle_a: 20, bicycle_b: 20, bicycle_c: 20, bench: 70, recycle_box: 40, post_square: 90, post_round: 90,
    planter_box: 70, potted_plant: 20, park_lamp: 80, taxi_sign: 40, iron_fence: 70, car_stop: 60, hydrant: 70, map_board: 90, parking_sign: 120 };
  /* ---------- 見た目どおりの当たり判定 ----------
     モデルの「体の高さ」(0.3〜1.9m) にある面を 8cm の格子に焼き、長方形の集まりにする。
     ベンチの座面・自転車・柵・祠・看板の脚・ガソリンスタンドの柱などが形どおりに当たる。
     布や頭上の物（暖簾・提灯・のぼりの旗・日よけ）はGTAと同じく通り抜けられる */
  const SOFT = new Set(['noren', 'chochin', 'awning_red', 'awning_green', 'awning_blue', 'awning_orange', 'solar_panel', 'tv_antenna', 'tetrapod',
    'nobori_a', 'nobori_b', 'nobori_c', 'nobori_d', 'nobori_e', 'backstop', 'jib_crane', 'lighthouse_red', 'lighthouse_white', 'fishing_boat', 'weed_a', 'weed_b']);
  const baked = {};
  function bakeShape(name) {
    if (name in baked) return baked[name];
    const node = NODE_ALIAS[name] ? G3.glbNode(...NODE_ALIAS[name]) : G3.glbNode('street', name);
    if (!node || SOFT.has(name)) return (baked[name] = null);
    node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const CELL = 0.08, LO = 0.3, HI = 1.9, cells = new Set();
    const mark = (x, z) => cells.add(Math.floor(x / CELL) + ':' + Math.floor(-z / CELL));   // Blender (X, Y) = (x, -z)
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const clip = (poly, h, keepAbove) => {   // y=h の平面で切る
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length];
        const ina = keepAbove ? a[1] >= h : a[1] <= h, inb = keepAbove ? b[1] >= h : b[1] <= h;
        if (ina) out.push(a);
        if (ina !== inb) { const t = (h - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, h, a[2] + (b[2] - a[2]) * t]); }
      }
      return out;
    };
    node.traverse(m => {
      if (!m.isMesh || !m.geometry) return;
      const rel = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      const pos = m.geometry.attributes.position, idx = m.geometry.index, n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        for (let k = 0; k < 3; k++) P[k].fromBufferAttribute(pos, idx ? idx.getX(t + k) : t + k).applyMatrix4(rel);
        if (Math.max(P[0].y, P[1].y, P[2].y) < LO || Math.min(P[0].y, P[1].y, P[2].y) > HI) continue;
        const poly = clip(clip(P.map(v => [v.x, v.y, v.z]), LO, true), HI, false);
        if (poly.length < 2) continue;
        // 辺（縦の壁は線になる）
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[2] - a[2]), st = Math.max(1, Math.ceil(L / (CELL * 0.5)));
          for (let j = 0; j <= st; j++) mark(a[0] + (b[0] - a[0]) * j / st, a[2] + (b[2] - a[2]) * j / st);
        }
        // 面（座面など水平に近い面）
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const v of poly) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); }
        if ((x1 - x0) > CELL && (z1 - z0) > CELL) {
          for (let x = Math.floor(x0 / CELL) * CELL + CELL / 2; x < x1; x += CELL) for (let z = Math.floor(z0 / CELL) * CELL + CELL / 2; z < z1; z += CELL) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const a = poly[i], b = poly[j];
              if ((a[2] > z) !== (b[2] > z) && x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]) inside = !inside;
            }
            if (inside) mark(x, z);
          }
        }
      }
    });
    if (!cells.size) return (baked[name] = null);
    // 連結した塊ごとに、詰まっていなければ長い方向で分けて長方形にする
    const set = cells, seen = new Set(), comps = [];
    for (const key of cells) {
      if (seen.has(key)) continue;
      const [ix, iy] = key.split(':').map(Number), comp = [], st = [[ix, iy]]; seen.add(key);
      while (st.length) {
        const [a, b] = st.pop(); comp.push([a, b]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k2 = (a + dx) + ':' + (b + dy); if (set.has(k2) && !seen.has(k2)) { seen.add(k2); st.push([a + dx, b + dy]); } }
      }
      comps.push(comp);
    }
    const bbox = cs => { let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9; for (const [a, b] of cs) { a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); } return [a0, a1, b0, b1]; };
    const boxes = [];
    const split = (cs, depth) => {
      const [a0, a1, b0, b1] = bbox(cs), w = a1 - a0 + 1, h = b1 - b0 + 1;
      if (cs.length / (w * h) >= 0.55 || w * h <= 6 || depth > 6) { boxes.push([a0, a1, b0, b1]); return; }
      const byA = w >= h, mid = byA ? (a0 + a1) / 2 : (b0 + b1) / 2;
      const L = cs.filter(c => (byA ? c[0] : c[1]) <= mid), R = cs.filter(c => (byA ? c[0] : c[1]) > mid);
      if (!L.length || !R.length) { boxes.push([a0, a1, b0, b1]); return; }
      split(L, depth + 1); split(R, depth + 1);
    };
    for (const c of comps) split(c, 0);
    const out = boxes.length > 24 ? comps.map(bbox) : boxes;   // 箱が多すぎる物は塊ごとの外接長方形
    return (baked[name] = out.map(([a0, a1, b0, b1]) => [(a0 + a1 + 1) / 2 * CELL, (b0 + b1 + 1) / 2 * CELL, (a1 - a0 + 1) / 2 * CELL, (b1 - b0 + 1) / 2 * CELL, 3]));
  }
  G3.bakeShape = bakeShape;
  function collide(name, x, y, rot, lift) {
    const cs = bakeShape(name) || COLL[name];
    if (!cs || lift > 1.5 || typeof addCollider !== 'function') return;
    const brk = BREAK[name], bid = name + '#' + (lists[name].length - 1);
    const al = -rot, ca = Math.cos(al), sa = Math.sin(al);
    for (const c of cs) {
      // Blender +X → (cos, sin)、+Y → (sin, -cos)
      const wx = x + U * (c[0] * ca + c[1] * sa), wy = y + U * (c[0] * sa - c[1] * ca);
      if (c.length === 4) addCollider({ x: wx, y: wy, r: c[2] * U, m: c[3], brk, bid });
      else addCollider({ x: wx, y: wy, hx: c[2] * U, hy: Math.max(0.3, c[3] * U), a: al, m: c[4], brk, bid });
    }
  }
  const putM = (name, M) => { (lists[name] || (lists[name] = [])).push(M); };
  // 人が座る・立ち止まる場所（モデル座標 m）: [姿勢, x, y, 床の高さ(座面), 向きの追加角(度)]
  const AMBSPOT = {
    bench: [['sit', -0.12, -0.45, 0.46, 0], ['sit', -0.12, 0.45, 0.46, 0]],
    bus_shelter: [['sit', -0.5, -0.9, 0.47, 0], ['sit', -0.5, -0.1, 0.47, 0], ['stand', 0.5, 1.2, 0, 0]],
    tram_stop: [['stand', -3.5, 0.15, 0.22, -90], ['stand', 1.5, 0.2, 0.22, -90], ['stand', 3.9, 0.1, 0.22, -90], ['sit', -0.3, -0.62, 0.69, 90]],
    platform: [['stand', -8, 0.3, 0.9, -90], ['stand', -1.5, 0.2, 0.9, -90], ['stand', 5, 0.35, 0.9, -90], ['sit', -3.2, -0.98, 1.37, -90], ['sit', -2.6, -0.98, 1.37, -90]],
    konbini: [['stand', 7.0, -2.0, 0, 180], ['stand', 7.3, 3.0, 0, 20]],
    taxi_sign: [['stand', 0.7, 0.6, 0, 0]],
    map_board: [['stand', 1.3, 0.3, 0, 180]],
    small_shrine: [['stand', 1.6, 0.2, 0, 180]],
    phone_booth: [['stand', 0.0, 0.0, 0.08, 180]],
  };
  const amb = [];
  function ambSpots(name, x, y, rot, lift) {
    const sp = AMBSPOT[name];
    if (!sp) return;
    const al = -rot, ca = Math.cos(al), sa = Math.sin(al);
    for (const [pose, lx, ly, hs, da] of sp) {
      const wx = x + U * (lx * ca + ly * sa), wy = y + U * (lx * sa - ly * ca);
      const base = heightAt(x, y) + lift;
      amb.push({ x: wx, y: wy, a: al + da * Math.PI / 180, pose, h: base + U * (pose === 'sit' ? hs - 0.72 : hs) });
    }
  }
  const put = (name, x, y, rot, lift = 0, s = 1) => {
    const L = lists[name] || (lists[name] = []), M = G3.M4(x, heightAt(x, y) + lift, y, rot, U * s);
    M.__i = L.length;
    L.push(M);
    collide(name, x, y, rot, lift);
    ambSpots(name, x, y, rot, lift);
  };
  // 歩道上（縁石の高さ）に置く
  const onWalk = (name, x, y, rot, s) => put(name, x, y, rot, G3.CURB, s);
  // 進行方向 a の車線の左側（日本は左側通行 → o<0 側）に立つ標識の向き: 正面(+X)を対向（-a）へ
  const faceRot = ang => -ang;

  // 近くにすでに何か置いたか（簡易の占有グリッド）
  const occ = new Map();
  const okey = (x, y) => ((x / 12) | 0) + ',' + ((y / 12) | 0);
  function free(x, y, r = 6) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const a = occ.get(((x / 12 | 0) + i) + ',' + ((y / 12 | 0) + j));
      if (a) for (const p of a) if (hyp(p[0] - x, p[1] - y) < r + p[2]) return false;
    }
    return true;
  }
  function take(x, y, r = 3) {
    const k = okey(x, y);
    (occ.get(k) || occ.set(k, []).get(k)).push([x, y, r]);
  }
  const KEYPTS = [];
  function seedOcc() {
    KEYPTS.length = 0;
    for (const m of MIKANS) KEYPTS.push([m.x, m.y]);
    for (const g of GIGSPOTS) KEYPTS.push([g[1], g[2]]);
    for (const m of MISSIONS) { KEYPTS.push(m.start); if (m.goal) KEYPTS.push(m.goal); for (const c of m.cps || []) KEYPTS.push(c); }
    for (const l of LAMPS) take(l[0], l[1], 3);
    for (const p of POLES) take(p.x, p.y, 3);
    for (const v of VENDING) take(v.x, v.y, 4);
    for (const b of BUSSTOPS) take(b[0], b[1], 8);
    for (const s of SIGNALS) take(s.x, s.y, 3);
    // ゲーム上の大事な地点（みかん・ギグ・ミッション）は空けておく
    for (const k of KEYPTS) take(k[0], k[1], 7);
    for (const r of ROADS) if (r.kind === 'lane') for (let d = 0; d <= r.pl.len; d += 6) { const p = plAt(r.pl, d); take(p.x, p.y, r.w / 2 - 0.5); }
    // 追加ランドマークの石段・参道の前（歩道の柵や街具で入口を塞がない）
    for (const l of LMS) if (l.ex) for (let x = l.ex[0] - 12; x <= l.ex[2] + 12; x += 4) for (let y = l.ex[1] - 12; y <= l.ex[3] + 12; y += 4) take(x, y, 3);
    // 河川敷の桜と遊歩道
    if (typeof RIVERSIDE !== 'undefined') {
      for (const t of RIVERSIDE.sakura) take(t[0], t[1], 2);
      for (const w of RIVERSIDE.walks) { const rv = RIVERS[w.ri]; for (let d = w.d0; d <= w.d1; d += 5) { const p = plAt(rv.pl, d), o = w.sg * (rv.w / 2 + 9); take(p.x - Math.sin(p.a) * o, p.y + Math.cos(p.a) * o, 2.5); } }
    }
    // 用水路の上と縁には物を置かない
    if (typeof CANALS !== 'undefined') for (const cn of CANALS) for (let t = cn.t0; t <= cn.t1; t += 4) take(cn.vert ? cn.c : t, cn.vert ? t : cn.c, CANAL_W / 2 + 1);
  }
  // 建物（bldGrid）と、3D時に bldGrid から外したランドマークの敷地（LMS.solid）の両方を見る
  const nearBld = (x, y, m) => {
    gridNear(bldGrid, x, y, _ov);
    for (const b of _ov) if (x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m) return true;
    for (const l of LMS) { const s2 = l.solid; if (s2 && x > s2[0] - m && x < s2[2] + m && y > s2[1] - m && y < s2[3] + m) return true; }
    return false;
  };

  /* ---------- 第1段: 道路端の柵・植え込み・車止め ---------- */
  const HEDGE_ROADS = new Set(['平和通り', '花園町通り', '千舟町通り', '空港通り', '大手町通り']);
  function roadEdges() {
    const rr = mulberry32(5101);
    for (const r of ROADS) {
      if (r.kind === 'arcade' || r.kind === 'lane') continue;
      const cuts = G3.roadCuts(r);
      for (const [sg, cl] of [[1, cuts.cutsL], [-1, cuts.cutsR]]) {
        const ivs = G3.minusIntervals(r.pl.len, cl);
        for (const [a, b] of ivs) {
          if (b - a < 24) continue;
          const mid = at(r, (a + b) / 2, sg * (r.w / 2 + 3));
          const z = zoneOf(mid.x, mid.y);
          const rot = d => -(at(r, d, 0).a + (sg > 0 ? Math.PI : 0));
          // L側(sg>0)は +X を逆向きに置くので、区間の終点側を原点にする
          const lay = (name, len, o, d0, d1, lift = G3.CURB, gapEvery = 0, gap = 0) => {
            let run = 0;
            for (let d = d0; d + len <= d1; d += len) {
              if (gapEvery && run >= gapEvery) { run = 0; d += gap; if (d + len > d1) break; }
              const dd = sg > 0 ? d + len : d;
              const p = at(r, dd, sg * o);
              const c = at(r, d + len / 2, sg * o);
              if (!free(c.x, c.y, 2)) { run = 0; continue; }
              put(name, p.x, p.y, rot(d + len / 2), lift);
              run++;
            }
          };
          const edge = r.w / 2;
          if (r.kind === 'main' && (z === 'center' || z === 'dogo')) {
            if (HEDGE_ROADS.has(r.n)) {
              lay('hedge_planter', 7.5, edge + 1.7, a + 6, b - 6, G3.CURB, 5, 9);
            } else {
              lay('guard_pipe', 5, edge + 1.0, a + 4, b - 4, G3.CURB, 14, 8);
            }
            // 歩道の入口に車止め（ステンレスのボラード）
            for (const d of [a + 2.5, b - 2.5]) {
              for (const k of [1.6, 3.5, 5.4]) {
                const p = at(r, d, sg * (edge + k));
                put('bollard', p.x, p.y, 0, G3.CURB);
              }
            }
          } else if (r.kind === 'main' && z === 'suburb') {
            // 郊外の幹線: 区間ごとにガードレール
            const L = 10;
            for (let d = a + 8; d < b - 40; ) {
              const runLen = (6 + (rr() * 10 | 0)) * L;
              const end = Math.min(b - 8, d + runLen);
              if (rr() < 0.55) {
                lay('guardrail', L, edge + 0.9, d, end, G3.CURB);
                const p0 = at(r, d - 1, sg * (edge + 0.9)), p1 = at(r, end + 1, sg * (edge + 0.9));
                put('end_marker', p0.x, p0.y, 0, G3.CURB);
                put('end_marker', p1.x, p1.y, 0, G3.CURB);
              }
              d = end + 30 + rr() * 60;
            }
          } else if (r.kind === 'minor' && z === 'center' && rr() < 0.5) {
            lay('guard_pipe', 5, edge + 0.9, a + 4, b - 4, G3.CURB, 8, 10);
          }
        }
      }
    }
  }

  /* ---------- 第1段: 道路標識 ---------- */
  function signs() {
    const rr = mulberry32(5102);
    for (const r of ROADS) {
      if (r.kind === 'arcade') continue;
      const edge = r.w / 2 + 1.4;
      // 一時停止: 生活道路が幹線へ出る手前
      if (r.kind === 'minor') {
        for (const j of r.junc) {
          if (j.road.kind !== 'main') continue;
          const back = j.road.w / 2 + G3.SW + 6;
          for (const dir of [1, -1]) {
            const d = j.d - dir * back;
            if (d < 4 || d > r.pl.len - 4) continue;
            const p = at(r, d, -dir * edge);
            if (!free(p.x, p.y, 3)) continue;
            put('sign_stop', p.x, p.y, faceRot(p.a + (dir > 0 ? Math.PI : 0)), G3.CURB);
            take(p.x, p.y, 2);
          }
        }
        // 駐車禁止（中心部）・郊外の速度標識
        for (let d = 90; d < r.pl.len - 60; d += 330 + rr() * 120) {
          const dir = rr() < 0.5 ? 1 : -1;
          const p = at(r, d, -dir * edge);
          if (!free(p.x, p.y, 4)) continue;
          const z = zoneOf(p.x, p.y);
          put(z === 'suburb' ? 'sign_speed' : 'sign_noparking', p.x, p.y, faceRot(p.a + (dir > 0 ? Math.PI : 0)), G3.CURB);
          take(p.x, p.y, 2);
        }
      } else {
        // 幹線: 最高速度40（区間ごとに双方向）
        for (let d = 160; d < r.pl.len - 100; d += 620 + rr() * 200) {
          for (const dir of [1, -1]) {
            const p = at(r, d + dir * 20, -dir * edge);
            if (!free(p.x, p.y, 4)) continue;
            put('sign_speed', p.x, p.y, faceRot(p.a + (dir > 0 ? Math.PI : 0)), G3.CURB);
            take(p.x, p.y, 2);
          }
        }
      }
    }
    // 横断歩道の標識（歩道の両端・両面）
    for (const c of CROSSWALKS) {
      const nx = -Math.sin(c[2]), ny = Math.cos(c[2]);
      for (const s of [1, -1]) {
        const off = c[3] / 2 + 1.4;
        const x = c[0] + nx * s * off + Math.cos(c[2]) * 5 * s, y = c[1] + ny * s * off + Math.sin(c[2]) * 5 * s;
        put('sign_crosswalk', x, y, -c[2], G3.CURB);
        take(x, y, 2);
      }
    }
    // 商店街の入口: 歩行者専用
    for (const r of ROADS) {
      if (r.kind !== 'arcade') continue;
      for (const [d, f] of [[3, Math.PI], [r.pl.len - 3, 0]]) {
        const p = at(r, d, r.w / 2 - 1.5);
        put('sign_pedonly', p.x, p.y, faceRot(p.a + f), 0.12);
      }
    }
    // カーブミラー: 郊外・生活道路の交差点の角
    for (const r of ROADS) {
      if (r.kind !== 'minor') continue;
      for (const j of r.junc) {
        if (j.road.kind === 'arcade') continue;
        const pj = at(r, j.d, 0);
        if (zoneOf(pj.x, pj.y) !== 'suburb' && zoneOf(pj.x, pj.y) !== 'port') continue;
        const s = rr() < 0.5 ? 1 : -1;
        const back = j.road.w / 2 + G3.SW + 3;
        const d = j.d - s * back;
        if (d < 2 || d > r.pl.len - 2) continue;
        const p = at(r, d, (rr() < 0.5 ? 1 : -1) * (r.w / 2 + 1.2));
        if (!free(p.x, p.y, 3)) continue;
        put('curve_mirror', p.x, p.y, -Math.atan2(pj.y - p.y, pj.x - p.x), G3.CURB);
        take(p.x, p.y, 2);
      }
    }
  }

  /* ---------- 第1段: 方面案内標識（青看板） ---------- */
  const DEST = [['道後', 7400, 2250], ['松山駅', 4740, 2985], ['市駅', 5868, 3620], ['松山空港', 1000, 4450], ['三津浜', 1100, 1750],
    ['観光港', 1330, 700], ['今治', 7000, 120], ['大洲', 2800, 5700], ['砥部', 6000, 5700], ['東温', 8500, 3430], ['伊予', 600, 5100],
    ['堀江', 4482, 300], ['石手', 8500, 2600], ['大街道', 6230, 3300], ['県庁', 5940, 3115], ['平和通', 5900, 2258], ['余戸', 4300, 4200],
    ['奥道後', 7820, 140], ['松山城', 5834, 2900], ['高浜', 1082, 850], ['梅津寺', 1150, 980], ['衣山', 4200, 2600]];
  function destFor(x0, y0, ex, ey) {
    let best = null, bd = 1e9;
    for (const d of DEST) {
      if (hyp(d[1] - x0, d[2] - y0) < 180) continue;
      const k = hyp(d[1] - ex, d[2] - ey);
      if (k < bd) { bd = k; best = d[0]; }
    }
    return best;
  }
  const routeNo = r => { const m = /国道(\d+)/.exec(r.n) || (/R(\d+)/.exec(r.n)); return m ? m[1] : null; };
  function guideTexture(br) {
    const w = 512, h = 256;
    return G3.world.canvasTex(w, h, g => {
      g.fillStyle = '#0d4ea6'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f4f6f8'; g.lineWidth = 5;
      g.beginPath(); g.roundRect ? g.roundRect(8, 8, w - 16, h - 16, 14) : g.rect(8, 8, w - 16, h - 16); g.stroke();
      const cx = w / 2, cy = 150;
      g.fillStyle = '#f4f6f8'; g.strokeStyle = '#f4f6f8'; g.lineCap = 'butt';
      const arrow = (x1, y1, x2, y2, wd) => {
        g.lineWidth = wd; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        const a = Math.atan2(y2 - y1, x2 - x1), L = 26;
        g.beginPath(); g.moveTo(x2 + Math.cos(a) * L * 0.9, y2 + Math.sin(a) * L * 0.9);
        g.lineTo(x2 + Math.cos(a + 2.3) * L, y2 + Math.sin(a + 2.3) * L);
        g.lineTo(x2 + Math.cos(a - 2.3) * L, y2 + Math.sin(a - 2.3) * L); g.closePath(); g.fill();
      };
      g.lineWidth = 16; g.beginPath(); g.moveTo(cx, h - 22); g.lineTo(cx, cy); g.stroke();
      if (br.s) arrow(cx, cy, cx, 78, 16);
      if (br.l) arrow(cx, cy, 150, cy, 12);
      if (br.r) arrow(cx, cy, w - 150, cy, 12);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const font = sz => `bold ${sz}px "Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif`;
      const label = (t, x, y, maxW) => {
        let sz = 40; g.font = font(sz);
        while (g.measureText(t).width > maxW && sz > 22) { sz -= 2; g.font = font(sz); }
        g.fillStyle = '#f4f6f8'; g.fillText(t, x, y);
      };
      if (br.s) label(br.s, cx, 38, 220);
      if (br.l) label(br.l, 76, cy, 120);
      if (br.r) label(br.r, w - 76, cy, 120);
      // 国道番号（逆五角形の青白シールド）
      const shield = (no, x, y) => {
        g.fillStyle = '#f4f6f8';
        g.beginPath(); g.moveTo(x - 22, y - 20); g.lineTo(x + 22, y - 20); g.lineTo(x + 22, y + 6); g.lineTo(x, y + 22); g.lineTo(x - 22, y + 6); g.closePath(); g.fill();
        g.fillStyle = '#0d4ea6'; g.font = font(22); g.fillText(no, x, y - 1);
      };
      if (br.sNo && br.s) shield(br.sNo, cx + 140, 40);
      if (br.lNo && br.l) shield(br.lNo, 76, cy + 50);
      if (br.rNo && br.r) shield(br.rNo, w - 76, cy + 50);
    });
  }
  // 交差点から伸びる各方向の行き先（直進・左・右）
  function branches(r, j, dir, head) {
    const pj = at(r, j.d, 0);
    const cand = [];
    const addBr = (road, dFrom, sgn) => {
      const endD = sgn > 0 ? road.pl.len : 0;
      if (Math.abs(endD - dFrom) < 60) return;
      const q = plAt(road.pl, clamp(dFrom + sgn * 50, 0, road.pl.len));
      const e = at(road, endD, 0);
      cand.push({ ang: Math.atan2(q.y - pj.y, q.x - pj.x), name: destFor(pj.x, pj.y, e.x, e.y), no: routeNo(road) });
    };
    addBr(r, j.d, dir);
    for (const k of r.junc) if (Math.abs(k.d - j.d) < 40 && k.road.kind !== 'arcade') { addBr(k.road, k.od, 1); addBr(k.road, k.od, -1); }
    const br = {};
    const best = {};
    for (const c of cand) {
      const rel = Math.atan2(Math.sin(c.ang - head), Math.cos(c.ang - head));
      if (Math.abs(rel) > 2.5 || !c.name) continue;
      const slot = Math.abs(rel) < 0.6 ? 's' : rel > 0 ? 'r' : 'l';
      const err = Math.abs(Math.abs(rel) - (slot === 's' ? 0 : Math.PI / 2));
      if (!best[slot] || err < best[slot].err) best[slot] = { err, c };
    }
    for (const k in best) { br[k] = best[k].c.name; br[k + 'No'] = best[k].c.no; }
    return br;
  }
  function guideSigns(scene) {
    const node = G3.glbNode('street', 'guide_gantry');
    if (!node) return;
    const placed = [];
    let n = 0;
    for (const r of ROADS) {
      if (r.kind !== 'main') continue;
      for (const j of r.junc) {
        if (j.road.kind !== 'main') continue;
        for (const dir of [1, -1]) {
          const back = j.road.w / 2 + G3.SW + 62;
          const d = j.d - dir * back;
          if (d < 30 || d > r.pl.len - 30) continue;
          // 手前に別の交差点がある（短すぎる区間）は置かない
          if (r.junc.some(k => k !== j && Math.abs(k.d - d) < k.road.w / 2 + 24)) continue;
          const p = at(r, d, -dir * (r.w / 2 + 2.5));
          if (placed.some(q => hyp(q[0] - p.x, q[1] - p.y) < 120)) continue;
          const head = p.a + (dir > 0 ? 0 : Math.PI);
          const br = branches(r, j, dir, head);
          if (!br.s && !br.l && !br.r) continue;
          const g = node.clone(true);
          const tex = guideTexture(br);
          tex.flipY = false;   // glTF のUVは上下が逆
          tex.anisotropy = 8;
          tex.needsUpdate = true;
          const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.05 });
          g.traverse(c => {
            if (!c.isMesh) return;
            c.castShadow = true; c.receiveShadow = true;
            c.material = c.material.name === 'GuideFace' ? faceMat : G3.lmMat(c.material);
          });
          // アームは車道中央側（進行方向 head の右手 = +n 側 if dir>0）
          const armA = Math.atan2(Math.cos(p.a), -Math.sin(p.a)) + (dir > 0 ? 0 : Math.PI);
          g.position.set(p.x, heightAt(p.x, p.y) + G3.CURB, p.y);
          g.rotation.y = -armA;
          g.scale.setScalar(U);
          scene.add(g);
          placed.push([p.x, p.y]);
          take(p.x, p.y, 4);
          if (typeof addCollider === 'function') addCollider({ x: p.x, y: p.y, r: 0.8 });
          n++;
        }
      }
    }
    stats.guide_gantry = n;
  }

  /* ---------- 第1段: 電停（安全地帯） ---------- */
  function tramStops() {
    const seen = [];
    const add = (pl, d) => {
      const p = plAt(pl, d);
      if (seen.some(q => hyp(q[0] - p.x, q[1] - p.y) < 40)) return;
      seen.push([p.x, p.y]);
      for (const [sg, dd] of [[1, 42], [-1, -42]]) {
        const q = plAt(pl, clamp(d + dd, 16, pl.len - 16));
        const rq = roadInfo(q.x, q.y);
        if (!rq || rq.road.w < 42 || rq.d > 3) continue;
        const nx = -Math.sin(q.a), ny = Math.cos(q.a);
        const x = q.x + nx * sg * 5.2, y = q.y + ny * sg * 5.2;
        put('tram_stop', x, y, -(q.a + (sg > 0 ? 0 : Math.PI)), 0.04);
        take(x, y, 14);
      }
    };
    const t0 = TRAINS[0], t2 = TRAINS[2];
    if (t0 && t0.stops) for (const d of t0.stops) add(t0.pl, d);
    if (t2 && t2.stops) for (const d of t2.stops) add(t2.pl, d);
  }

  /* ---------- 第2段: 歩道の街具 ---------- */
  const faceTo = (x, y, tx, ty) => -Math.atan2(ty - y, tx - x);
  // 歩道（交差点で切った区間）上を一定間隔で歩くイテレータ
  function walkSpots(r, step, jitter, rr, fn) {
    const cuts = G3.roadCuts(r);
    for (const [sg, cl] of [[1, cuts.cutsL], [-1, cuts.cutsR]]) {
      for (const [a, b] of G3.minusIntervals(r.pl.len, cl)) {
        if (b - a < 16) continue;
        for (let d = a + 8 + rr() * step * 0.5; d < b - 8; d += step + (rr() - 0.5) * jitter) fn(sg, d);
      }
    }
  }
  const walkAt = (r, sg, d, k) => at(r, d, sg * (r.w / 2 + k));
  const roadFace = (r, sg, d, p) => { const c = at(r, d, 0); return faceTo(p.x, p.y, c.x, c.y); };
  function nudgeOffRoad(x, y, need = 6) {
    for (let i = 0; i < 12; i++) {
      const ri = roadInfo(x, y);
      if (!ri || ri.d > ri.road.w / 2 + G3.SW + need) return [x, y];
      const dx = x - ri.x, dy = y - ri.y, l = hyp(dx, dy) || 1;
      x += dx / l * 4; y += dy / l * 4;
    }
    return [x, y];
  }

  function furniture(scene) {
    const rr = mulberry32(5203);
    // 自販機の横に回収箱
    for (const v of VENDING) {
      const ri = roadInfo(v.x, v.y);
      if (!ri) continue;
      const th = Math.atan2(ri.y - v.y, ri.x - v.x);
      const x = v.x + Math.sin(th) * 2.3, y = v.y - Math.cos(th) * 2.3;
      if (!free(x, y, 1.5)) continue;
      onWalk('recycle_box', x, y, -th);
      take(x, y, 1.5);
    }
    for (const r of ROADS) {
      if (r.kind === 'arcade' || r.kind === 'lane') continue;
      // ポスト
      walkSpots(r, 520, 260, rr, (sg, d) => {
        const p = walkAt(r, sg, d, 2.0);
        if (!free(p.x, p.y, 3)) return;
        const z = zoneOf(p.x, p.y);
        const round = z === 'dogo' || z === 'port' || rr() < 0.18;
        onWalk(round ? 'post_round' : 'post_square', p.x, p.y, roadFace(r, sg, d, p));
        take(p.x, p.y, 2);
      });
      // 消火栓標識（縁石ぎわ）
      walkSpots(r, 460, 200, rr, (sg, d) => {
        const p = walkAt(r, sg, d, 0.8);
        if (!free(p.x, p.y, 3)) return;
        onWalk('hydrant_sign', p.x, p.y, -p.a);
        take(p.x, p.y, 1.5);
        if (rr() < 0.4) {
          const h = walkAt(r, sg, d + 3.2, 0.9);
          if (free(h.x, h.y, 1.5)) { onWalk('hydrant', h.x, h.y, -h.a); take(h.x, h.y, 1.2); }
        }
      });
      // 地上機器（中心部・郊外の幹線）
      if (r.kind === 'main' || zoneOf(at(r, r.pl.len / 2, 0).x, at(r, r.pl.len / 2, 0).y) === 'center') {
        walkSpots(r, 340, 200, rr, (sg, d) => {
          const p = walkAt(r, sg, d, 2.1);
          if (!free(p.x, p.y, 3.5)) return;
          onWalk('utility_box', p.x, p.y, roadFace(r, sg, d, p));
          take(p.x, p.y, 2.5);
        });
      }
      // 駐輪ラック（中心部の歩道）
      walkSpots(r, 300, 200, rr, (sg, d) => {
        const p0 = walkAt(r, sg, d, 0);
        if (zoneOf(p0.x, p0.y) !== 'center' && zoneOf(p0.x, p0.y) !== 'dogo') return;
        bikeRack(r, sg, d, 1 + (rr() < 0.3 ? 1 : 0), rr);
      });
    }
    // 駅前・商店街入口の大きな駐輪場
    for (const [x, y] of [[5868, 3600], [4760, 2990], [6244, 3125], [5925, 3590], [7395, 2350], [6210, 3480], [1210, 1520]]) {
      const ri = roadInfo(x, y);
      if (!ri) continue;
      const r = ri.road;
      if (r.kind === 'arcade' || r.kind === 'lane') continue;
      const d0 = dOnPl(r.pl, x, y);
      for (const sg of [1, -1]) for (const dd of [-34, 22]) bikeRack(r, sg, d0 + dd, 2, rr);
    }
    // 電話ボックス（中心部のバス停の近く・駅前）
    let nb = 0;
    for (const b of BUSSTOPS) {
      if (zoneOf(b[0], b[1]) === 'suburb' && rr() < 0.75) continue;
      const ri = roadInfo(b[0], b[1]);
      if (!ri) continue;
      const r = ri.road, d = dOnPl(r.pl, b[0], b[1]);
      const c = at(r, d, 0);
      const sg = ((b[0] - c.x) * -Math.sin(c.a) + (b[1] - c.y) * Math.cos(c.a)) > 0 ? 1 : -1;
      for (const dd of [12, -12, 20]) {
        const p = walkAt(r, sg, d + dd, 2.0);
        if (!free(p.x, p.y, 3)) continue;
        onWalk('phone_booth', p.x, p.y, roadFace(r, sg, d + dd, p));
        take(p.x, p.y, 2.5);
        nb++;
        break;
      }
    }
    // 公園のベンチ
    for (const pk of PARKS) {
      const n = pk.k === 'rect' ? 18 : 12;
      for (let i = 0, t = 0; i < n && t < 200; t++) {
        let x, y, cx, cy;
        if (pk.k === 'rect') { x = lerp(pk.x0 + 20, pk.x1 - 20, rr()); y = lerp(pk.y0 + 20, pk.y1 - 20, rr()); cx = (pk.x0 + pk.x1) / 2; cy = (pk.y0 + pk.y1) / 2; }
        else { const a = rr() * TAU, rd = pk.r * (0.35 + rr() * 0.5); x = pk.x + Math.cos(a) * rd; y = pk.y + Math.sin(a) * rd; cx = pk.x; cy = pk.y; }
        if (inWaterRaw(x, y) || hillAt(x, y) || nearBld(x, y, 6) || !free(x, y, 6)) continue;
        const ri = roadInfo(x, y);
        if (ri && ri.d < ri.road.w / 2 + G3.SW + 3) continue;
        put('bench', x, y, faceTo(x, y, cx, cy), 0);
        take(x, y, 3);
        i++;
      }
    }
    // 花園町通り・平和通りの歩道ベンチ
    for (const rn of ['花園町通り', '平和通り']) {
      const r = ROADS.find(q => q.n === rn);
      if (!r) continue;
      walkSpots(r, 70, 20, rr, (sg, d) => {
        const p = walkAt(r, sg, d, 2.1);
        if (!free(p.x, p.y, 3)) return;
        onWalk('bench', p.x, p.y, roadFace(r, sg, d, p));
        take(p.x, p.y, 2.5);
      });
    }
    // 商店街のプランター
    for (const r of ROADS) {
      if (r.kind !== 'arcade') continue;
      let k = 0;
      for (let d = 14; d < r.pl.len - 10; d += 26) {
        const sg = (k++ % 2) ? 1 : -1;
        const p = at(r, d, sg * (r.w / 2 - 2.4));
        put('planter_box', p.x, p.y, -p.a, 0.12);
        take(p.x, p.y, 2);
      }
    }
    // 観光案内板・時計塔（観光地・駅前広場）
    const spots = [[7372, 2352, 'map_board'], [7452, 2240, 'map_board'], [6300, 2990, 'map_board'], [5905, 3585, 'map_board'],
      [4700, 2960, 'map_board'], [8060, 2560, 'map_board'], [1060, 1730, 'map_board'], [1300, 720, 'map_board'], [5650, 3000, 'map_board'],
      [4700, 3060, 'clock_pole'], [5820, 3690, 'clock_pole'], [1290, 740, 'clock_pole']];
    for (const [sx, sy, nm] of spots) {
      const [x, y] = nudgeOffRoad(sx, sy, nm === 'clock_pole' ? 8 : 3);
      if (nearBld(x, y, 3)) continue;
      const ri = roadInfo(x, y);
      put(nm, x, y, ri ? faceTo(x, y, ri.x, ri.y) : 0, 0);
      take(x, y, 3);
    }
    parkingLots(scene, rr);
    stats.phone_booth = nb;
  }

  function bikeRack(r, sg, d, racks, rr) {
    const n = racks * 5, step = 1.7, len = n * step;
    const c = walkAt(r, sg, d + len / 2, 1.9);
    if (!free(c.x, c.y, len / 2 + 1)) return;
    for (let k = 0; k < n; k++) {
      if (rr() < 0.22) continue;
      const q = walkAt(r, sg, d + k * step, 1.9);
      // 進行方向に対して斜め45°前後（歩道の家具帯に収まる）
      const ba = q.a + (sg > 0 ? -1 : 1) * (0.78 + (rr() - 0.5) * 0.12);
      onWalk(['bicycle_a', 'bicycle_a', 'bicycle_b', 'bicycle_c'][(rr() * 4) | 0], q.x, q.y, -ba);
    }
    take(c.x, c.y, len / 2 + 1);
  }


  // コインパーキング（中心部の空き地）
  function parkingLots(scene, rr) {
    const gb = new G3.GB(false), gbL = new G3.GB(false);
    let n = 0;
    for (let t = 0; t < 900 && n < 12; t++) {
      const x = lerp(5450, 6900, rr()), y = lerp(2300, 3700, rr());
      const ri = roadInfo(x, y);
      if (!ri || ri.road.kind === 'arcade') continue;
      const r = ri.road;
      const d = dOnPl(r.pl, x, y);
      const c = at(r, d, 0);
      const sg = ((x - c.x) * -Math.sin(c.a) + (y - c.y) * Math.cos(c.a)) > 0 ? 1 : -1;
      const spaces = 3 + ((rr() * 3) | 0), W = spaces * 6.4 + 2, D = 14;
      const o0 = r.w / 2 + G3.SW + 1.5, o1 = o0 + D;
      const corners = [];
      for (const [dd, oo] of [[d, o0], [d + W, o0], [d + W, o1], [d, o1], [d + W / 2, (o0 + o1) / 2]]) corners.push(at(r, dd, sg * oo));
      if (d + W > r.pl.len - 20 || d < 20) continue;
      if (r.junc.some(j => Math.abs(j.d - (d + W / 2)) < j.road.w / 2 + W / 2 + 12)) continue;
      let bad = false;
      for (const q of corners) {
        if (nearBld(q.x, q.y, 3) || inWaterRaw(q.x, q.y) || inPark(q.x, q.y, 4) || hillAt(q.x, q.y) || !free(q.x, q.y, 5)) { bad = true; break; }
        const rq = roadInfo(q.x, q.y);
        if (rq && rq.road !== r && rq.d < rq.road.w / 2 + G3.SW + 2) { bad = true; break; }
      }
      if (!bad && KEYPTS.some(k => corners.some(q => hyp(k[0] - q.x, k[1] - q.y) < W * 0.6 + 8))) bad = true;
      if (!bad && parked.some(c => corners.some(q => hyp(c.x - q.x, c.y - q.y) < W * 0.6 + 6))) bad = true;
      if (bad) continue;
      const Y = (q) => heightAt(q.x, q.y) + 0.07;
      const P = corners;
      const quad = (g, a, b, cc, dd) => {
        const ux = b[0] - a[0], uz = b[2] - a[2], vx = dd[0] - a[0], vz = dd[2] - a[2];
        const ny = uz * vx - ux * vz;   // 上向き法線になる頂点順にそろえる
        g.quad(ny > 0 ? [a, b, cc, dd] : [a, dd, cc, b], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      };
      const V = q => [q.x, Y(q), q.y];
      quad(gb, V(P[0]), V(P[1]), V(P[2]), V(P[3]));
      // 白線（区画）と車止め
      for (let k = 0; k <= spaces; k++) {
        const dd = d + 1 + k * 6.4;
        const a = at(r, dd - 0.2, sg * (o0 + 1.5)), b = at(r, dd + 0.2, sg * (o0 + 1.5)), e = at(r, dd + 0.2, sg * (o1 - 0.8)), f = at(r, dd - 0.2, sg * (o1 - 0.8));
        const lift = q => [q.x, Y(q) + 0.02, q.y];
        quad(gbL, lift(a), lift(b), lift(e), lift(f));
        if (k < spaces) {
          const cs = at(r, dd + 3.2, sg * (o1 - 2.2));
          put('car_stop', cs.x, cs.y, -(cs.a + Math.PI / 2), 0.05);
          // 頭から入れて停めた車（乗って運転できる）
          if (rr() < 0.55 && typeof mkCar === 'function') {
            const cp = at(r, dd + 3.2, sg * (o0 + D * 0.5));
            const into = Math.atan2(cs.y - cp.y, cs.x - cp.x);
            parked.push(mkCar(cp.x, cp.y, into, ['sedan', 'kei', 'kei', 'minivan', 'taxi'][(rr() * 5) | 0]));
          }
        }
      }
      const sp = at(r, d - 0.5, sg * (o0 + 0.5));
      put('parking_sign', sp.x, sp.y, -sp.a, 0);
      for (const q of corners) take(q.x, q.y, 6);
      n++;
    }
    const lotMat = new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 });
    const lineMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -16 });
    if (n) { const m1 = gb.mesh(lotMat, false); const m2 = gbL.mesh(lineMat, false); m1.castShadow = m2.castShadow = false; scene.add(m1, m2); }
    stats.parking_lot = n;
  }

  /* ---------- 第3段: 建物まわり（店先・住宅・室外機） ---------- */
  function frontOf(b) {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const ri = roadInfo(cx, cy);
    if (!ri) return 0;
    const dx = ri.x - cx, dy = ri.y - cy;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
    return dy > 0 ? 2 : 0;
  }
  // 面 f の「壁上の点」(t: 0..1) と外向き法線
  function wallPt(b, f, t, out = 0) {
    const N = [[0, -1], [1, 0], [0, 1], [-1, 0]][f];
    let x, y;
    if (f === 0) { x = lerp(b.x0, b.x1, t); y = b.y0; }
    else if (f === 2) { x = lerp(b.x1, b.x0, t); y = b.y1; }
    else if (f === 1) { x = b.x1; y = lerp(b.y0, b.y1, t); }
    else { x = b.x0; y = lerp(b.y1, b.y0, t); }
    return { x: x + N[0] * out, y: y + N[1] * out, rot: -Math.atan2(N[1], N[0]), along: -Math.atan2(N[1], N[0]) - Math.PI / 2 };
  }
  const faceLen = (b, f) => (f % 2 === 0) ? b.x1 - b.x0 : b.y1 - b.y0;
  const AWN = { '#d43c3c': 'awning_red', '#3f8a52': 'awning_green', '#2456a8': 'awning_blue', '#e8a020': 'awning_orange', '#7a3ca8': 'awning_red' };
  const overlapsOther = (b, x, y, m) => {
    gridNear(bldGrid, x, y, _ov);
    for (const o of _ov) if (o !== b && x > o.x0 - m && x < o.x1 + m && y > o.y0 - m && y < o.y1 + m) return true;
    return false;
  };
  // ランドマーク（モデルの敷地）の近くか
  const nearLM = (x, y, m) => LMS.some(l => (l.solid ? (x > l.solid[0] - m && x < l.solid[2] + m && y > l.solid[1] - m && y < l.solid[3] + m) : hyp(l.x - x, l.y - y) < m));
  const clearOfRoad = (x, y, m) => { const ri = roadInfo(x, y); return !ri || ri.d > ri.road.w / 2 + (ri.road.kind === 'lane' ? 0.6 : G3.SW) + m; };

  function buildingDetails() {
    const rr = mulberry32(5304);
    for (const b of buildings) {
      if (b.noDraw) continue;
      const f = frontOf(b), len = faceLen(b, f);
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const z = zoneOf(cx, cy);
      if (b.sty === 'warehouse') { warehouseYard(b, f, rr); continue; }
      const shopFront = b.kind === 'shop' || (b.kind === 'office' && b.seed % 2 && b.hgt <= 4);
      if (shopFront) {
        if (z === 'dogo' || b.sty === 'machiya') {
          // 暖簾と提灯
          const w = wallPt(b, f, 0.5, 0.2);
          put('noren', w.x, w.y, w.rot, 0);
          for (const t of [0.5 - 4.5 / len, 0.5 + 4.5 / len]) {
            const q = wallPt(b, f, t, 1.6);
            put('chochin', q.x, q.y, 0, 6.8);
          }
        } else {
          const n = Math.max(1, Math.min(4, Math.floor((len - 4) / 8.5)));
          const kind = AWN[b.sg] || ['awning_red', 'awning_green', 'awning_blue', 'awning_orange'][b.seed % 4];
          for (let i = 0; i < n; i++) {
            const t = 0.5 + (i - (n - 1) / 2) * 8.2 / len;
            const w = wallPt(b, f, t, 0.1);
            put(kind, w.x, w.y, w.rot, 0);
          }
        }
        if (rr() < 0.55) {
          const q = wallPt(b, f, 0.5 + (rr() - 0.5) * 0.5, 4.2);
          if (clearOfRoad(q.x, q.y, 1) && free(q.x, q.y, 1.5)) { put('stand_sign', q.x, q.y, q.rot, 0); take(q.x, q.y, 1.2); }
        }
        if (rr() < 0.4) {
          const q = wallPt(b, f, rr() < 0.5 ? 0.12 : 0.88, 1.0);
          put('potted_plant', q.x, q.y, q.rot, 0);
        }
        if (rr() < 0.35 || z === 'dogo') {
          const q = wallPt(b, f, rr() < 0.5 ? 0.06 : 0.94, 3.0);
          const nb = z === 'dogo' ? ['nobori_c', 'nobori_b', 'nobori_a', 'nobori_d'] : ['nobori_e', 'nobori_a', 'nobori_d'];
          if (clearOfRoad(q.x, q.y, 1)) put(nb[(rr() * nb.length) | 0], q.x, q.y, q.along, 0);
        }
      }
      if (b.kind === 'house') {
        // 前庭のブロック塀（門の切れ目あり。町家は道に面して建つので塀なし）
        if (z !== 'center' && b.sty !== 'machiya' && rr() < 0.8) {
          const off = 4.2, ext = 2.5;
          const L = len + ext * 2, sec = 5;
          const gate = 0.3 + rr() * 0.4;
          for (let s0 = 0; s0 + sec <= L + 0.01; s0 += sec) {
            const tMid = (s0 + sec / 2 - ext) / len;
            if (Math.abs(tMid - gate) * len < 4.5) continue;
            const a = wallPt(b, f, (s0 - ext) / len, off), e = wallPt(b, f, (s0 + sec - ext) / len, off);
            if (!clearOfRoad(a.x, a.y, 0.6) || !clearOfRoad(e.x, e.y, 0.6)) continue;
            if (overlapsOther(b, a.x, a.y, 1) || overlapsOther(b, e.x, e.y, 1)) continue;
            put('block_wall', a.x, a.y, a.along, 0);
          }
        }
        if (rr() < 0.4) {
          const q = wallPt(b, f, rr() < 0.5 ? 0.15 : 0.85, 0.9);
          put('potted_plant', q.x, q.y, q.rot, 0);
        }
        // 側面: LPガスと室外機
        const sf = (f + (rr() < 0.5 ? 1 : 3)) % 4;
        if (rr() < 0.55) { const q = wallPt(b, sf, 0.3 + rr() * 0.2, 0.9); put('propane', q.x, q.y, q.rot, 0); }
        const q2 = wallPt(b, (f + 2) % 4, 0.25 + rr() * 0.5, 1.0);
        put('ac_unit', q2.x, q2.y, q2.rot, 0);
        if (rr() < 0.5) { const q3 = wallPt(b, sf, 0.7 + rr() * 0.15, 1.0); put('ac_unit', q3.x, q3.y, q3.rot, 0); }
      } else if (b.kind === 'mansion' || b.kind === 'hotel') {
        // 裏面に各階の室外機（架台つり）
        const back = (f + 2) % 4, bl = faceLen(b, back);
        const per = Math.max(1, Math.floor(bl / 14));
        for (let fl = 1; fl < b.hgt; fl++) {
          for (let i = 0; i < per; i++) {
            if (rr() < 0.25) continue;
            const q = wallPt(b, back, (i + 0.5) / per + (rr() - 0.5) * 0.04, 0.8);
            put('ac_unit', q.x, q.y, q.rot, Math.max(6, b.hW - FLOORH * b.hgt) + fl * FLOORH - 6.2);
          }
        }
      } else {
        // 事務所・店舗: 側面の地上に室外機
        const sf = (f + 1 + (b.seed % 2) * 2) % 4;
        const n = 1 + ((rr() * 3) | 0);
        for (let i = 0; i < n; i++) {
          const q = wallPt(b, sf, 0.2 + i * 0.22, 1.0);
          put('ac_unit', q.x, q.y, q.rot, 0);
        }
      }
    }
  }
  const FLOORH = 7;
  // 倉庫・工場のまわり: 横のコンテナ、シャッター前のカラーコーン、室外機
  function warehouseYard(b, f, rr) {
    const sf = (f + (b.seed % 2 ? 1 : 3)) % 4;
    if (b.seed % 3 !== 1 && faceLen(b, sf) > 19) {
      const q = wallPt(b, sf, 0.5, 4.6);
      if (clearOfRoad(q.x, q.y, 3.6) && !overlapsOther(b, q.x, q.y, 4) && !inWaterRaw(q.x, q.y) && !nearLM(q.x, q.y, 10) && free(q.x, q.y, 3)) {
        put(['wcont_a', 'wcont_b', 'wcont_c'][(b.seed >> 1) % 3], q.x, q.y, q.along, 0);
        take(q.x, q.y, 7);
        stats.wh_container = (stats.wh_container || 0) + 1;
      }
    }
    if (rr() < 0.6) {
      for (const t of [0.18, 0.3]) {
        const q = wallPt(b, f, t, 2.2);
        if (clearOfRoad(q.x, q.y, 0.5)) put('traffic_cone', q.x, q.y, 0, 0);
      }
    }
    const q2 = wallPt(b, (f + 2) % 4, 0.3 + rr() * 0.4, 1.0);
    put('ac_unit', q2.x, q2.y, q2.rot, 0);
    stats.warehouse = (stats.warehouse || 0) + 1;
  }

  /* ---------- 第3段: 住宅地のごみステーション ---------- */
  function gomiStations() {
    const rr = mulberry32(5305);
    for (const r of ROADS) {
      if (r.kind !== 'minor' && r.kind !== 'lane') continue;
      walkSpots(r, r.kind === 'lane' ? 260 : 420, 220, rr, (sg, d) => {
        const p = walkAt(r, sg, d, r.kind === 'lane' ? 2.6 : G3.SW + 2.2);
        const z = zoneOf(p.x, p.y);
        if (z === 'center') return;
        if (nearBld(p.x, p.y, 2) || !free(p.x, p.y, 4) || inWaterRaw(p.x, p.y)) return;
        put('gomi_station', p.x, p.y, roadFace(r, sg, d, p), 0);
        take(p.x, p.y, 3);
      });
    }
  }

  /* ---------- 第3段: 道後（からくり時計・鉄柵・提灯・のぼり） ---------- */
  function dogo(scene) {
    const rr = mulberry32(5306);
    // 坊っちゃんカラクリ時計（放生園）
    {
      const [x, y] = nudgeOffRoad(7418, 2372, 4);
      put('karakuri_clock', x, y, faceTo(x, y, 7395, 2335), 0);
      kclock = [x, y];
      take(x, y, 8);
    }
    // 道後温泉駅前の黒い鋳鉄柵（道路沿いの歩道の外側）
    const st = [7352, 2292];
    for (const r of ROADS) {
      if (r.kind === 'arcade' || r.kind === 'lane') continue;
      const cuts = G3.roadCuts(r);
      for (const [sg, cl] of [[1, cuts.cutsL], [-1, cuts.cutsR]]) {
        for (const [a, b] of G3.minusIntervals(r.pl.len, cl)) {
          for (let d = a + 3; d + 5 <= b - 3; d += 5) {
            const c = walkAt(r, sg, d + 2.5, 0.8);
            if (hyp(c.x - st[0], c.y - st[1]) > 300) continue;
            if (!free(c.x, c.y, 1)) continue;
            const dd = sg > 0 ? d + 5 : d;
            const p = walkAt(r, sg, dd, 0.8);
            onWalk('iron_fence', p.x, p.y, -(c.a + (sg > 0 ? Math.PI : 0)));
            take(c.x, c.y, 1.5);
          }
        }
      }
    }
    // 商店街: 提灯の列（アーケードを横断する電線に吊る）・のぼり
    const wire = [];
    for (const r of ROADS) {
      if (r.kind !== 'arcade') continue;
      const isDogo = r.n === '道後商店街';
      if (isDogo) {
        for (let d = 8; d < r.pl.len - 6; d += 14) {
          const a = at(r, d, -r.w / 2 + 1), b = at(r, d, r.w / 2 - 1);
          const hy = 11.6;
          wire.push(a.x, heightAt(a.x, a.y) + hy + 0.6, a.y, b.x, heightAt(b.x, b.y) + hy + 0.6, b.y);
          for (let o = -r.w / 2 + 3; o <= r.w / 2 - 3; o += 3) {
            const q = at(r, d, o);
            put('chochin', q.x, q.y, 0, hy + 0.6 - Math.cos(o / r.w * Math.PI) * 0.6);
          }
        }
      }
      const nb = isDogo ? ['nobori_c', 'nobori_b', 'nobori_a', 'nobori_d'] : ['nobori_e', 'nobori_a', 'nobori_d', 'nobori_b'];
      let k = 0;
      for (let d = 7; d < r.pl.len - 5; d += 17) {
        for (const sg of [1, -1]) {
          const q = at(r, d + (sg > 0 ? 0 : 8), sg * (r.w / 2 - 1.2));
          put(nb[(k++ + ((rr() * 2) | 0)) % nb.length], q.x, q.y, -q.a, 0.12);
        }
      }
    }
    if (wire.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
      scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x1d1f22 })));
    }
    // 石灯籠: 神社・寺・公園の参道入口
    for (const [nm, lx, ly] of [['護国神社', 5563, 1815], ['石手寺', 8114, 2485], ['道後公園', 7430, 2470], ['道後温泉本館', 7434, 2155]]) {
      const l = LMS.find(q => q.n === nm);
      const cx = l && l.solid ? (l.solid[0] + l.solid[2]) / 2 : lx, cy = l && l.solid ? (l.solid[1] + l.solid[3]) / 2 : ly;
      const ri = roadInfo(cx, cy);
      if (!ri) continue;
      const dx = cx - ri.x, dy = cy - ri.y, L = hyp(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const back = Math.min(L - 8, ri.road.w / 2 + G3.SW + 6);
      for (const s of [1, -1]) {
        const x = ri.x + ux * back - uy * s * 9, y = ri.y + uy * back + ux * s * 9;
        if (nearBld(x, y, 1) || inWaterRaw(x, y)) continue;
        put('stone_lantern', x, y, faceTo(x, y, ri.x, ri.y), 0);
        take(x, y, 2);
      }
    }
  }

  /* ---------- 第3段: 港（コンテナ・係船柱） ---------- */
  const portCoast = [];
  function ports() {
    const rr = mulberry32(5307);
    const PORTS = [[1000, 1790, 230], [1330, 660, 230], [4482, 300, 160]];
    for (const [px, py, rad] of PORTS) {
      // 岸壁の係船柱（海岸線ポリゴンに沿って）
      const coast = [];
      for (let i = 1; i < SEA.length; i++) {
        const a = SEA[i - 1], b = SEA[i];
        const L = hyp(b[0] - a[0], b[1] - a[1]);
        for (let t = 0; t < L; t += 22) {
          const x = lerp(a[0], b[0], t / L), y = lerp(a[1], b[1], t / L);
          if (hyp(x - px, y - py) > rad) continue;
          let nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
          if (inWaterRaw(x + nx * 6, y + ny * 6)) { nx = -nx; ny = -ny; }
          if (inWaterRaw(x + nx * 6, y + ny * 6)) continue;
          coast.push([x, y, nx, ny]);
        }
      }
      portCoast.push(...coast);
      for (const [x, y, nx, ny] of coast) {
        const bx = x + nx * 2.2, by = y + ny * 2.2;
        if (nearBld(bx, by, 1) || !clearOfRoad(bx, by, -G3.SW) || !free(bx, by, 2)) continue;
        put('mooring_bollard', bx, by, -Math.atan2(-ny, -nx), 0);
        take(bx, by, 2);
      }
      // コンテナヤード（岸壁の内側の空き地に2段積み）
      let placed = 0;
      for (let t = 0; t < 400 && placed < 7; t++) {
        const c = coast[(rr() * coast.length) | 0];
        if (!c) break;
        const dist = 26 + rr() * 50;
        const x = c[0] + c[2] * dist, y = c[1] + c[3] * dist;
        const ang = Math.atan2(c[1] - y, c[0] - x) + Math.PI / 2;
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const n = 2 + ((rr() * 3) | 0);
        const pts = [];
        for (let i = 0; i < n; i++) pts.push([x + ux * i * 16 - uy * 0, y + uy * i * 16]);
        let ok = true;
        for (const [qx, qy] of pts) for (const [ox, oy] of [[0, 0], [ux * 8, uy * 8], [-ux * 8, -uy * 8]]) {
          const X = qx + ox, Y = qy + oy;
          if (inWaterRaw(X, Y) || nearBld(X, Y, 4) || !clearOfRoad(X, Y, 3) || !free(X, Y, 7)) { ok = false; break; }
        }
        if (!ok) continue;
        for (const [qx, qy] of pts) {
          const nm = ['container_a', 'container_b', 'container_c', 'container_d'];
          put(nm[(rr() * 4) | 0], qx, qy, -ang, 0);
          if (rr() < 0.55) put(nm[(rr() * 4) | 0], qx, qy, -ang, 6.48);
          take(qx, qy, 8);
        }
        placed++;
      }
    }
  }

  /* ---------- 第4段: 路面標示（ダイヤマーク・止まれ・停止線・矢印・自転車ナビ） ---------- */
  function markAtlas() {
    // 4×2 セル（各128px）。キャンバス上方向 = 進行方向
    return G3.world.canvasTex(512, 512, g => {
      g.clearRect(0, 0, 512, 512);
      const W = '#f2f2ee';
      const cell = (i, fn) => { g.save(); g.translate((i % 4) * 128, ((i / 4) | 0) * 128); fn(); g.restore(); };
      // 0: ダイヤマーク（横断歩道あり）
      cell(0, () => { g.strokeStyle = W; g.lineWidth = 9; g.beginPath(); g.moveTo(64, 6); g.lineTo(110, 64); g.lineTo(64, 122); g.lineTo(18, 64); g.closePath(); g.stroke(); });
      // 1: 止まれ（遠い側が「止」）
      cell(1, () => {
        g.fillStyle = W; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = 'bold 40px "Hiragino Sans","Hiragino Kaku Gothic ProN",sans-serif';
        ['止', 'ま', 'れ'].forEach((c, i) => { g.save(); g.translate(64, 22 + i * 42); g.scale(1.6, 1.0); g.fillText(c, 0, 0); g.restore(); });
      });
      // 2: 直進矢印
      cell(2, () => { g.fillStyle = W; g.fillRect(56, 40, 16, 84); g.beginPath(); g.moveTo(64, 4); g.lineTo(90, 44); g.lineTo(38, 44); g.closePath(); g.fill(); });
      // 3: 直進・左折矢印
      cell(3, () => {
        g.fillStyle = W; g.fillRect(70, 40, 14, 84); g.beginPath(); g.moveTo(77, 4); g.lineTo(100, 44); g.lineTo(54, 44); g.closePath(); g.fill();
        g.fillRect(40, 84, 34, 13); g.fillRect(40, 60, 13, 36); g.beginPath(); g.moveTo(46, 30); g.lineTo(66, 62); g.lineTo(26, 62); g.closePath(); g.fill();
      });
      // 4: 自転車ナビマーク（青い矢羽根＋自転車）
      cell(4, () => {
        g.fillStyle = '#1f5fbf';
        g.beginPath(); g.moveTo(64, 6); g.lineTo(118, 50); g.lineTo(118, 74); g.lineTo(64, 30); g.lineTo(10, 74); g.lineTo(10, 50); g.closePath(); g.fill();
        g.strokeStyle = W; g.lineWidth = 5;
        g.beginPath(); g.arc(40, 104, 14, 0, TAU); g.stroke(); g.beginPath(); g.arc(88, 104, 14, 0, TAU); g.stroke();
        g.beginPath(); g.moveTo(40, 104); g.lineTo(58, 82); g.lineTo(80, 82); g.lineTo(88, 104); g.moveTo(58, 82); g.lineTo(64, 104); g.lineTo(80, 82); g.stroke();
      });
      // 5: 白ベタ（停止線）
      cell(5, () => { g.fillStyle = W; g.fillRect(0, 0, 128, 128); });
      // 6: 舗装の補修跡（少し濃いアスファルト）
      cell(6, () => {
        g.fillStyle = 'rgba(28,30,34,0.55)';
        g.beginPath(); g.moveTo(10, 14);
        for (let k = 0; k < 18; k++) { const a = k / 18 * TAU, r = 50 + Math.sin(k * 2.7) * 6; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r * 0.95); }
        g.closePath(); g.fill();
        g.strokeStyle = 'rgba(10,10,12,0.5)'; g.lineWidth = 2; g.stroke();
      });
      // 7: ひび割れ
      cell(7, () => {
        g.strokeStyle = 'rgba(12,12,14,0.65)'; g.lineWidth = 1.6;
        const br = (x, y, a, n) => { if (n <= 0) return; const L = 10 + Math.random() * 16; const x2 = x + Math.cos(a) * L, y2 = y + Math.sin(a) * L;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke(); br(x2, y2, a + (Math.random() - 0.5) * 0.9, n - 1); if (Math.random() < 0.35) br(x2, y2, a + 1.2, n - 2); };
        br(64, 4, Math.PI / 2, 8); br(64, 64, 0.3, 4);
      });
      // 8: 側溝のグレーチング（鉄の格子）
      cell(8, () => {
        g.fillStyle = '#3c3e40'; g.fillRect(16, 4, 96, 120);
        g.fillStyle = '#16171a'; for (let k = 0; k < 14; k++) g.fillRect(22, 10 + k * 8.2, 84, 4.5);
        g.strokeStyle = '#5a5c5e'; g.lineWidth = 3; g.strokeRect(16, 4, 96, 120);
      });
      // 9: オイル染み
      cell(9, () => {
        const gr = g.createRadialGradient(64, 64, 0, 64, 64, 60);
        gr.addColorStop(0, 'rgba(8,8,10,0.55)'); gr.addColorStop(0.6, 'rgba(8,8,10,0.25)'); gr.addColorStop(1, 'rgba(8,8,10,0)');
        g.fillStyle = gr; g.beginPath(); g.ellipse(64, 64, 60, 44, 0.3, 0, TAU); g.fill();
      });
    });
  }
  function roadMarks(scene) {
    const gb = new G3.GB(false);
    const decal = (x, y, h, hw, hl, ci) => {
      const fx = Math.cos(h), fy = Math.sin(h), rx = -Math.sin(h), ry = Math.cos(h);
      const u0 = (ci % 4) / 4 + 0.004, u1 = ((ci % 4) + 1) / 4 - 0.004;
      const v1 = 1 - ((ci / 4) | 0) / 4 - 0.004, v0 = 1 - (((ci / 4) | 0) + 1) / 4 + 0.004;
      const P = [[x - fx * hl - rx * hw, y - fy * hl - ry * hw], [x - fx * hl + rx * hw, y - fy * hl + ry * hw],
        [x + fx * hl + rx * hw, y + fy * hl + ry * hw], [x + fx * hl - rx * hw, y + fy * hl - ry * hw]];
      const UV = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      const V = P.map(q => [q[0], heightAt(q[0], q[1]) + 0.075, q[1]]);
      const ux = V[1][0] - V[0][0], uz = V[1][2] - V[0][2], vx = V[3][0] - V[0][0], vz = V[3][2] - V[0][2];
      if (uz * vx - ux * vz > 0) gb.quad(V, UV);
      else gb.quad([V[0], V[3], V[2], V[1]], [UV[0], UV[3], UV[2], UV[1]]);
    };
    let n = 0;
    for (const r of ROADS) {
      if (r.kind === 'arcade') continue;
      // 車線: 幹線は片側2車線（境界 = w/4(+軌道1.5)）、生活道路は片側1車線
      const edge = r.w / 2 - (r.kind === 'main' ? 1.6 : r.kind === 'lane' ? 0.9 : 1.0);
      const inner0 = r.tram ? 4.2 : 0.7;
      const bnd = r.w / 4 + (r.tram ? 1.5 : 0);
      const lanes = r.kind === 'main' ? [[(inner0 + bnd) / 2, (bnd - inner0) / 2 - 0.6], [(bnd + edge) / 2, (edge - bnd) / 2 - 0.6]]
        : [[(inner0 + edge) / 2, (edge - inner0) / 2 - 0.6]];
      const all = [(inner0 + edge) / 2, (edge - inner0) / 2];
      for (const j of r.junc) {
        if (j.road.kind === 'arcade') continue;
        const back0 = j.road.w / 2 + 4;
        for (const dir of [1, -1]) {
          const dStop = j.d - dir * back0;
          if (dStop < 20 || dStop > r.pl.len - 20) continue;
          if (r.junc.some(k => k !== j && Math.abs(k.d - dStop) < k.road.w / 2 + 6)) continue;
          const lane = (d, o) => at(r, d, -dir * o);
          const head = d => at(r, d, 0).a + (dir > 0 ? 0 : Math.PI);
          const ps = lane(dStop, all[0]);
          decal(ps.x, ps.y, head(dStop), all[1], 0.45, 5); n++;
          for (const L of lanes) { const po = lane(dStop - dir * 9, L[0]); decal(po.x, po.y, head(dStop), 1.6, 2.6, 9); n++; }
          if ((r.kind === 'minor' && j.road.kind === 'main') || (r.kind === 'lane' && j.road.kind !== 'lane' && j.road.kind !== 'arcade')) {
            const d = dStop - dir * 15, p = lane(d, lanes[0][0]);
            decal(p.x, p.y, head(d), Math.min(lanes[0][1], 3.6), 11, 1); n++;
          } else if (r.kind === 'main') {
            for (const back of [16, 52]) {
              const d = dStop - dir * back;
              if (d < 10 || d > r.pl.len - 10) continue;
              lanes.forEach((L, i) => { const p = lane(d, L[0]); decal(p.x, p.y, head(d), Math.min(2.3, L[1]), 6, i === 0 ? 2 : 3); n++; });
            }
          }
        }
      }
      // 横断歩道の手前のダイヤマーク（約50m・30m手前）
      for (const c of CROSSWALKS) {
        const ri = roadInfo(c[0], c[1]);
        if (!ri || ri.road !== r) continue;
        const dc = dOnPl(r.pl, c[0], c[1]);
        for (const dir of [1, -1]) for (const back of [75, 125]) {
          const d = dc - dir * back;
          if (d < 10 || d > r.pl.len - 10) continue;
          if (r.junc.some(k => Math.abs(k.d - d) < k.road.w / 2 + 6)) continue;
          for (const L of lanes) {
            const p = at(r, d, -dir * L[0]);
            decal(p.x, p.y, p.a + (dir > 0 ? 0 : Math.PI), Math.min(2.6, L[1]), 6.5, 0); n++;
          }
        }
      }
      // 路面の傷み（補修跡・ひび割れ・オイル染み）と側溝のグレーチング
      {
        const rw = mulberry32(5700 + r.pl.len | 0);
        const cuts = G3.roadCuts(r);
        for (const [a, b] of G3.minusIntervals(r.pl.len, cuts.mark)) {
          for (let d = a + 6; d < b - 6; d += 26) {
            for (const sg of [1, -1]) {
              const p = at(r, d + (sg > 0 ? 0 : 13), sg * (r.w / 2 - 0.75));
              decal(p.x, p.y, p.a, 0.5, 1.25, 8); n++;
            }
          }
          for (let d = a + 10; d < b - 10; d += 40 + rw() * 60) {
            const o = (rw() - 0.5) * (r.w - 4), p = at(r, d, o), k = rw();
            if (k < 0.45) decal(p.x, p.y, p.a + (rw() - 0.5) * 0.4, 2 + rw() * 3, 3 + rw() * 4, 6);
            else if (k < 0.85) decal(p.x, p.y, p.a + (rw() - 0.5) * 2, 1.5 + rw() * 2, 3 + rw() * 3, 7);
            else decal(p.x, p.y, rw() * TAU, 1.2 + rw(), 1.5 + rw(), 9);
            n++;
          }
        }
      }
      // 自転車ナビマーク（中心部の幹線・左端）
      if (r.kind === 'main') {
        const cuts = G3.roadCuts(r);
        for (const [a, b] of G3.minusIntervals(r.pl.len, cuts.mark)) {
          for (let d = a + 10; d < b - 10; d += 25) {
            const c0 = at(r, d, 0);
            const z = zoneOf(c0.x, c0.y);
            if (z !== 'center' && z !== 'dogo') continue;
            for (const dir of [1, -1]) {
              const p = at(r, d, -dir * (edge - 1.4));
              decal(p.x, p.y, p.a + (dir > 0 ? 0 : Math.PI), 1.5, 1.8, 4); n++;
            }
          }
        }
      }
    }
    const mat = new THREE.MeshStandardMaterial({ map: markAtlas(), transparent: true, roughness: 0.75, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -120 });
    const m = gb.mesh(mat, false);
    m.castShadow = false; m.renderOrder = 1;
    scene.add(m);
    stats.road_marks = n;
  }

  /* ---------- 第5段: 踏切（列車接近で遮断・警報灯点滅） ---------- */
  const xings = [];
  function crossings(scene) {
    const post = G3.glbNode('street', 'crossing_post'), arm = G3.glbNode('street', 'crossing_arm');
    if (!post || !arm) return;
    for (const rl of RAILS) {
      for (const r of ROADS) {
        if (r.kind === 'arcade') continue;
        const A = rl.pl.pts, B = r.pl.pts;
        for (let i = 1; i < A.length; i++) for (let j = 1; j < B.length; j++) {
          const p = A[i - 1], p2 = A[i], q = B[j - 1], q2 = B[j];
          const rx = p2[0] - p[0], ry = p2[1] - p[1], sx = q2[0] - q[0], sy = q2[1] - q[1];
          const den = rx * sy - ry * sx;
          if (Math.abs(den) < 1e-6) continue;
          const t = ((q[0] - p[0]) * sy - (q[1] - p[1]) * sx) / den, u = ((q[0] - p[0]) * ry - (q[1] - p[1]) * rx) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const dRail = rl.pl.cum[i - 1] + t * Math.hypot(rx, ry), dRoad = r.pl.cum[j - 1] + u * Math.hypot(sx, sy);
          if (dRoad < 12 || dRoad > r.pl.len - 12) continue;
          if (r.junc.some(k => Math.abs(k.d - dRoad) < k.road.w / 2 + 10)) continue;
          const lamps = [], arms = [];
          for (const dir of [1, -1]) {
            const c = at(r, dRoad - dir * 11, -dir * (r.w / 2 + 1.3));
            const o = post.clone(true);
            o.position.set(c.x, heightAt(c.x, c.y) + G3.CURB, c.y);
            o.rotation.y = -(c.a + (dir > 0 ? Math.PI : 0));
            o.scale.setScalar(U);
            const mats = {};
            o.traverse(m => {
              if (!m.isMesh) return;
              m.castShadow = true;
              if (/^Xing[LR]/.test(m.material.name)) { m.material = m.material.clone(); m.material.emissive.set(0xff2a1a); mats[m.material.name[4]] = m.material; }
              else m.material = G3.lmMat(m.material);
            });
            const a = arm.clone(true);
            a.traverse(m => { if (m.isMesh) { m.material = G3.lmMat(m.material); m.castShadow = true; } });
            a.position.set(0, 0.9, 0.5);
            a.rotation.x = 1.45;
            o.add(a);
            scene.add(o);
            lamps.push(mats); arms.push(a);
            if (typeof addCollider === 'function') addCollider({ x: c.x, y: c.y, r: 0.6 });
            take(c.x, c.y, 3);
          }
          xings.push({ pl: rl.pl, d: dRail, lamps, arms, k: 0 });
        }
      }
    }
    stats.crossing = xings.length;
  }
  function updCrossings(dt) {
    for (const x of xings) {
      let near = false;
      for (const tr of TRAINS) if (tr.pl === x.pl && Math.abs(tr.d - x.d) < 150) { near = true; break; }
      x.k = clamp(x.k + (near ? dt * 0.8 : -dt * 0.6), 0, 1);
      const ang = 1.45 * (1 - x.k);
      for (const a of x.arms) a.rotation.x = ang;
      const blink = near || x.k > 0.02 ? (Math.floor(tSec * 2.4) % 2) : -1;
      for (const L of x.lamps) {
        if (L.L) L.L.emissiveIntensity = blink === 0 ? 5 : 0.05;
        if (L.R) L.R.emissiveIntensity = blink === 1 ? 5 : 0.05;
      }
    }
  }

  /* ---------- 第5段: 架線柱と架線 ---------- */
  function catenary(scene) {
    const wire = [];
    for (const rl of RAILS) {
      let prev = null;
      for (let d = 20; d < rl.pl.len - 10; d += 45) {
        const p = plAt(rl.pl, d);
        const nx = -Math.sin(p.a), ny = Math.cos(p.a);
        const x = p.x + nx * 6.8, y = p.y + ny * 6.8;
        const top = heightAt(p.x, p.y) + 16.6;
        if (prev) wire.push(prev[0], prev[1], prev[2], p.x, top, p.y);
        prev = [p.x, top, p.y];
        const ri = roadInfo(x, y);
        if ((ri && ri.d < ri.road.w / 2 + G3.SW + 2) || inWaterRaw(x, y) || nearBld(x, y, 2) || xings.some(k => k.pl === rl.pl && Math.abs(k.d - d) < 18)) continue;
        put('catenary_pole', x, y, -(p.a - Math.PI / 2), 0);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x2a2c30, transparent: true, opacity: 0.8 })));
  }

  /* ---------- 第5段: 公園（遊具・トイレ・公園灯）と住宅地の児童公園 ---------- */
  function playground(cx, cy, ang, big) {
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const L = (u, v) => [cx + ca * u - sa * v, cy + sa * u + ca * v];
    const items = [['slide', -10, -8, 0], ['swing', 10, -8, Math.PI / 2], ['jungle_gym', -10, 8, 0], ['sandbox', 10, 9, 0]];
    if (big) items.push(['park_toilet', 0, 20, -Math.PI / 2], ['fountain', 0, -16, 0]);
    for (const [nm, u, v, r0] of items) {
      const [x, y] = L(u, v);
      if (inWaterRaw(x, y) || nearBld(x, y, 2) || !free(x, y, 4)) continue;
      put(nm, x, y, -(ang + r0), 0);
      take(x, y, nm === 'park_toilet' ? 7 : 5);
    }
    for (const [u, v] of [[-18, -18], [18, 18], [18, -18], [-18, 18]]) {
      const [x, y] = L(u, v);
      if (!inWaterRaw(x, y) && !nearBld(x, y, 1) && free(x, y, 2)) { put('park_lamp', x, y, 0, 0); take(x, y, 1); }
    }
    for (const [u, v, r0] of [[0, -24, Math.PI / 2], [-24, 0, 0]]) {
      const [x, y] = L(u, v);
      if (!inWaterRaw(x, y) && !nearBld(x, y, 1) && free(x, y, 3)) { put('bench', x, y, -(ang + r0), 0); take(x, y, 2); }
    }
  }
  function parks(scene) {
    const rr = mulberry32(5508);
    for (const pk of PARKS) {
      for (let t = 0, done = 0; t < 300 && done < 1; t++) {
        let x, y;
        if (pk.k === 'rect') { x = lerp(pk.x0 + 40, pk.x1 - 40, rr()); y = lerp(pk.y0 + 40, pk.y1 - 40, rr()); }
        else { const a = rr() * TAU, d = pk.r * (0.2 + rr() * 0.3); x = pk.x + Math.cos(a) * d; y = pk.y + Math.sin(a) * d; }
        let ok = true;
        for (const [dx, dy] of [[0, 0], [25, 25], [-25, 25], [25, -25], [-25, -25]]) {
          const X = x + dx, Y = y + dy;
          const ri = roadInfo(X, Y);
          if (inWaterRaw(X, Y) || hillAt(X, Y) || nearBld(X, Y, 2) || propHit(X, Y, 3, false) || (ri && ri.d < ri.road.w / 2 + G3.SW + 3)) { ok = false; break; }
        }
        if (!ok) continue;
        playground(x, y, rr() * TAU, true);
        done++;
      }
      // 公園灯を散らす
      for (let t = 0, n = 0; t < 200 && n < 14; t++) {
        let x, y;
        if (pk.k === 'rect') { x = lerp(pk.x0 + 10, pk.x1 - 10, rr()); y = lerp(pk.y0 + 10, pk.y1 - 10, rr()); }
        else { const a = rr() * TAU, d = pk.r * Math.sqrt(rr()); x = pk.x + Math.cos(a) * d; y = pk.y + Math.sin(a) * d; }
        const ri = roadInfo(x, y);
        if (inWaterRaw(x, y) || hillAt(x, y) || nearBld(x, y, 2) || !free(x, y, 8) || propHit(x, y, 2, false) || (ri && ri.d < ri.road.w / 2 + G3.SW + 2)) continue;
        put('park_lamp', x, y, 0, 0); take(x, y, 2); n++;
      }
    }
    // 住宅地の児童公園（空き地に）
    const gb = new G3.GB(false);
    let n = 0;
    for (let t = 0; t < 2500 && n < 14; t++) {
      const x = 900 + rr() * 7400, y = 600 + rr() * 4600;
      if (zoneOf(x, y) !== 'suburb') continue;
      const ri = roadInfo(x, y);
      if (!ri || ri.road.kind === 'arcade' || ri.d < ri.road.w / 2 + G3.SW + 30 || ri.d > 140) continue;
      let ok = true;
      for (const [dx, dy] of [[0, 0], [28, 28], [-28, 28], [28, -28], [-28, -28], [0, 30], [30, 0], [0, -30], [-30, 0]]) {
        const X = x + dx, Y = y + dy, rq = roadInfo(X, Y);
        if (inWaterRaw(X, Y) || hillAt(X, Y) || inPark(X, Y, 4) || nearBld(X, Y, 3) || !free(X, Y, 6) || propHit(X, Y, 3, false) || nearLM(X, Y, 90) ||
          (rq && rq.d < rq.road.w / 2 + G3.SW + 4) || railDist(X, Y) < 20) { ok = false; break; }
      }
      if (!ok || KEYPTS.some(k => hyp(k[0] - x, k[1] - y) < 50)) continue;
      const ang = Math.atan2(ri.y - y, ri.x - x);
      const ca = Math.cos(ang), sa = Math.sin(ang), Rr = 30;
      const P = [[-Rr, -Rr], [Rr, -Rr], [Rr, Rr], [-Rr, Rr]].map(([u, v]) => [x + ca * u - sa * v, heightAt(x, y) + 0.06, y + sa * u + ca * v]);
      const nyv = (P[1][2] - P[0][2]) * (P[3][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[3][2] - P[0][2]);
      gb.quad(nyv > 0 ? P : [P[0], P[3], P[2], P[1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      playground(x, y, ang, false);
      take(x, y, 30);
      n++;
    }
    const m = gb.mesh(new THREE.MeshStandardMaterial({ color: 0xb59d74, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 }), false);
    m.castShadow = false;
    scene.add(m);
    stats.kids_park = n;
  }

  /* ---------- 第5段: 住宅の屋根（太陽光パネル・テレビアンテナ） ---------- */
  function roofs() {
    const rr = mulberry32(5509);
    const q = new THREE.Quaternion(), q2 = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(U * 1.5, U, U * 1.5);
    for (const b of buildings) {
      if (b.noDraw || b.kind !== 'house' || b.sty === 'warehouse') continue;
      const x0 = b.x0, z0 = b.y0, x1 = b.x1, z1 = b.y1, o = 1.2, top = b.hW;
      const longX = (x1 - x0) >= (z1 - z0), span = longX ? (z1 - z0) : (x1 - x0), rh = span * 0.32;
      const th = Math.atan2(rh + 0.6, span / 2 + o);
      const midY = top - 0.6 + (rh + 0.6) / 2 + 0.25;
      if (rr() < 0.42) {
        const len = longX ? x1 - x0 : z1 - z0;
        const cnt = len > 34 ? 2 : 1;
        for (let k = 0; k < cnt; k++) {
          const f = cnt === 1 ? 0.5 : 0.3 + k * 0.4;
          if (longX) {   // 南向きの斜面（+z 側）
            v.set(lerp(x0, x1, f), midY, (z0 + z1) / 2 + (span / 2 + o) / 2);
            q.setFromEuler(e.set(th, 0, 0));
          } else {
            v.set((x0 + x1) / 2 + (span / 2 + o) / 2, midY, lerp(z0, z1, f));
            q2.setFromEuler(e.set(0, Math.PI / 2, 0));
            q.setFromEuler(e.set(0, 0, -th)).multiply(q2);
          }
          putM('solar_panel', new THREE.Matrix4().compose(v.clone(), q.clone(), sc));
        }
      }
      if (rr() < 0.65) {
        const ax = longX ? lerp(x0, x1, 0.2) : (x0 + x1) / 2, az = longX ? (z0 + z1) / 2 : lerp(z0, z1, 0.2);
        putM('tv_antenna', G3.M4(ax, top + rh + 0.4, az, rr() * TAU, U));
      }
    }
  }

  /* ---------- 第5段: ガソリンスタンド ---------- */
  function gasStations(scene) {
    const rr = mulberry32(5510);
    const gb = new G3.GB(false);
    let n = 0;
    const mains = ROADS.filter(r => r.kind === 'main');
    for (let t = 0; t < 1500 && n < 6; t++) {
      const r = mains[(rr() * mains.length) | 0];
      const d = 40 + rr() * (r.pl.len - 120);
      const c0 = at(r, d, 0);
      if (zoneOf(c0.x, c0.y) === 'center') continue;
      if (r.junc.some(j => Math.abs(j.d - d - 25) < j.road.w / 2 + 40)) continue;
      const sg = rr() < 0.5 ? 1 : -1;
      const W = 50, D = 38, o0 = r.w / 2 + G3.SW + 0.5;
      const pts = lotFree(r, d, sg, W, D, o0, { lm: 110 });
      if (!pts) continue;
      const Lc = (u, vv) => at(r, d + u, sg * (o0 + vv));
      const V = q => [q.x, heightAt(q.x, q.y) + 0.07, q.y];
      const P = [Lc(0, 0), Lc(W, 0), Lc(W, D), Lc(0, D)].map(V);
      const nyv = (P[1][2] - P[0][2]) * (P[3][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[3][2] - P[0][2]);
      gb.quad(nyv > 0 ? P : [P[0], P[3], P[2], P[1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      const cc = Lc(W / 2, 15), rot = -cc.a;
      put('gs_canopy', cc.x, cc.y, rot, 0);
      if (typeof addCollider === 'function') for (const u of [-10, 10]) { const pp = Lc(W / 2 + u, 15); addCollider({ x: pp.x, y: pp.y, r: 0.8 }); }
      for (const vv of [9, 21]) { const pp = Lc(W / 2, vv); put('gs_pump', pp.x, pp.y, rot, 0); }
      const of = Lc(W - 8, D - 9);
      put('gs_office', of.x, of.y, roadFace(r, sg, d + W - 8, of), 0);
      const sp = Lc(3, 2);
      put('gs_sign', sp.x, sp.y, rot, 0);
      for (const q of pts) take(q.x, q.y, 10);
      n++;
    }
    const m = gb.mesh(new THREE.MeshStandardMaterial({ map: G3.tex.concrete || null, color: 0xc9c6bd, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 }), false);
    m.castShadow = false;
    scene.add(m);
    stats.gas_station = n;
  }

  /* ---------- 第5段: 歩道の工事（家具帯の中だけを囲う） ---------- */
  function roadworks() {
    const rr = mulberry32(5511);
    let n = 0;
    for (let t = 0; t < 600 && n < 12; t++) {
      const r = ROADS[(rr() * ROADS.length) | 0];
      if (r.kind === 'arcade' || r.kind === 'lane') continue;
      const sg = rr() < 0.5 ? 1 : -1, d = 30 + rr() * (r.pl.len - 60);
      const cuts = G3.roadCuts(r);
      const ivs = G3.minusIntervals(r.pl.len, sg > 0 ? cuts.cutsL : cuts.cutsR);
      if (!ivs.some(([a, b]) => d > a + 10 && d + 12 < b - 10)) continue;
      const c = walkAt(r, sg, d + 6, 1.8);
      if (!free(c.x, c.y, 9)) continue;
      for (const k of [0, 6]) { const p = walkAt(r, sg, d + 3 + k, 3.0); put('barricade', p.x, p.y, -p.a, G3.CURB); }
      for (const k of [0, 3, 6, 9, 12]) { const p = walkAt(r, sg, d + k, 0.6); put('traffic_cone', p.x, p.y, 0, G3.CURB); }
      for (const dd of [-1.5, 13.5]) { const p = walkAt(r, sg, d + dd, 1.8); put('barricade', p.x, p.y, -(p.a + Math.PI / 2), G3.CURB); }
      const ks = walkAt(r, sg, d - 4, 2.0);
      put('koji_sign', ks.x, ks.y, -(ks.a + Math.PI), G3.CURB);
      take(c.x, c.y, 10);
      n++;
    }
    stats.roadwork = n;
  }

  /* ---------- 第5段: 漁船・バス待合所 ---------- */
  function boats() {
    const rr = mulberry32(5512);
    let last = null;
    for (const [x, y, nx, ny] of portCoast) {
      const hb = inHarbor(x, y);
      if (!hb && rr() < 0.35) continue;
      const bx = x - nx * 9, by = y - ny * 9;
      if (!inWaterRaw(bx, by) || (last && hyp(last[0] - bx, last[1] - by) < (hb ? 20 : 26))) continue;
      put('fishing_boat', bx, by, -(Math.atan2(ny, nx) + Math.PI / 2 + (rr() - 0.5) * 0.2), -1.4);
      last = [bx, by];
      // 漁港では外側にもう1隻横付け
      const ox = x - nx * 18.5, oy = y - ny * 18.5;
      if (hb && rr() < 0.7 && inWaterRaw(ox, oy)) put('fishing_boat', ox, oy, -(Math.atan2(ny, nx) + Math.PI / 2 + (rr() - 0.5) * 0.15), -1.4);
    }
  }
  function busShelters() {
    for (const b of BUSSTOPS) {
      const z = zoneOf(b[0], b[1]);
      if (z === 'suburb' || z === 'port') continue;
      const ri = roadInfo(b[0], b[1]);
      if (!ri) continue;
      const r = ri.road, d = dOnPl(r.pl, b[0], b[1]), c = at(r, d, 0);
      const sg = ((b[0] - c.x) * -Math.sin(c.a) + (b[1] - c.y) * Math.cos(c.a)) > 0 ? 1 : -1;
      const p = walkAt(r, sg, d - 9, G3.SW + 2.2);
      if (nearBld(p.x, p.y, 2) || !free(p.x, p.y, 4)) continue;
      put('bus_shelter', p.x, p.y, roadFace(r, sg, d - 9, p), 0);
      take(p.x, p.y, 5);
    }
  }

  /* ---------- 第6段: 共通（空き地探し・地面の四角形） ---------- */
  // 上向き法線になるよう頂点順をそろえて四角形を足す
  function flatQuad(gb, P, uv) {
    const nyv = (P[1][2] - P[0][2]) * (P[3][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[3][2] - P[0][2]);
    uv = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    if (nyv > 0) gb.quad(P, uv); else gb.quad([P[0], P[3], P[2], P[1]], [uv[0], uv[3], uv[2], uv[1]]);
  }
  // 道路沿いの敷地（W×D）が空いているか。pts を返す
  function lotFree(r, d, sg, W, D, o0, opt = {}) {
    const pts = [];
    for (const u of [0, 0.5, 1]) for (const vv of [0, 0.5, 1]) pts.push(at(r, d + u * W, sg * (o0 + vv * D)));
    for (const q of pts) {
      const rq = roadInfo(q.x, q.y);
      if (inWaterRaw(q.x, q.y) || hillAt(q.x, q.y) || inPark(q.x, q.y, 4) || nearBld(q.x, q.y, 3) || !free(q.x, q.y, 6) || railDist(q.x, q.y) < 18 ||
        nearLM(q.x, q.y, opt.lm || 60) || propHit(q.x, q.y, 3, true) || (rq && rq.road !== r && rq.d < rq.road.w / 2 + G3.SW + 2)) return null;
    }
    if (FIELDS.some(f => pts.some(q => q.x > f.x - 4 && q.x < f.x + f.w + 4 && q.y > f.y - 4 && q.y < f.y + f.h + 4))) return null;
    if (parked.some(c => pts.some(q => hyp(c.x - q.x, c.y - q.y) < W * 0.5 + 6))) return null;
    const xs = pts.map(q => q.x), ys = pts.map(q => q.y);
    const bx0 = Math.min(...xs) - 8, bx1 = Math.max(...xs) + 8, by0 = Math.min(...ys) - 8, by1 = Math.max(...ys) + 8;
    if (KEYPTS.some(k => k[0] > bx0 && k[0] < bx1 && k[1] > by0 && k[1] < by1)) return null;
    return pts;
  }

  /* ---------- 第6段: コンビニ ---------- */
  function konbinis(scene) {
    const rr = mulberry32(5601);
    const gb = new G3.GB(false), gbL = new G3.GB(false);
    let n = 0;
    for (let t = 0; t < 3000 && n < 10; t++) {
      const r = ROADS[(rr() * ROADS.length) | 0];
      if (r.kind === 'arcade') continue;
      const d = 40 + rr() * (r.pl.len - 130);
      const c0 = at(r, d, 0);
      if (zoneOf(c0.x, c0.y) === 'port') continue;
      if (r.junc.some(j => Math.abs(j.d - d - 29) < j.road.w / 2 + 34)) continue;
      const sg = rr() < 0.5 ? 1 : -1, W = 58, D = 48, o0 = r.w / 2 + G3.SW + 0.5;
      const pts = lotFree(r, d, sg, W, D, o0);
      if (!pts) continue;
      const Lc = (u, vv) => at(r, d + u, sg * (o0 + vv));
      const V = q => [q.x, heightAt(q.x, q.y) + 0.07, q.y];
      flatQuad(gb, [Lc(0, 0), Lc(W, 0), Lc(W, D), Lc(0, D)].map(V));
      const st = Lc(W / 2, D - 16);
      put('konbini', st.x, st.y, roadFace(r, sg, d + W / 2, st), 0);
      // 駐車枠（店の前）
      for (let k = 0; k <= 6; k++) {
        const u = 6 + k * 7.6;
        const a = Lc(u - 0.2, 2), b = Lc(u + 0.2, 2), e = Lc(u + 0.2, 15), f = Lc(u - 0.2, 15);
        flatQuad(gbL, [a, b, e, f].map(q => [q.x, heightAt(q.x, q.y) + 0.09, q.y]));
        if (k < 6) {
          const cs = Lc(u + 3.8, 14);
          put('car_stop', cs.x, cs.y, -(cs.a + Math.PI / 2), 0.05);
          if (rr() < 0.3 && typeof mkCar === 'function') {
            const cp = Lc(u + 3.8, 8), into = Math.atan2(cs.y - cp.y, cs.x - cp.x);
            parked.push(mkCar(cp.x, cp.y, into, ['kei', 'minivan', 'keitruck', 'van'][(rr() * 4) | 0]));
          }
        }
      }
      const sp = Lc(1.5, 1.5);
      put('konbini_sign', sp.x, sp.y, -sp.a, 0);
      for (const q of pts) take(q.x, q.y, 10);
      n++;
    }
    const m1 = gb.mesh(new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -8 }), false);
    const m2 = gbL.mesh(new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -16 }), false);
    m1.castShadow = m2.castShadow = false;
    scene.add(m1, m2);
    stats.konbini_lot = n;
  }

  /* ---------- 第6段: 送電鉄塔と送電線 ---------- */
  const POWER_LINES = [
    [[8350, 2900], [7650, 3560], [6900, 4620], [5800, 5300], [4300, 5420], [3100, 5560]],
    [[7950, 650], [6950, 980], [5950, 1300], [4900, 1620], [3800, 1960], [2700, 1760]],
  ];
  function powerLines(scene) {
    const wire = [];
    const towerFree = (x, y) => {
      const ri = roadInfo(x, y);
      return !(inWaterRaw(x, y) || nearBld(x, y, 10) || inPark(x, y, 10) || nearLM(x, y, 30) || !free(x, y, 12) || railDist(x, y) < 20 ||
        (ri && ri.d < ri.road.w / 2 + G3.SW + 10));
    };
    let n = 0;
    for (const L of POWER_LINES) {
      const pl = buildPl(L);
      let prev = null;
      for (let d = 0; d <= pl.len; d += 300) {
        const p = plAt(pl, d);
        const nx = -Math.sin(p.a), ny = Math.cos(p.a);
        let pos = null;
        for (const off of [0, 20, -20, 40, -40, 60, -60, 80, -80]) {
          const x = p.x + nx * off, y = p.y + ny * off;
          if (towerFree(x, y)) { pos = [x, y]; break; }
        }
        if (!pos) continue;
        const [x, y] = pos;
        put('pylon', x, y, -p.a, 0);
        take(x, y, 10);
        n++;
        const h0 = heightAt(x, y);
        const tips = [];
        for (const [z, Lm] of [[26, 6.5], [32, 6.0], [38, 5.0]]) for (const s of [-1, 1])
          tips.push([x + U * s * Lm * Math.sin(p.a), h0 + U * (z - 1.4), y - U * s * Lm * Math.cos(p.a)]);
        if (prev) {
          for (let i = 0; i < tips.length; i++) {
            const a = prev[i], b = tips[i];
            const span = hyp(b[0] - a[0], b[2] - a[2]), sag = span * 0.035;
            let px = a[0], py = a[1], pz = a[2];
            for (let k = 1; k <= 10; k++) {
              const t = k / 10;
              const qx = lerp(a[0], b[0], t), qz = lerp(a[2], b[2], t), qy = lerp(a[1], b[1], t) - Math.sin(t * Math.PI) * sag;
              wire.push(px, py, pz, qx, qy, qz);
              px = qx; py = qy; pz = qz;
            }
          }
        }
        prev = tips;
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x3a3c40, transparent: true, opacity: 0.7 })));
    stats.pylon_n = n;
  }

  /* ---------- 第6段: 歩道橋 ---------- */
  function overpasses(scene) {
    const rr = mulberry32(5603);
    const gb = new G3.GB(false);
    let n = 0;
    const mains = ROADS.filter(r => r.kind === 'main' && r.w >= 40);
    for (let t = 0; t < 1200 && n < 7; t++) {
      const r = mains[(rr() * mains.length) | 0];
      const d = 60 + rr() * (r.pl.len - 120);
      const c0 = at(r, d, 0);
      if (zoneOf(c0.x, c0.y) === 'port') continue;
      if (r.junc.some(j => Math.abs(j.d - d) < j.road.w / 2 + 60)) continue;
      if (CROSSWALKS.some(c => hyp(c[0] - c0.x, c[1] - c0.y) < 80)) continue;
      const o = r.w / 2 + G3.SW + 3.2;
      let ok = true;
      for (const sg of [1, -1]) for (let k = -30; k <= 3; k += 4) {
        const q = at(r, d + k, sg * o);
        if (inWaterRaw(q.x, q.y) || nearBld(q.x, q.y, 2) || !free(q.x, q.y, 4) || propHit(q.x, q.y, 2.5, false) || nearLM(q.x, q.y, 10)) { ok = false; break; }
      }
      if (!ok) continue;
      for (const sg of [1, -1]) {
        const s0 = at(r, d - 27, sg * o);
        put('ob_stair', s0.x, s0.y, -s0.a, 0);
        const cc = at(r, d - 13.5, sg * o);
        if (typeof addCollider === 'function') addCollider({ x: cc.x, y: cc.y, hx: 15, hy: 2.8, a: cc.a, m: 3 });
        for (let k = -28; k <= 3; k += 4) { const q = at(r, d + k, sg * o); take(q.x, q.y, 4); }
      }
      // 橋桁（車道の上・高さ5.2m）
      const H = 13.0, hw = 3.0, A = at(r, d, -(o + 1.5)), B = at(r, d, o + 1.5);
      const tx = Math.cos(c0.a) * hw, tz = Math.sin(c0.a) * hw;
      const y0 = heightAt(c0.x, c0.y) + H;
      const P = (q, s, y) => [q.x + tx * s, y, q.y + tz * s];
      gb.quad([P(A, -1, y0), P(B, -1, y0), P(B, 1, y0), P(A, 1, y0)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      gb.quad([P(A, 1, y0 - 0.9), P(B, 1, y0 - 0.9), P(B, -1, y0 - 0.9), P(A, -1, y0 - 0.9)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      for (const s of [-1, 1]) {
        gb.quad([P(A, s, y0 - 0.9), P(B, s, y0 - 0.9), P(B, s, y0 + 2.8), P(A, s, y0 + 2.8)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      n++;
    }
    const m = gb.mesh(new THREE.MeshStandardMaterial({ color: 0x3a6a9a, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }), true);
    scene.add(m);
    stats.overpass = n;
  }

  /* ---------- 第6段: 郊外駅のホーム ---------- */
  function stations() {
    let n = 0;
    for (const tr of [TRAINS[3], TRAINS[4]]) {
      if (!tr || !tr.stops) continue;
      for (const sd of tr.stops) {
        const p = plAt(tr.pl, sd);
        if (nearLM(p.x, p.y, 40) || zoneOf(p.x, p.y) === 'center') continue;
        for (const sg of [1, -1]) {
          const q = plAt(tr.pl, sd + sg * 8);
          const nx = -Math.sin(q.a), ny = Math.cos(q.a);
          const x = q.x + nx * sg * 9.4, y = q.y + ny * sg * 9.4;
          let ok = true;
          for (const k of [-36, 0, 36]) {
            const X = x + Math.cos(q.a) * k, Y = y + Math.sin(q.a) * k, ri = roadInfo(X, Y);
            if (nearBld(X, Y, 1) || inWaterRaw(X, Y) || (ri && ri.d < ri.road.w / 2 + G3.SW + 1)) { ok = false; break; }
          }
          if (!ok) continue;
          put('platform', x, y, -(q.a + (sg > 0 ? 0 : Math.PI)), 0);
          if (typeof addCollider === 'function') addCollider({ x, y, hx: 37.5, hy: 3.75, a: q.a, m: 2 });
          take(x, y, 14);
          n++;
        }
      }
    }
    stats.platform_n = n;
  }

  /* ---------- 第6段: 野立て看板（郊外の幹線沿い・広告アトラスを貼る） ---------- */
  function billboards(scene) {
    const rr = mulberry32(5604);
    const gb = new G3.GB(false);
    const NA = G3.adCount || 6;
    let n = 0;
    for (const r of ROADS) {
      if (r.kind !== 'main') continue;
      for (let d = 200 + rr() * 300; d < r.pl.len - 100; d += 420 + rr() * 300) {
        const sg = rr() < 0.5 ? 1 : -1;
        const p = at(r, d, sg * (r.w / 2 + G3.SW + 12));
        if (zoneOf(p.x, p.y) !== 'suburb') continue;
        if (inWaterRaw(p.x, p.y) || nearBld(p.x, p.y, 4) || !free(p.x, p.y, 10) || nearLM(p.x, p.y, 40) || railDist(p.x, p.y) < 15 ||
          FIELDS.some(f => p.x > f.x - 6 && p.x < f.x + f.w + 6 && p.y > f.y - 6 && p.y < f.y + f.h + 6)) continue;
        // 対向車線の車から見えるよう斜めに向ける
        const c = at(r, d - sg * 0, 0);
        const ang = Math.atan2(c.y - p.y, c.x - p.x) + (rr() < 0.5 ? 0.35 : -0.35);
        put('billboard', p.x, p.y, -ang, 0);
        if (typeof addCollider === 'function') for (const yy of [-3.5, 3.5]) addCollider({ x: p.x + U * (-0.3 * Math.cos(ang) + yy * Math.sin(ang)), y: p.y + U * (-0.3 * Math.sin(ang) - yy * Math.cos(ang)), r: 0.7 });
        // 看板面（+X 面、y:-5..5、z:4..8 m）
        const ai = (n + ((rr() * NA) | 0)) % NA;
        const v0 = 1 - (ai + 1) / NA, v1 = 1 - ai / NA;
        const W = (yy, z) => [p.x + U * (0.02 * Math.cos(ang) + yy * Math.sin(ang)), heightAt(p.x, p.y) + U * z, p.y + U * (0.02 * Math.sin(ang) - yy * Math.cos(ang))];
        // 正面から見て右 = モデルの +Y
        const Q = [W(-5, 4), W(5, 4), W(5, 8), W(-5, 8)], UV = [[0, v0], [1, v0], [1, v1], [0, v1]];
        const ux = Q[1][0] - Q[0][0], uz = Q[1][2] - Q[0][2], vy = Q[3][1] - Q[0][1];
        const nx = -uz * vy, nz = ux * vy;   // (u × v) の水平成分
        if (nx * Math.cos(ang) + nz * Math.sin(ang) > 0) gb.quad(Q, UV); else gb.quad([Q[1], Q[0], Q[3], Q[2]], [UV[0], UV[1], UV[2], UV[3]]);
        take(p.x, p.y, 14);
        n++;
      }
    }
    const m = gb.mesh(G3.world.WM.ad, false);
    scene.add(m);
    stats.billboard_n = n;
  }

  /* ---------- 第6段: 河川敷の運動場 ---------- */
  function riverside() {
    // 遊歩道の外側にベンチ（川向き）と公園灯を交互に
    if (typeof RIVERSIDE !== 'undefined') {
      let k = 0, nw = 0;
      for (const w of RIVERSIDE.walks) {
        const rv = RIVERS[w.ri];
        for (let d = w.d0 + 20; d < w.d1 - 10; d += 46) {
          const p = plAt(rv.pl, d), o = w.sg * (rv.w / 2 + 15.5), x = p.x - Math.sin(p.a) * o, y = p.y + Math.cos(p.a) * o;
          if (nearBld(x, y, 2) || !free(x, y, 1.5) || !clearOfRoad(x, y, 2)) continue;
          if (k++ % 2 === 0) put('bench', x, y, faceTo(x, y, p.x, p.y), 0); else put('park_lamp', x, y, 0, 0);
          take(x, y, 2); nw++;
        }
      }
      stats.riverwalk = nw;
    }
    const rr = mulberry32(5605);
    let nb = 0, ns = 0;
    for (const rv of RIVERS) {
      for (let d = 250; d < rv.pl.len - 250; d += 520 + rr() * 200) {
        const p = plAt(rv.pl, d);
        const sg = rr() < 0.5 ? 1 : -1, nx = -Math.sin(p.a) * sg, ny = Math.cos(p.a) * sg;
        const off = rv.w / 2 + 20;
        const x = p.x + nx * off, y = p.y + ny * off;
        const okAt = (X, Y) => { const ri = roadInfo(X, Y); return !(inWaterRaw(X, Y) || nearBld(X, Y, 3) || !free(X, Y, 8) || (ri && ri.d < ri.road.w / 2 + G3.SW + 6) || railDist(X, Y) < 15 ||
          FIELDS.some(f => X > f.x - 4 && X < f.x + f.w + 4 && Y > f.y - 4 && Y < f.y + f.h + 4)); };
        if ((nb + ns) % 2 === 0) {
          const e1 = [x - Math.cos(p.a) * 15, y - Math.sin(p.a) * 15], e2 = [x + Math.cos(p.a) * 15, y + Math.sin(p.a) * 15];
          const rdist = (X, Y) => { let m = 1e9; const q = rv.pl.pts; for (let i = 1; i < q.length; i++) m = Math.min(m, seg(X, Y, q[i - 1][0], q[i - 1][1], q[i][0], q[i][1]).d); return m; };
          let cross = false;   // 曲がった所で遊歩道に掛からないか（線上を全部見る）
          for (let k = -15; k <= 15; k += 3) if (rdist(x + Math.cos(p.a) * k, y + Math.sin(p.a) * k) < rv.w / 2 + 14) { cross = true; break; }
          if (cross || !okAt(x, y) || !free(e1[0], e1[1], 1.5) || !free(e2[0], e2[1], 1.5) || inWaterRaw(e1[0], e1[1]) || inWaterRaw(e2[0], e2[1])) continue;
          // 川と平行に立てる（遊歩道を横切らない）
          put('backstop', x, y, -(p.a + Math.PI / 2), 0);
          if (typeof addCollider === 'function') addCollider({ x, y, hx: 0.4, hy: 15, a: p.a + Math.PI / 2, m: 3 });
          take(x, y, 18); nb++;
        } else {
          const a = [x - Math.cos(p.a) * 50, y - Math.sin(p.a) * 50], b = [x + Math.cos(p.a) * 50, y + Math.sin(p.a) * 50];
          if (!okAt(a[0], a[1]) || !okAt(b[0], b[1]) || !okAt(x, y)) continue;
          put('soccer_goal', a[0], a[1], -(p.a + Math.PI), 0);
          put('soccer_goal', b[0], b[1], -p.a, 0);
          for (const q of [a, b]) take(q[0], q[1], 10);
          ns++;
        }
      }
    }
    stats.riverside = nb + ns;
  }


  /* ---------- 海岸: 消波ブロック・港の防波堤と灯台・護岸の胸壁 ---------- */
  const COAST_PORTS = [[1000, 1790, 230], [1330, 660, 230], [4482, 300, 160]];
  const C = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
  // 本土の海岸線（SEA の陸側の辺）に沿った点。n は海向き、t は辺の向き
  function coastSamples(step) {
    const out = [];
    for (let i = 4; i < SEA.length; i++) {
      const a = SEA[i - 1], b = SEA[i], L = hyp(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L;
      for (let d = step / 2; d < L; d += step) {
        const x = a[0] + tx * d, y = a[1] + ty * d;
        let nx = -ty, ny = tx;
        const w1 = inWaterRaw(x + nx * 6, y + ny * 6), w2 = inWaterRaw(x - nx * 6, y - ny * 6);
        if (w1 === w2) continue;            // 河口・島の陰など
        if (!w1) { nx = -nx; ny = -ny; }
        out.push({ x, y, nx, ny, tx, ty, e: i, d, L });
      }
    }
    return out;
  }
  // 回転した直方体（a=長手の向き、hl/hw=半長・半幅、y0..y1）
  function obox(gb, cx, cy, a, hl, hw, y0, y1, col) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (u, v, y) => [cx + ca * u - sa * v, y, cy + sa * u + ca * v];
    const q = (A, B, C2, D) => gb.quad([A, B, C2, D], [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => [u * hl / 3, v * (y1 - y0) / 3]), col);
    q(P(-hl, -hw, y0), P(hl, -hw, y0), P(hl, -hw, y1), P(-hl, -hw, y1));
    q(P(hl, hw, y0), P(-hl, hw, y0), P(-hl, hw, y1), P(hl, hw, y1));
    q(P(hl, -hw, y0), P(hl, hw, y0), P(hl, hw, y1), P(hl, -hw, y1));
    q(P(-hl, hw, y0), P(-hl, -hw, y0), P(-hl, -hw, y1), P(-hl, hw, y1));
    q(P(-hl, -hw, y1), P(hl, -hw, y1), P(hl, hw, y1), P(-hl, hw, y1));
  }
  function coastline(scene) {
    const rr = mulberry32(9201);
    const inPort = (x, y, m = 40) => COAST_PORTS.some(p => hyp(x - p[0], y - p[1]) < p[2] + m);
    const beach = (x, y) => hyp(x - 1160, y - 940) < 175;   // 梅津寺
    const nearKey = (x, y, r) => KEYPTS.some(k => hyp(k[0] - x, k[1] - y) < r);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(U, U, U);
    const tetra = (x, y, h) => {
      q.setFromEuler(e.set(rr() * TAU, rr() * TAU, rr() * TAU));
      putM('tetrapod', new THREE.Matrix4().compose(v.set(x, h, y).clone(), q.clone(), sc));
    };
    let nT = 0;
    // 1) 消波ブロック: 140 単位ごとに置く区間・置かない区間を決め、2列＋所々に上段
    let acc = 1e9, on = false;
    for (const p of coastSamples(4.6)) {
      if ((acc += 4.6) > 140) { acc = 0; on = rr() < 0.55; }
      if (!on || inPort(p.x, p.y) || beach(p.x, p.y)) continue;
      for (const [off, h] of [[3.6, -0.4], [8.4, -0.9]]) {
        const ox = p.x + p.nx * (off + (rr() - 0.5) * 1.4) + p.tx * (rr() - 0.5) * 1.6, oy = p.y + p.ny * (off + (rr() - 0.5) * 1.4) + p.ty * (rr() - 0.5) * 1.6;
        if (!inWaterRaw(ox, oy)) continue;
        tetra(ox, oy, h + (rr() - 0.5) * 0.8); nT++;
      }
      if (rr() < 0.35) { tetra(p.x + p.nx * 6, p.y + p.ny * 6, 1.6 + rr() * 0.6); nT++; }
    }
    // 2) 港の防波堤（入口をはさむ2本）と灯台。入港する船から見て右が赤灯台
    const gbB = new G3.GB(true);
    const cs = coastSamples(8);
    let nL = 0;
    for (const [px, py, rad] of COAST_PORTS) {
      let best = null, bd = 1e9;
      for (const p of cs) { const dd = hyp(p.x - px, p.y - py); if (dd < bd) { bd = dd; best = p; } }
      if (!best || bd > rad) continue;
      const n = [best.nx, best.ny], t = [best.tx, best.ty], gap = 50, La = 66;
      // 桟橋・ターミナル（ランドマークの敷地）から離し、船の出入りをふさがない沖に置く
      const farLM = (x, y) => LMS.every(l => !l.solid || (Math.max(l.solid[0] - x, 0, x - l.solid[2]) ** 2 + Math.max(l.solid[1] - y, 0, y - l.solid[3]) ** 2) > 70 * 70);
      let D = 0;
      for (const d0 of [110, 130, 150, 170, 95, 190]) {
        let ok = true;
        for (let s2 = -(gap / 2 + La); s2 <= gap / 2 + La && ok; s2 += 4) {
          const cx = best.x + n[0] * d0 + t[0] * s2, cy = best.y + n[1] * d0 + t[1] * s2;
          if (!farLM(cx, cy)) { ok = false; break; }
          for (const o of [-14, 0, 14]) if (!inWaterRaw(cx + n[0] * o, cy + n[1] * o)) { ok = false; break; }
        }
        if (ok) { D = d0; break; }
      }
      if (!D) continue;
      const ang = Math.atan2(t[1], t[0]);
      const red = [n[1], -n[0]];   // 入港方向 h=-n の右手（y が南向きの座標）
      for (const sgn of [-1, 1]) {
        const mid = gap / 2 + La / 2;
        const cx = best.x + n[0] * D + t[0] * sgn * mid, cy = best.y + n[1] * D + t[1] * sgn * mid;
        obox(gbB, cx, cy, ang, La / 2, 3.6, -3, 2.4, C('#b9b6ad'));
        obox(gbB, cx + n[0] * 3.0, cy + n[1] * 3.0, ang, La / 2, 0.7, 2.4, 4.0, C('#aeaba2'));   // 海側の胸壁
        // 海側に消波ブロック
        for (let s2 = -La / 2; s2 <= La / 2; s2 += 4.4) {
          const ox = cx + t[0] * s2 + n[0] * (8 + rr() * 2), oy = cy + t[1] * s2 + n[1] * (8 + rr() * 2);
          tetra(ox, oy, -0.6 + rr() * 0.8); nT++;
          if (rr() < 0.4) { tetra(ox - n[0] * 2.5, oy - n[1] * 2.5, 1.4 + rr() * 0.6); nT++; }
        }
        // 入口側の先端に灯台
        const ex = cx - t[0] * sgn * (La / 2 - 4), ey = cy - t[1] * sgn * (La / 2 - 4);
        const isRed = (t[0] * sgn * red[0] + t[1] * sgn * red[1]) > 0;
        put(isRed ? 'lighthouse_red' : 'lighthouse_white', ex, ey, -ang, 2.4);
        nL++;
      }
    }
    // 3) 護岸の胸壁（港・浜・河口・道路の所は切る）。高さ約0.9m、当たり判定つき
    const gbW = new G3.GB(true);
    let nW = 0;
    const wall = coastSamples(4).map(p => {
      const ix = p.x - p.nx * 1.0, iy = p.y - p.ny * 1.0;
      const ri = roadInfo(ix, iy);
      const ok = !inPort(p.x, p.y, 10) && !beach(p.x, p.y) && !inWaterRaw(ix, iy) && !nearBld(ix, iy, 1.5) &&
        !(ri && ri.d < ri.road.w / 2 + G3.SW + 1.5) && !nearKey(ix, iy, 6) && railDist(ix, iy) > 6;   // 歩道の上には置かない
      return { ...p, ix, iy, ok };
    });
    for (let i = 0; i < wall.length;) {
      if (!wall[i].ok) { i++; continue; }
      let j = i;
      while (j + 1 < wall.length && wall[j + 1].ok && wall[j + 1].e === wall[i].e) j++;
      const A = wall[i], B = wall[j];
      const ax = A.ix - A.tx * 2, ay = A.iy - A.ty * 2, bx = B.ix + B.tx * 2, by = B.iy + B.ty * 2;
      const L = hyp(bx - ax, by - ay), a = Math.atan2(by - ay, bx - ax), cx = (ax + bx) / 2, cy = (ay + by) / 2;
      if (L >= 8) {
        obox(gbW, cx, cy, a, L / 2, 0.6, 0, 2.3, C('#bcb9b0'));
        for (let d = 0; d < L; d += 24) {
          const e2 = Math.min(L, d + 24), m = (d + e2) / 2 - L / 2;
          if (typeof addCollider === 'function') addCollider({ x: cx + Math.cos(a) * m, y: cy + Math.sin(a) * m, hx: (e2 - d) / 2, hy: 0.8, a, m: 3 });
        }
        for (let d = 0; d < L; d += 5) take(ax + Math.cos(a) * d, ay + Math.sin(a) * d, 1.5);
        nW += L;
      }
      i = j + 1;
    }
    const cm = new THREE.MeshStandardMaterial({ map: G3.tex.concrete, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    const mb = gbB.mesh(cm, true), mw = gbW.mesh(cm, true);
    mb.receiveShadow = mw.receiveShadow = true;
    scene.add(mb, mw);
    stats.coast_tetra = nT; stats.lighthouse = nL; stats.seawall = Math.round(nW);
  }

  /* ---------- 第6段: 港のクレーン・小さな神社・農機具小屋・タクシー乗り場 ---------- */
  function cranes() {
    const rr = mulberry32(5606);
    let n = 0, last = [];
    for (const [x, y, nx, ny] of portCoast) {
      if (n >= 4 || rr() < 0.6) continue;
      const cx = x + nx * 12, cy = y + ny * 12;
      if (last.some(q => hyp(q[0] - cx, q[1] - cy) < 150) || nearBld(cx, cy, 4) || !free(cx, cy, 9) || propHit(cx, cy, 6, true)) continue;
      put('jib_crane', cx, cy, -Math.atan2(-ny, -nx), 0);
      if (typeof addCollider === 'function') addCollider({ x: cx, y: cy, hx: 7.5, hy: 7.5, a: Math.atan2(-ny, -nx), m: 3 });
      take(cx, cy, 10);
      last.push([cx, cy]);
      n++;
    }
  }
  function shrines() {
    const rr = mulberry32(5607);
    let n = 0;
    for (let t = 0; t < 3000 && n < 12; t++) {
      const x = 900 + rr() * 7400, y = 600 + rr() * 4600;
      if (zoneOf(x, y) !== 'suburb') continue;
      const ri = roadInfo(x, y);
      if (!ri || ri.road.kind === 'arcade' || ri.d < ri.road.w / 2 + G3.SW + 16 || ri.d > 60) continue;
      let ok = true;
      for (const [dx, dy] of [[0, 0], [14, 14], [-14, 14], [14, -14], [-14, -14]]) {
        const X = x + dx, Y = y + dy;
        if (inWaterRaw(X, Y) || hillAt(X, Y) || nearBld(X, Y, 2) || !free(X, Y, 5) || propHit(X, Y, 3, false) || railDist(X, Y) < 15 ||
          FIELDS.some(f => X > f.x - 3 && X < f.x + f.w + 3 && Y > f.y - 3 && Y < f.y + f.h + 3)) { ok = false; break; }
      }
      if (!ok || KEYPTS.some(k => hyp(k[0] - x, k[1] - y) < 26)) continue;
      const ang = Math.atan2(ri.y - y, ri.x - x);
      put('small_shrine', x, y, -ang, 0);
      const L = (u, v) => [x + U * (u * Math.cos(ang) + v * Math.sin(ang)), y + U * (u * Math.sin(ang) - v * Math.cos(ang))];
      if (typeof addCollider === 'function') {
        for (const v of [-1.3, 1.3]) { const q = L(4.5, v); addCollider({ x: q[0], y: q[1], r: 0.5 }); }
        const h = L(-1.5, 0); addCollider({ x: h[0], y: h[1], hx: 2.8, hy: 2.8, a: ang, m: 3 });
      }
      for (const v of [-2.4, 2.4]) { const q = L(3.2, v); put('stone_lantern', q[0], q[1], -ang, 0); }
      take(x, y, 16);
      n++;
    }
    stats.shrine_n = n;
  }
  function farmHuts() {
    const rr = mulberry32(5608);
    for (const f of FIELDS) {
      if (rr() > 0.22) continue;
      const cx = rr() < 0.5 ? f.x + 6 : f.x + f.w - 6, cy = rr() < 0.5 ? f.y + 7 : f.y + f.h - 7;
      if (nearBld(cx, cy, 2) || !free(cx, cy, 5)) continue;
      put('farm_hut', cx, cy, rr() < 0.5 ? 0 : Math.PI / 2, 0);
      take(cx, cy, 5);
    }
  }
  function taxiStands() {
    for (const [sx, sy] of [[4760, 3010], [5880, 3590]]) {
      const ri = roadInfo(sx, sy);
      if (!ri) continue;
      const r = ri.road, d0 = dOnPl(r.pl, sx, sy), c = at(r, d0, 0);
      const sg = ((sx - c.x) * -Math.sin(c.a) + (sy - c.y) * Math.cos(c.a)) > 0 ? 1 : -1;
      const sp = walkAt(r, sg, d0 - 8, 1.4);
      put('taxi_sign', sp.x, sp.y, -(sp.a + (sg > 0 ? 0 : Math.PI)), G3.CURB);
      if (typeof mkCar !== 'function') continue;
      for (let k = 0; k < 4; k++) {
        const q = at(r, d0 + k * 13, sg * (r.w / 2 - 3.6));
        if (parked.some(o => hyp(o.x - q.x, o.y - q.y) < 10) || r.junc.some(j => Math.abs(j.d - (d0 + k * 13)) < j.road.w / 2 + 6)) continue;
        parked.push(mkCar(q.x, q.y, q.a + (sg > 0 ? Math.PI : 0), 'taxi'));
      }
    }
  }

  /* ---------- 壊れる街具（破片の物理・消火栓の放水・時間が経つと元通り） ---------- */
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), _m = new THREE.Matrix4(), _I = new THREE.Matrix4();
  const debris = [], broken = [], fountains = [];
  let waterPts = null;
  function setInst(entry, M) {
    for (const im of entry.g.children) {
      if (!im.isInstancedMesh) continue;
      if (M) _m.multiplyMatrices(M, im.userData.local || _I);
      im.setMatrixAt(entry.li, M ? _m : ZERO);
      im.instanceMatrix.needsUpdate = true;
    }
  }
  function breakAt(c, vx, vy, spd) {
    const [name, idx] = c.bid.split('#');
    let entry, node;
    if (name === 'lamp' && G3.brkExtra && G3.brkExtra.lamp) {
      const L = G3.brkExtra.lamp;
      entry = { g: L.group, li: +idx, M: L.mats[+idx] };
      node = L.node;
    } else {
      entry = brkMap.get(c.bid);
      node = cnodes[name];
    }
    // 同じ物の当たり判定（複数あれば全部）を外す
    const sib = [];
    const R = 12, x0 = Math.floor((c.x - R) / PCELL), x1 = Math.floor((c.x + R) / PCELL), y0 = Math.floor((c.y - R) / PCELL), y1 = Math.floor((c.y + R) / PCELL);
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const a = propGrid.get(gy * 4096 + gx);
      if (a) for (const k of a) if (k.bid === c.bid && !k.broken) { k.broken = true; sib.push(k); }
    }
    c.broken = true; if (!sib.includes(c)) sib.push(c);
    if (!entry || !node) return;
    setInst(entry, null);
    // 破片（同じ形の複製を物理で飛ばす）
    const o = node.clone(true);
    entry.M.decompose(o.position, o.quaternion, o.scale);
    o.traverse(k => {
      if (!k.isMesh) return;
      k.castShadow = true;
      // 壊れた照明は消える
      const off = m => (m && /^(LampLight|VendLight|NightGlow)/.test(m.name)) ? Object.assign(m.clone(), { emissiveIntensity: 0 }) : m;
      k.material = Array.isArray(k.material) ? k.material.map(off) : off(k.material);
    });
    G3.scene.add(o);
    const sp = Math.min(1.4, spd / 160);
    const heavy = (BREAK[name] || 95) >= 70;
    const v = new THREE.Vector3(vx * (heavy ? 0.35 : 0.7) + (Math.random() - 0.5) * 10, (heavy ? 6 : 10) + Math.random() * 10 * sp,
      vy * (heavy ? 0.35 : 0.7) + (Math.random() - 0.5) * 10);
    const w = new THREE.Vector3(vy, 0, -vx);   // 進行方向に倒れる
    if (w.lengthSq() < 1e-6) w.set(1, 0, 0);
    w.normalize().multiplyScalar((heavy ? 2.5 : 4) + Math.random() * 5 * sp);
    w.y += (Math.random() - 0.5) * 3;
    debris.push({ o, v, w, rest: false, t: 0 });
    broken.push({ entry, sib, o, t: 0 });
    if (debris.length > 40) debris.shift();
    if (name === 'hydrant') startFountain(entry.M.elements[12], entry.M.elements[14]);
  }
  function startFountain(x, z) {
    ensureWater();
    fountains.push({ x, z, y: heightAt(x, z) + G3.CURB + 1.5, t: 25 });
    if (fountains.length > 3) fountains.shift();
  }
  function ensureWater() {
    if (!waterPts) {
      const n = 360, g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      waterPts = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xd8ecff, size: 0.75, map: G3.radialTex ? G3.radialTex() : null, transparent: true, opacity: 0.7, depthWrite: false, alphaTest: 0.02 }));
      waterPts.frustumCulled = false;
      waterPts.userData.p = Array.from({ length: n }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0 }));
      G3.scene.add(waterPts);
      waterPts.visible = false;
    }
  }
  const _q = new THREE.Quaternion(), _ax = new THREE.Vector3();
  function updDebris(dt) {
    for (const d of debris) {
      d.t += dt;
      if (d.rest) continue;
      d.v.y -= 30 * dt;
      d.o.position.addScaledVector(d.v, dt);
      const wl = d.w.length();
      if (wl > 1e-3) { _ax.copy(d.w).divideScalar(wl); _q.setFromAxisAngle(_ax, wl * dt); d.o.quaternion.premultiply(_q); }
      const g = G3.onSidewalkY ? G3.onSidewalkY(d.o.position.x, d.o.position.z) : heightAt(d.o.position.x, d.o.position.z);
      if (d.o.position.y < g) {
        d.o.position.y = g;
        d.v.y = Math.abs(d.v.y) * 0.25;
        d.v.x *= 0.55; d.v.z *= 0.55; d.w.multiplyScalar(0.55);
        if (d.v.lengthSq() < 4 && d.t > 0.4) d.rest = true;
      }
      if (d.t > 6) d.rest = true;
    }
    // 時間が経って離れたら元に戻す
    for (let i = broken.length - 1; i >= 0; i--) {
      const b = broken[i];
      b.t += dt;
      if (b.t < 80) continue;
      const dx = b.entry.M.elements[12] - S.px, dz = b.entry.M.elements[14] - S.py;
      if (dx * dx + dz * dz < 520 * 520) continue;
      setInst(b.entry, b.entry.M);
      for (const k of b.sib) k.broken = false;
      G3.scene.remove(b.o);
      const di = debris.findIndex(d => d.o === b.o); if (di >= 0) debris.splice(di, 1);
      broken.splice(i, 1);
    }
    // 消火栓の放水
    if (waterPts) {
      const P = waterPts.userData.p, arr = waterPts.geometry.attributes.position.array;
      for (let i = fountains.length - 1; i >= 0; i--) { fountains[i].t -= dt; if (fountains[i].t <= 0) fountains.splice(i, 1); }
      let k = 0, any = false;
      for (const p of P) {
        if (p.y < -900 || p.y < heightAt(p.x, p.z)) {
          const f = fountains.length ? fountains[(Math.random() * fountains.length) | 0] : null;
          if (f && Math.random() < 0.6) {
            p.x = f.x; p.z = f.z; p.y = f.y;
            const a = Math.random() * TAU, r = Math.random() * 3;
            p.vx = Math.cos(a) * r; p.vz = Math.sin(a) * r; p.vy = 34 + Math.random() * 10;
          } else p.y = -999;
        } else { p.vy -= 30 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
        if (p.y > -900) any = true;
        arr[k++] = p.x; arr[k++] = p.y; arr[k++] = p.z;
      }
      waterPts.geometry.attributes.position.needsUpdate = true;
      waterPts.visible = any;
    }
  }


  /* ---------- 夜の街明かり（追加の街灯と光だまり・店先の明かり） ---------- */
  const pools = [], shopGlow = [];
  let poolMesh = null, shopMat = null;
  function nightLights(scene) {
    const rr = mulberry32(5801);
    for (const r of ROADS) {
      if (r.kind === 'arcade' || r.kind === 'lane') continue;
      const cuts = G3.roadCuts(r);
      for (const [sg, cl] of [[1, cuts.cutsL], [-1, cuts.cutsR]]) {
        for (const [a, b] of G3.minusIntervals(r.pl.len, cl)) {
          for (let d = a + 18 + (sg > 0 ? 0 : 38); d < b - 10; d += 76) {
            const c0 = at(r, d, 0), z = zoneOf(c0.x, c0.y);
            if (z === 'suburb' && r.kind === 'minor') continue;
            const p = walkAt(r, sg, d, 0.9);
            if (!free(p.x, p.y, 4)) continue;
            put('xlamp', p.x, p.y, roadFace(r, sg, d, p), G3.CURB);
            take(p.x, p.y, 2);
            const q = at(r, d, sg * (r.w / 2 - 4));
            pools.push([q.x, q.y, 17]);
          }
        }
      }
    }
    for (const l of LAMPS) { const ri = roadInfo(l[0], l[1]); if (ri) pools.push([lerp(l[0], ri.x, 0.35), lerp(l[1], ri.y, 0.35), 18]); }
    // 商店街はアーケードの照明で明るい
    for (const r of ROADS) {
      if (r.kind !== 'arcade') continue;
      for (let d = 6; d < r.pl.len - 4; d += 15) for (const o of [-r.w / 4, r.w / 4]) { const q = at(r, d, o); pools.push([q.x, q.y, 12]); }
    }
    const gb = new G3.GB(false);
    for (const [x, y, s2] of pools) {
      const yy = heightAt(x, y) + 0.14;
      gb.quad([[x - s2, yy, y + s2], [x + s2, yy, y + s2], [x + s2, yy, y - s2], [x - s2, yy, y - s2]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    poolMesh = gb.mesh(G3.world.WM.lampGlow, false);
    poolMesh.renderOrder = 2;
    scene.add(poolMesh);
  }
  // 店先から歩道へこぼれる明かり（夜だけ）
  function shopLights(scene) {
    const gb = new G3.GB(false);
    for (const b of buildings) {
      if (b.noDraw || !(b.kind === 'shop' || (b.kind === 'office' && b.seed % 2 && b.hgt <= 4))) continue;
      const f = frontOf(b), len = faceLen(b, f);
      const A = wallPt(b, f, 0, 0.2), B = wallPt(b, f, 1, 0.2), A2 = wallPt(b, f, 0, 9), B2 = wallPt(b, f, 1, 9);
      const y = heightAt((A.x + B.x) / 2, (A.y + B.y) / 2) + 0.42;
      const P = [[A.x, y, A.y], [B.x, y, B.y], [B2.x, y, B2.y], [A2.x, y, A2.y]];
      const nyv = (P[1][2] - P[0][2]) * (P[3][0] - P[0][0]) - (P[1][0] - P[0][0]) * (P[3][2] - P[0][2]);
      const uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
      if (nyv > 0) gb.quad(P, uv); else gb.quad([P[0], P[3], P[2], P[1]], [uv[0], uv[3], uv[2], uv[1]]);
    }
    const tex = G3.world.canvasTex(64, 64, g => {
      const gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.15, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      const g2 = g.createLinearGradient(0, 0, 64, 0);
      g.globalCompositeOperation = 'destination-in';
      g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(0.12, 'rgba(0,0,0,1)'); g2.addColorStop(0.88, 'rgba(0,0,0,1)'); g2.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = g2; g.fillRect(0, 0, 64, 64);
    });
    shopMat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffe2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -90 });
    const m = gb.mesh(shopMat, false);
    m.renderOrder = 2;
    scene.add(m);
  }


  /* ---------- 路地: 電柱と電線・止まれ標識・カーブミラー・中心部は小さな街灯 ---------- */
  function laneFurniture(scene) {
    const rr = mulberry32(8201);
    const wire = [];
    for (const r of ROADS) {
      if (r.kind !== 'lane') continue;
      const sgPole = rr() < 0.5 ? 1 : -1;
      let prev = null;
      for (let d = 12 + rr() * 20; d < r.pl.len - 8; d += 55 + rr() * 12) {
        if (r.junc.some(j => Math.abs(j.d - d) < j.road.w / 2 + 4)) { prev = null; continue; }
        const p = walkAt(r, sgPole, d, 1.4);
        if (!free(p.x, p.y, 1.2) || nearBld(p.x, p.y, 0.6)) { prev = null; continue; }
        put('xpole', p.x, p.y, -(p.a + (sgPole > 0 ? Math.PI : 0)), 0);
        take(p.x, p.y, 1.5);
        const top = heightAt(p.x, p.y) + 21.5;
        if (prev) for (const off of [-2.2, 0, 2.2]) {
          const nx = Math.cos(p.a), ny = Math.sin(p.a), ox = -ny * off, oy = nx * off;
          let px = prev[0] + ox, py = prev[1], pz = prev[2] + oy;
          for (let k = 1; k <= 6; k++) {
            const t = k / 6, x = lerp(prev[0], p.x, t) + ox, z = lerp(prev[2], p.y, t) + oy, y = lerp(prev[1], top, t) - Math.sin(t * Math.PI) * 1.4;
            wire.push(px, py, pz, x, y, z); px = x; py = y; pz = z;
          }
        }
        prev = [p.x, top, p.y];
        const z = zoneOf(p.x, p.y);
        if ((z === 'center' || z === 'dogo') && rr() < 0.5) {
          const q = walkAt(r, -sgPole, d + 20, 1.2);
          if (free(q.x, q.y, 1.2) && !nearBld(q.x, q.y, 0.6)) { put('xlamp', q.x, q.y, roadFace(r, -sgPole, d + 20, q), 0); take(q.x, q.y, 1.2); }
        }
      }
      // 大きな道に出る手前の止まれ標識と、見通しの悪い角のカーブミラー
      for (const j of r.junc) {
        if (j.road.kind === 'arcade') continue;
        const atEnd = j.d < 12 ? 1 : j.d > r.pl.len - 12 ? -1 : 0;
        for (const dir of atEnd ? [-atEnd] : [1, -1]) {
          const back = j.road.w / 2 + (j.road.kind === 'lane' ? 2 : G3.SW + 3);
          const d = j.d - dir * back;
          if (d < 2 || d > r.pl.len - 2) continue;
          const p = at(r, d, -dir * (r.w / 2 + 1.2));
          if (j.road.kind !== 'lane' && free(p.x, p.y, 1.2) && !nearBld(p.x, p.y, 0.5)) {
            put('sign_stop', p.x, p.y, faceRot(p.a + (dir > 0 ? Math.PI : 0)), 0); take(p.x, p.y, 1.2);
          }
          if (rr() < 0.55) {
            const m = at(r, d, dir * (r.w / 2 + 1.2)), pj = at(r, j.d, 0);
            if (free(m.x, m.y, 1.2) && !nearBld(m.x, m.y, 0.5)) { put('curve_mirror', m.x, m.y, -Math.atan2(pj.y - m.y, pj.x - m.x), 0); take(m.x, m.y, 1.2); }
          }
        }
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x23262a, transparent: true, opacity: 0.75 })));
  }


  /* ---------- 住宅の庭（芝生・砂利・駐車スペース）: 家のまわりの地面 ---------- */
  function houseYards(scene) {
    const gbG = new G3.GB(true);
    const rr = mulberry32(8301);
    const cols = [[0.42, 0.55, 0.30], [0.47, 0.58, 0.34], [0.62, 0.60, 0.55], [0.58, 0.55, 0.50]];
    for (const b of buildings) {
      const wh = b.sty === 'warehouse';
      if (b.noDraw || (b.kind !== 'house' && !wh)) continue;
      const m = wh ? 7 : 4.6;
      const x0 = b.x0 - m, x1 = b.x1 + m, y0 = b.y0 - m, y1 = b.y1 + m;
      let ok = true;
      for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) if (!clearOfRoad(x, y, 0.3) || inWaterRaw(x, y)) { ok = false; break; }
      if (!ok) continue;
      const c = wh ? [0.7, 0.7, 0.68] : cols[(rr() * cols.length) | 0];   // 倉庫は土間コンクリート
      const yy = heightAt((x0 + x1) / 2, (y0 + y1) / 2) + 0.04;
      gbG.quad([[x0, yy, y1], [x1, yy, y1], [x1, yy, y0], [x0, yy, y0]], [[x0 / 8, y1 / 8], [x1 / 8, y1 / 8], [x1 / 8, y0 / 8], [x0 / 8, y0 / 8]], c);
    }
    let tx = G3.tex.gravel || null;
    if (tx) { tx = tx.clone(); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.needsUpdate = true; }
    const mat = new THREE.MeshStandardMaterial({ map: tx, vertexColors: true, roughness: 0.95,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
    const mesh = gbG.mesh(mat, false);
    mesh.castShadow = false;
    scene.add(mesh);
  }

  /* ---------- インスタンス化 ---------- */
  const cnodes = {}, brkMap = new Map();
  // 倉庫横のコンテナは港のもの（遠くから見える）と分けて、近くだけ描く
  const NODE_ALIAS = { xlamp: ['props', 'lamp'], xpole: ['props', 'pole'], wcont_a: ['street', 'container_b'], wcont_b: ['street', 'container_a'], wcont_c: ['street', 'container_c'] };
  let blockMat = null;
  function streetMat(m) {
    if (m && m.name === 'SP_BlockTex') {
      if (!blockMat) {
        const t = G3.world.canvasTex(128, 128, g => {
          g.fillStyle = '#8f8c84'; g.fillRect(0, 0, 128, 128);
          const blk = (x, y, w, h) => { g.fillStyle = '#bdbab1'; g.fillRect(x + 2, y + 2, w - 4, h - 4); g.fillStyle = 'rgba(0,0,0,.05)'; g.fillRect(x + 2, y + h / 2, w - 4, h / 2 - 2); };
          blk(0, 0, 64, 64); blk(64, 0, 64, 64); blk(-32, 64, 64, 64); blk(32, 64, 64, 64); blk(96, 64, 64, 64);
        });
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false;
        blockMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92 });
      }
      return blockMat;
    }
    return G3.lmMat(m);
  }
  // 種類ごとの描画距離（これより遠いチャンクは描かない）。大物は常に描く。
  const FAR = { guide_gantry: 1e9, tram_stop: 2200, karakuri_clock: 1e9, arcade_gate_okaido: 1600, arcade_gate_gintengai: 1600, arcade_gate_dogo: 1600, container_a: 2400, container_b: 2400, container_c: 2400, container_d: 2400, weed_a: 260, weed_b: 260, drainpipe: 700, meter_box: 300, laundry: 700, stair_flight: 900, tenant_a: 1400, tenant_b: 1400, tenant_c: 1400, shrub_a: 600, shrub_b: 600, niwaki: 1000, lighthouse_red: 3000, lighthouse_white: 3000, tetrapod: 650, wcont_a: 700, wcont_b: 700, wcont_c: 700, gs_canopy: 1600, gs_sign: 1600, fishing_boat: 1800,
    catenary_pole: 1100, park_toilet: 1000, solar_panel: 900, tv_antenna: 700, bus_shelter: 1000,
    guardrail: 1300, guard_pipe: 1000, hedge_planter: 1200, block_wall: 1000, awning_red: 1100, awning_green: 1100, awning_blue: 1100, awning_orange: 1100,
    sign_speed: 900, sign_stop: 900, curve_mirror: 900, parking_sign: 1200, clock_pole: 1400, map_board: 900 };
  const FAR_DEF = 430;
  Object.assign(FAR, { konbini: 1500, konbini_sign: 1500, pylon: 1e9, ob_stair: 1400, platform: 1400, billboard: 1800, backstop: 1200,
    soccer_goal: 900, jib_crane: 2400, small_shrine: 1000, farm_hut: 1000 });
  // 影を落とすのは大きな物だけ（小物は影のパスの描画回数を増やすだけ）
  const SHADOW = /konbini|pylon|ob_stair|platform|billboard|crane|shrine|farm_hut|backstop|wall|fence|awning|booth|container|wcont|lighthouse|canopy|gs_|tram_stop|guide|karakuri|toilet|shelter|hedge|guardrail|gantry|catenary|boat|lantern|jungle|slide|swing|vending|map_board/;
  Object.assign(FAR, { bicycle_a: 330, bicycle_b: 330, bicycle_c: 330, ac_unit: 380, potted_plant: 300, propane: 380, tv_antenna: 500,
    block_wall: 700, guard_pipe: 650, guardrail: 900, hedge_planter: 800, awning_red: 800, awning_green: 800, awning_blue: 800, awning_orange: 800,
    xlamp: 900, hydrant: 300, hydrant_sign: 380, stand_sign: 330, nobori_a: 450, nobori_b: 450, nobori_c: 450, nobori_d: 450, nobori_e: 450 });
  const CH = 650;   // チャンク一辺（ゲーム単位 = 260m）
  const chunks = [];
  // 単色マテリアルの部品を頂点カラー1枚（金属は別に1枚）にまとめて描画回数を減らす
  const plainMats = {};
  function collapse(node) {
    node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    const groups = { plain: [], metal: [] }, keep = [];
    const rough = { plain: [], metal: [] };
    node.traverse(o => {
      if (!o.isMesh) return;
      const m = o.material;
      const n = (m && m.name) || '';
      const special = Array.isArray(m) || m.map || m.transparent || m.alphaTest > 0 || /^(NightGlow|Lamp|Vend|GuideFace|SP_BlockTex|Xing|Sig)/.test(n) ||
        (m.emissive && m.emissive.getHex() !== 0 && m.emissiveIntensity > 0);
      const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      if (special) { keep.push([o, rel]); return; }
      let g = o.geometry.clone();
      g.applyMatrix4(rel);
      if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      const c = m.color || new THREE.Color(1, 1, 1), cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
      for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const key = (m.metalness || 0) > 0.5 ? 'metal' : 'plain';
      groups[key].push(g); rough[key].push(m.roughness == null ? 0.6 : m.roughness);
    });
    const out = new THREE.Group();
    for (const key of ['plain', 'metal']) {
      if (!groups[key].length) continue;
      const geo = T3.mergeGeometries(groups[key], false);
      if (!geo) continue;
      const r = rough[key].reduce((a, b) => a + b, 0) / rough[key].length;
      const mk = key + Math.round(r * 10);
      const mat = plainMats[mk] || (plainMats[mk] = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: r, metalness: key === 'metal' ? 0.75 : 0.05 }));
      out.add(new THREE.Mesh(geo, mat));
    }
    for (const [o, rel] of keep) {
      const mm = new THREE.Mesh(o.geometry, o.material);
      mm.matrixAutoUpdate = false;
      mm.matrix.copy(rel);
      out.add(mm);
    }
    out.updateMatrixWorld(true);
    return out;
  }
  function flush(scene) {
    const tmpV = new THREE.Vector3();
    for (const name in lists) {
      const node = NODE_ALIAS[name] ? G3.glbNode(...NODE_ALIAS[name]) : G3.glbNode('street', name);
      stats[name] = lists[name].length;
      if (!node) continue;
      node.traverse(c => { if (c.isMesh) c.material = Array.isArray(c.material) ? c.material.map(streetMat) : streetMat(c.material); });
      const cnode = collapse(node);
      cnodes[name] = cnode;
      const groups = new Map();
      for (const M of lists[name]) {
        const k = Math.floor(M.elements[12] / CH) + ',' + Math.floor(M.elements[14] / CH);
        (groups.get(k) || groups.set(k, []).get(k)).push(M);
      }
      const far = (FAR[name] || FAR_DEF) * (matchMedia('(pointer:coarse)').matches ? 0.7 : 1);
      const all = [];
      for (const [k, mats] of groups) {
        const g = G3.instanceNode(cnode, mats, { shadow: SHADOW.test(name) });
        if (BREAK[name]) mats.forEach((M, li) => brkMap.set(name + '#' + M.__i, { g, li, M }));
        g.traverse(o => { if (o.isInstancedMesh) { o.computeBoundingSphere(); o.frustumCulled = true; } });
        let cx = 0, cz = 0, rad = 0;
        for (const M of mats) { cx += M.elements[12]; cz += M.elements[14]; }
        cx /= mats.length; cz /= mats.length;
        for (const M of mats) rad = Math.max(rad, Math.hypot(M.elements[12] - cx, M.elements[14] - cz));
        chunks.push({ g, x: cx, z: cz, far: far + rad + 10 });
        for (const M of mats) all.push([M.elements[12], M.elements[14]]);
        scene.add(g);
      }
      const tag = new THREE.Object3D();
      tag.name = 'street_' + name; tag.userData.pos = all; tag.visible = false;
      scene.add(tag);
    }
    lists = {};
  }
  let upT = 0;
  function update(dt) {
    updCrossings(dt);
    updDebris(dt);
    if (shopMat) shopMat.opacity = clamp(1 - G3.day * 1.6, 0, 1) * 0.55;
    upT -= dt;
    if (upT > 0) return;
    upT = 0.25;
    const c = G3.camera.position;
    for (const k of chunks) {
      const dx = k.x - c.x, dz = k.z - c.z;
      k.g.visible = dx * dx + dz * dz < k.far * k.far;
    }
  }






  /* ---------- 建物の外まわり: 竪樋・メーター・アパートの外階段・テナントの縦看板・ベランダの洗濯物 ---------- */
  function exteriors() {
    const rr = mulberry32(9801);
    const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const n = { pipe: 0, meter: 0, stair: 0, tenant: 0, laundry: 0 };
    const FL = FLOORH;
    for (const b of buildings) {
      if (b.noDraw) continue;
      const top = b.hW, nf = b.sty === 'machiya' ? 1 : b.hgt, gH = Math.max(6, top - FL * nf), f = frontOf(b);
      // 竪樋: 建物の角（1〜2本）。屋根の高さまで縦に伸ばす
      for (const [ff, t] of [[(f + 1) % 4, 0.02], [(f + 3) % 4, 0.98]].slice(0, b.kind === 'house' ? 1 : 2)) {
        const w = wallPt(b, ff, t, 0.05);
        if (!clearOfRoad(w.x, w.y, -0.5)) continue;
        q.setFromEuler(e.set(0, w.rot, 0)); sc.set(U, top - 0.6, U);
        putM('drainpipe', new THREE.Matrix4().compose(v.set(w.x, heightAt(w.x, w.y), w.y).clone(), q.clone(), sc.clone())); n.pipe++;
      }
      // 戸建て: 横の壁にメーター
      if (b.kind === 'house' && b.sty !== 'warehouse') {
        const sf = (f + (b.seed % 2 ? 3 : 1)) % 4, w = wallPt(b, sf, 0.2 + rr() * 0.2, 0.02);
        if (free(w.x, w.y, 0.6)) { put('meter_box', w.x, w.y, w.rot, 0); n.meter++; }
      }
      // 低層のアパート（マンション・団地で3階まで）: 端の壁に鉄骨の外階段を各階に
      if ((b.kind === 'mansion') && b.hgt <= 3) {
        const ef = (f + 1) % 4, w = wallPt(b, ef, 0.5, 0);
        if (faceLen(b, ef) > 14 && clearOfRoad(w.x, w.y, 3) && !overlapsOther(b, w.x, w.y, 4) && free(w.x, w.y, 2)) {
          // 1階分は 2.8m の階段なので、最初の1本は1階の高さ（gH）まで縦に伸ばし、当たり判定は足元の箱で
          q.setFromEuler(e.set(0, w.rot, 0)); sc.set(U, U * gH / 7, U);
          putM('stair_flight', new THREE.Matrix4().compose(v.set(w.x, heightAt(w.x, w.y), w.y).clone(), q.clone(), sc.clone()));
          const ox = Math.cos(-w.rot), oy = Math.sin(-w.rot);   // 外向き
          if (typeof addCollider === 'function') addCollider({ x: w.x + ox * 0.6 * U, y: w.y + oy * 0.6 * U, hx: 0.55 * U, hy: 2.1 * U, a: -w.rot, m: 3 });
          for (let k = 1; k < b.hgt; k++) put('stair_flight', w.x, w.y, w.rot, gH + (k - 1) * FL);
          take(w.x, w.y, 4); n.stair++;
        }
      }
      // 事務所ビル（4階以上）: 正面の角に縦型のテナント看板
      if (b.kind === 'office' && b.hgt >= 4 && top - gH > 20 && rr() < 0.6) {
        const w = wallPt(b, f, rr() < 0.5 ? 0.08 : 0.92, 0);
        put('tenant_' + 'abc'[b.seed % 3], w.x, w.y, w.rot, gH + 1); n.tenant++;
      }
      // マンションのベランダ（正面）に洗濯物
      if (b.kind === 'mansion' && b.sty !== 'danchi') {
        const len = faceLen(b, f), bays = Math.max(1, Math.floor(len / 9));
        for (let k = 1; k < nf; k++) for (let i = 0; i < bays; i++) {
          if (rr() > 0.28) continue;
          const w = wallPt(b, f, (i + 0.5) / bays, 1.1);
          put('laundry', w.x, w.y, w.rot, gH + k * FL); n.laundry++;
        }
      }
    }
    stats.exteriors = n;
  }

  /* ---------- 緑: 家の庭の植え込みと松、路地の端・電柱の根元の雑草 ---------- */
  function greenery() {
    const rr = mulberry32(9702);
    let ns = 0, nw = 0, np = 0;
    for (const b of buildings) {
      if (b.noDraw || b.kind !== 'house' || b.sty === 'warehouse') continue;
      const f = frontOf(b), sf = (f + (b.seed % 2 ? 1 : 3)) % 4;
      const tryPut = (name, q, m) => {
        if (inWaterRaw(q.x, q.y) || !clearOfRoad(q.x, q.y, 1) || overlapsOther(b, q.x, q.y, 2) || !free(q.x, q.y, m)) return false;
        put(name, q.x, q.y, rr() * TAU, 0); take(q.x, q.y, m); return true;
      };
      for (const t of [0.1, 0.9]) if (rr() < 0.55 && tryPut(rr() < 0.5 ? 'shrub_a' : 'shrub_b', wallPt(b, f, t, 2.4), 1.6)) ns++;
      if (rr() < 0.35 && tryPut('niwaki', wallPt(b, sf, 0.35 + rr() * 0.3, 3.2), 2.4)) np++;
    }
    // 路地の両端（塀や家の際）に雑草
    for (const r of ROADS) {
      if (r.kind !== 'lane') continue;
      for (const sg of [1, -1]) for (let d = 3; d < r.pl.len - 3; d += 2.5 + rr() * 3) {
        if (rr() < 0.5) continue;
        const q = at(r, d, sg * (r.w / 2 - 0.25 + rr() * 0.6));
        const ri = roadInfo(q.x, q.y);
        if ((ri && ri.road !== r && ri.d < ri.road.w / 2 + 3) || !free(q.x, q.y, 0.4)) continue;
        put(rr() < 0.7 ? 'weed_a' : 'weed_b', q.x, q.y, rr() * TAU, 0); nw++;
      }
    }
    // 電柱の根元
    for (const p of POLES) for (let k = 0; k < 2; k++) {
      const a = rr() * TAU, x = p.x + Math.cos(a) * 1.4, y = p.y + Math.sin(a) * 1.4;
      if (inWaterRaw(x, y)) continue;
      put('weed_a', x, y, rr() * TAU, 0); nw++;
    }
    stats.greenery = { shrubs: ns, pines: np, weeds: nw };
  }

  /* ---------- 漁港（堀江・三津浜）: 魚市場・漁協・岸壁の網・浮き玉・トロ箱・ドラム缶 ---------- */
  const HARBORS = [[4482, 300, 170], [1000, 1790, 240]];
  const inHarbor = (x, y) => HARBORS.some(h => hyp(x - h[0], y - h[1]) < h[2]);
  function fishingHarbor() {
    const rr = mulberry32(9601);
    const ok = (x, y, m) => {
      if (inWaterRaw(x, y) || nearBld(x, y, 2) || !free(x, y, m) || nearLM(x, y, 12) || propHit(x, y, m, true)) return false;
      const ri = roadInfo(x, y);
      if (ri && ri.d < ri.road.w / 2 + G3.SW + 1) return false;
      return !KEYPTS.some(k => hyp(k[0] - x, k[1] - y) < m + 6);
    };
    const rectOk = (cx, cy, ta, hw, hd) => {
      for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, 0, 1]) {
        const x = cx + Math.cos(ta) * u * hw + Math.sin(ta) * v * hd, y = cy + Math.sin(ta) * u * hw - Math.cos(ta) * v * hd;
        if (!ok(x, y, 3)) return false;
      }
      return true;
    };
    let nm = 0, ng = 0, ngear = 0;
    for (const [hx, hy, rad] of HARBORS) {
      const cs = portCoast.filter(c => hyp(c[0] - hx, c[1] - hy) < rad).sort((a, b) => hyp(a[0] - hx, a[1] - hy) - hyp(b[0] - hx, b[1] - hy));
      // 岸壁沿いは道路が通っているので、港の中で空いている所を海に近い順に探す。向きは最寄りの岸壁に合わせる
      const nearCoast = (x, y) => { let b = null, bd = 1e9; for (const c of cs) { const d = hyp(c[0] - x, c[1] - y); if (d < bd) { bd = d; b = c; } } return [b, bd]; };
      const cand = [];
      for (let x = hx - rad; x <= hx + rad; x += 6) for (let y = hy - rad; y <= hy + rad; y += 6) {
        if (hyp(x - hx, y - hy) > rad || inWaterRaw(x, y)) continue;
        const [c, d] = nearCoast(x, y);
        if (c && d < 110) cand.push([x, y, c, d]);
      }
      cand.sort((a, b) => a[3] - b[3]);
      let market = null;
      for (const [cx, cy, c] of cand) {
        const ta = Math.atan2(c[2], -c[3]);   // 長い辺を岸壁と平行に、海側を -Y に
        if (!rectOk(cx, cy, ta, 32, 17)) continue;
        put('fish_market', cx, cy, -ta, 0);
        for (let u = -30; u <= 30; u += 6) for (const v of [-14, 0, 14]) take(cx + Math.cos(ta) * u + Math.sin(ta) * v, cy + Math.sin(ta) * u - Math.cos(ta) * v, 4);
        market = [cx, cy]; nm++; break;
      }
      // 漁協の事務所（市場から少し離して、正面を海へ）
      for (const [cx, cy, c] of cand) {
        if (market && hyp(cx - market[0], cy - market[1]) < 50) continue;
        const ta = Math.atan2(-c[2], c[3]);
        if (!rectOk(cx, cy, ta, 11, 9)) continue;
        put('gyokyo', cx, cy, -ta, 0); take(cx, cy, 13); ng++; break;
      }
      // 岸壁の網・浮き玉・トロ箱・ドラム缶
      const GEAR = ['net_pile', 'buoy_stack', 'fish_crates', 'drum_set', 'net_pile', 'fish_crates'];
      for (const [x, y, nx, ny] of cs) for (const along of [-6, 5]) {
        if (rr() < 0.4) continue;
        const off = 4.5 + rr() * 4, tx = -ny, ty = nx, gx = x + nx * off + tx * along, gy = y + ny * off + ty * along;
        if (!ok(gx, gy, 2.5)) continue;
        put(GEAR[(rr() * GEAR.length) | 0], gx, gy, -Math.atan2(ty, tx) + (rr() - 0.5) * 0.6, 0); take(gx, gy, 3); ngear++;
      }
    }
    stats.harbor = { market: nm, gyokyo: ng, gear: ngear };
  }

  /* ---------- 道後公園（湯築城跡）: 武家屋敷（土塀・門・母屋・土蔵）、本壇の東屋、石碑、園路のベンチと灯籠 ---------- */
  function yuzuki() {
    if (typeof YUZUKI === 'undefined') return;
    const Y = YUZUKI, [ox, oy, X1, Y1] = Y.compound;   // 屋敷の土塀の矩形
    // 土塀（東面の中央に門）
    for (let x = ox + 5; x <= X1 - 4; x += 9.5) { put('dobei', x, oy, 0, 0); put('dobei', x, Y1, 0, 0); }
    for (let y = oy + 4.5; y <= Y1 - 4; y += 9) put('dobei', ox, y, -Math.PI / 2, 0);
    for (const y of [oy + 4.5, oy + 9, Y1 - 9, Y1 - 4.5]) put('dobei', X1, y, -Math.PI / 2, 0);
    put('dobei_gate', X1, (oy + Y1) / 2, 0, 0);
    put('buke_house', 7378, 2586, -Math.PI, 0);       // 縁側は南の庭へ
    put('buke_kura', 7372, 2604, 0, 0);               // 土蔵は奥（南西の隅）。門から庭へは広く空ける
    for (const [x, y] of [[ox, oy], [X1, Y1], [ox, Y1], [X1, oy]]) take(x, y, 3);
    for (let x = ox; x <= X1; x += 5) for (let y = oy; y <= Y1; y += 5) take(x, y, 3.5);
    // 本壇の上の東屋
    const h = Y.hill;
    put('azumaya', h.x, h.y, 0, 0); take(h.x, h.y, 8);
    // 北の入口の石碑と灯籠
    const g0 = Y.gaps.reduce((b, g) => (Math.sin(g) < Math.sin(b) ? g : b), Y.gaps[0]);   // いちばん北の切れ目
    const sp = [Y.x + Math.cos(g0 + 0.13) * 74, Y.y + Math.sin(g0 + 0.13) * 74];
    put('sekihi', sp[0], sp[1], -(g0 + Math.PI), 0); take(sp[0], sp[1], 3);
    for (const g of Y.gaps) for (const r of [62, 50]) for (const s of [1, -1]) {
      const a = g + s * 5.5 / r, x = Y.x + Math.cos(a) * r, y = Y.y + Math.sin(a) * r;
      if (free(x, y, 2.5) && !nearBld(x, y, 2)) { put('stone_lantern', x, y, 0, 0); take(x, y, 2); }
    }
    // 一周する園路のベンチ（内向き）
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * TAU + 0.26, x = Y.x + Math.cos(a) * 81, y = Y.y + Math.sin(a) * 81;
      if (Y.gaps.some(g => Math.abs(angDiff(g, a)) < 0.25) || !free(x, y, 3) || nearBld(x, y, 2)) continue;
      put('bench', x, y, faceTo(x, y, Y.x, Y.y), 0); take(x, y, 2);
    }
  }

  /* ---------- アーケード（大街道・銀天街・道後ハイカラ通り）: 入口の看板・吊り看板・フラッグ・中央のベンチと植え込み・店頭ワゴン ---------- */
  const ARC_GATE = { '大街道': 'arcade_gate_okaido', '銀天街': 'arcade_gate_gintengai', '道後商店街': 'arcade_gate_dogo' };
  function arcades() {
    const rr = mulberry32(9501);
    const arcs = ROADS.filter(r => r.kind === 'arcade');
    let ng = 0, nh = 0, nw = 0;
    for (const r of arcs) {
      // 入口の看板（ほかのアーケードとつながる端には付けない）
      for (const end of [0, 1]) {
        const ep = r.pts[end ? r.pts.length - 1 : 0];
        if (arcs.some(o => o !== r && [o.pts[0], o.pts[o.pts.length - 1]].some(q => hyp(q[0] - ep[0], q[1] - ep[1]) < 12))) continue;
        const d = end ? r.pl.len - 2.5 : 2.5, p = plAt(r.pl, d), out = p.a + (end ? 0 : Math.PI);
        if (ARC_GATE[r.n]) { put(ARC_GATE[r.n], p.x, p.y, -out, 0); ng++; }
      }
      // 吊り看板（左右交互）とフラッグ（中央）
      let k = (rr() * 8) | 0;
      for (let d = 12; d < r.pl.len - 10; d += 17 + rr() * 4) {
        const sg = (k % 2) ? 1 : -1, q = at(r, d, sg * (r.w / 2 - 3.2));
        put('hang_sign_' + 'abcdefgh'[k % 8], q.x, q.y, -q.a, 0); k += 3; nh++;
      }
      for (let d = 20; d < r.pl.len - 14; d += 34) { const q = at(r, d, 0); put('arcade_flag', q.x, q.y, -q.a, 0); }
      // 中央の植え込みとベンチ（外の店の方を向く）
      for (let d = 28; d < r.pl.len - 20; d += 38) {
        const q = at(r, d, 0);
        if (!free(q.x, q.y, 4)) continue;
        put('planter_box', q.x, q.y, -q.a, 0); take(q.x, q.y, 3);
        for (const sg of [1, -1]) { const b = at(r, d, sg * 2.6); put('bench', b.x, b.y, -(q.a + sg * Math.PI / 2), 0); take(b.x, b.y, 2); }
      }
      // 店頭ワゴン（柱と重ならない所）
      for (let d = 8; d < r.pl.len - 6; d += 11 + rr() * 9) {
        if (rr() < 0.45) continue;
        const sg = rr() < 0.5 ? 1 : -1, q = at(r, d, sg * (r.w / 2 - 1.1));
        if (propHit(q.x, q.y, 1.6, false) || !free(q.x, q.y, 1.5)) continue;
        put('shop_wagon', q.x, q.y, -(q.a + Math.PI / 2), 0.12); take(q.x, q.y, 1.5); nw++;
      }
    }
    stats.arcade = { gates: ng, hang: nh, wagons: nw };
  }

  /* ---------- 人の集まる場所（バス停・商店街・からくり時計） ---------- */
  let kclock = null;
  function extraAmb() {
    for (const b of BUSSTOPS) {
      const ri = roadInfo(b[0], b[1]);
      if (!ri) continue;
      const th = Math.atan2(ri.y - b[1], ri.x - b[0]);
      for (const k of [2.5, -3]) {
        const x = b[0] + Math.cos(th + Math.PI / 2) * k, y = b[1] + Math.sin(th + Math.PI / 2) * k;
        if (!propHit(x, y, 1, false)) amb.push({ x, y, a: th + (k > 0 ? 0.3 : -0.3), pose: 'stand', h: heightAt(x, y) + G3.CURB });
      }
    }
    for (const r of ROADS) {
      if (r.kind !== 'arcade') continue;
      for (let d = 10; d < r.pl.len - 8; d += 17) for (const sg of [1, -1]) {
        const p = at(r, d + (sg > 0 ? 0 : 8), sg * (r.w / 2 - 3.4));
        if (propHit(p.x, p.y, 1.2, false)) continue;
        amb.push({ x: p.x, y: p.y, a: Math.atan2(sg * Math.cos(p.a), -sg * Math.sin(p.a)), pose: 'stand', h: heightAt(p.x, p.y) + 0.12 });
      }
    }
    if (kclock) for (let k = 0; k < 7; k++) {
      const a = 0.9 + k * 0.62, x = kclock[0] + Math.cos(a) * 15, y = kclock[1] + Math.sin(a) * 15;
      if (!propHit(x, y, 1, false) && !blockedAt(x, y, 1, false)) amb.push({ x, y, a: a + Math.PI, pose: 'stand', h: heightAt(x, y) });
    }
  }

  /* ---------- 囲まれて取れないみかんを外へ出す（IDは変えないのでセーブと整合） ---------- */
  function blockedFoot(x, y) { return blockedAt(x, y, 2.2, false) || !!propHit(x, y, 2.2, false); }
  // ランドマークの敷地内から、歩いて敷地の外（+15）へ出られるか
  function escapesLM(x, y, sd) {
    const Q = [[x, y]], seen = new Set([Math.round(x / 3) + ',' + Math.round(y / 3)]);
    while (Q.length && seen.size < 6000) {
      const [px, py] = Q.shift();
      if (px < sd[0] - 15 || px > sd[2] + 15 || py < sd[1] - 15 || py > sd[3] + 15) return true;
      for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) {
        const nx = px + dx, ny = py + dy, k = Math.round(nx / 3) + ',' + Math.round(ny / 3);
        if (seen.has(k)) continue; seen.add(k);
        if (blockedFoot(nx, ny)) continue;
        Q.push([nx, ny]);
      }
    }
    return false;
  }
  function freeKeyPoints() {
    let moved = 0;
    for (const m of MIKANS) {
      const box = (G3.lmBoxes || []).find(q => m.x > q[0] - 6 && m.x < q[2] + 6 && m.y > q[1] - 6 && m.y < q[3] + 6);
      const l = box ? { solid: box } : null;
      if (!l) { if (!blockedFoot(m.x, m.y)) continue; }
      else if (!blockedFoot(m.x, m.y) && escapesLM(m.x, m.y, l.solid)) continue;
      // 敷地の外の最寄りの空き地へ
      let x0 = m.x, y0 = m.y;
      if (l) {
        const sd = l.solid, c = [[sd[0] - 14, m.y], [sd[2] + 14, m.y], [m.x, sd[1] - 14], [m.x, sd[3] + 14]];
        c.sort((p, q) => hyp(p[0] - m.x, p[1] - m.y) - hyp(q[0] - m.x, q[1] - m.y));
        [x0, y0] = c[0];
      }
      let done = false;
      for (let rad = 0; rad <= 120 && !done; rad += 5) {
        for (let k = 0; k < (rad ? 16 : 1) && !done; k++) {
          const a = k / 16 * TAU, x = x0 + Math.cos(a) * rad, y = y0 + Math.sin(a) * rad;
          if (blockedFoot(x, y) || inWaterRaw(x, y)) continue;
          if (l && x > l.solid[0] - 6 && x < l.solid[2] + 6 && y > l.solid[1] - 6 && y < l.solid[3] + 6) continue;
          m.x = x; m.y = y; done = true; moved++;
        }
      }
    }
    stats.mikan_moved = moved;
  }

  function build(scene) {
    if (!G3.glb.street) return;
    seedOcc();
    tramStops();
    laneFurniture(scene);
    roadMarks(scene);
    guideSigns(scene);
    signs();
    dogo(scene);
    arcades();
    yuzuki();
    furniture(scene);
    ports();
    coastline(scene);
    fishingHarbor();
    crossings(scene);
    catenary(scene);
    gasStations(scene);
    konbinis(scene);
    overpasses(scene);
    stations();
    powerLines(scene);
    billboards(scene);
    riverside();
    parks(scene);
    shrines();
    farmHuts();
    taxiStands();
    busShelters();
    roadworks();
    gomiStations();
    roadEdges();
    buildingDetails();
    houseYards(scene);
    greenery();
    exteriors();
    nightLights(scene);
    shopLights(scene);
    roofs();
    boats();
    cranes();
    flush(scene);
    freeKeyPoints();
    extraAmb();
    ensureWater();   // 消火栓の放水用（起動時の下準備でシェーダーを作っておく）
    G3.street.stats = stats;
    G3.street.amb = amb;
  }
  // 鳴っている踏切までの距離（なければ大きな値）
  function activeCrossing(x, y) {
    let best = 1e9;
    for (const k of xings) {
      if (k.k <= 0.01) continue;
      const p = plAt(k.pl, k.d), d = hyp(p.x - x, p.y - y);
      if (d < best) best = d;
    }
    return best;
  }
  return { build, update, zoneOf, activeCrossing, breakAt };
})();
