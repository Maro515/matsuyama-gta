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
    curve_mirror: POLE, hydrant_sign: POLE, tram_stop: [[0, 0, 6.0, 0.8, 2]], post_round: [[0, 0, 0.25, 3]], post_square: [[0, 0, 0.21, 0.28, 3]],
    phone_booth: [[0, 0, 0.46, 0.46, 3]], bicycle_a: [[0.05, 0, 0.88, 0.2, 3]], bicycle_b: [[0.05, 0, 0.88, 0.2, 3]], bicycle_c: [[0.05, 0, 0.88, 0.2, 3]],
    bike_rack: [[1.5, 0, 1.8, 0.4, 3]], recycle_box: [[0, 0, 0.21, 0.46, 3]], utility_box: [[0, 0, 0.3, 0.62, 3]], bench: [[-0.08, 0, 0.3, 0.85, 3]],
    map_board: [[0, 0, 0.12, 1.0, 3]], planter_box: [[0, 0, 0.6, 0.25, 3]], parking_sign: [[0, 0, 0.08, 3], [0.9, 0, 0.2, 0.23, 3]],
    car_stop: [[0, 0, 0.08, 0.6, 2]], clock_pole: [[0, 0, 0.22, 3]], stand_sign: [[0, 0, 0.25, 3]], iron_fence: [[1.0, 0, 1.0, 0.05, 3]],
    stone_lantern: [[0, 0, 0.42, 3]], karakuri_clock: [[0, 0, 1.7, 3]], block_wall: [[1.0, 0, 1.0, 0.1, 3]], propane: [[0, 0, 0.2, 0.42, 3]],
    ac_unit: [[0, 0, 0.17, 0.42, 3]], gomi_station: [[0, 0, 0.5, 0.9, 3]], mooring_bollard: [[0, 0, 0.3, 3]], potted_plant: [[0, 0, 0.22, 3]],
    container_a: [[0, 0, 3.03, 1.22, 3]], container_b: [[0, 0, 3.03, 1.22, 3]], container_c: [[0, 0, 3.03, 1.22, 3]], container_d: [[0, 0, 3.03, 1.22, 3]],
    crossing_post: [[0, 0, 0.12, 3], [0, -0.5, 0.2, 0.2, 3]], catenary_pole: [[0, 0, 0.18, 3]], slide: [[-0.4, 0, 1.4, 0.45, 3]],
    swing: [[0, -1.3, 0.45, 0.06, 3], [0, 1.3, 0.45, 0.06, 3]], jungle_gym: [[0, 0, 0.92, 0.92, 3]], park_toilet: [[0, 0, 1.55, 2.05, 3]],
    park_lamp: [[0, 0, 0.08, 3]], fountain: [[0, 0, 0.3, 3]], gs_pump: [[0, 0, 1.8, 0.5, 3]], gs_sign: [[0, 0, 0.25, 0.25, 3]],
    gs_office: [[0, 0, 2.5, 3.5, 3]], traffic_cone: [[0, 0, 0.18, 3]], barricade: [[0, 0, 0.9, 0.2, 3]], koji_sign: [[0, 0, 0.2, 0.36, 3]],
    bus_shelter: [[-0.7, 0, 0.05, 2.0, 3], [-0.15, -1.95, 0.6, 0.05, 3], [-0.15, 1.95, 0.6, 0.05, 3]],
    nobori_a: [[0, 0, 0.16, 3]], nobori_b: [[0, 0, 0.16, 3]], nobori_c: [[0, 0, 0.16, 3]], nobori_d: [[0, 0, 0.16, 3]], nobori_e: [[0, 0, 0.16, 3]],
  };
  function collide(name, x, y, rot, lift) {
    const cs = COLL[name];
    if (!cs || lift > 1.5 || typeof addCollider !== 'function') return;
    const al = -rot, ca = Math.cos(al), sa = Math.sin(al);
    for (const c of cs) {
      // Blender +X → (cos, sin)、+Y → (sin, -cos)
      const wx = x + U * (c[0] * ca + c[1] * sa), wy = y + U * (c[0] * sa - c[1] * ca);
      if (c.length === 4) addCollider({ x: wx, y: wy, r: c[2] * U, m: c[3] });
      else addCollider({ x: wx, y: wy, hx: c[2] * U, hy: Math.max(0.3, c[3] * U), a: al, m: c[4] });
    }
  }
  const putM = (name, M) => { (lists[name] || (lists[name] = [])).push(M); };
  const put = (name, x, y, rot, lift = 0, s = 1) => {
    (lists[name] || (lists[name] = [])).push(G3.M4(x, heightAt(x, y) + lift, y, rot, U * s));
    collide(name, x, y, rot, lift);
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
  function seedOcc() {
    for (const l of LAMPS) take(l[0], l[1], 3);
    for (const p of POLES) take(p.x, p.y, 3);
    for (const v of VENDING) take(v.x, v.y, 4);
    for (const b of BUSSTOPS) take(b[0], b[1], 8);
    for (const s of SIGNALS) take(s.x, s.y, 3);
  }
  const nearBld = (x, y, m) => {
    gridNear(bldGrid, x, y, _ov);
    for (const b of _ov) if (x > b.x0 - m && x < b.x1 + m && y > b.y0 - m && y < b.y1 + m) return true;
    return false;
  };

  /* ---------- 第1段: 道路端の柵・植え込み・車止め ---------- */
  const HEDGE_ROADS = new Set(['平和通り', '花園町通り', '千舟町通り', '空港通り', '大手町通り']);
  function roadEdges() {
    const rr = mulberry32(5101);
    for (const r of ROADS) {
      if (r.kind === 'arcade') continue;
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
      if (r.kind === 'arcade') continue;
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
      if (r.kind === 'arcade') continue;
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
            parked.push(mkCar(cp.x, cp.y, into, ['sedan', 'kei', 'kei', 'sedan', 'taxi'][(rr() * 5) | 0]));
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
  const clearOfRoad = (x, y, m) => { const ri = roadInfo(x, y); return !ri || ri.d > ri.road.w / 2 + G3.SW + m; };

  function buildingDetails() {
    const rr = mulberry32(5304);
    for (const b of buildings) {
      if (b.noDraw) continue;
      const f = frontOf(b), len = faceLen(b, f);
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const z = zoneOf(cx, cy);
      const shopFront = b.kind === 'shop' || (b.kind === 'office' && b.seed % 2 && b.hgt <= 4);
      if (shopFront) {
        if (z === 'dogo') {
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
        // 前庭のブロック塀（門の切れ目あり）
        if (z !== 'center' && rr() < 0.8) {
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

  /* ---------- 第3段: 住宅地のごみステーション ---------- */
  function gomiStations() {
    const rr = mulberry32(5305);
    for (const r of ROADS) {
      if (r.kind !== 'minor') continue;
      walkSpots(r, 420, 220, rr, (sg, d) => {
        const p = walkAt(r, sg, d, G3.SW + 2.2);
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
      take(x, y, 8);
    }
    // 道後温泉駅前の黒い鋳鉄柵（道路沿いの歩道の外側）
    const st = [7352, 2292];
    for (const r of ROADS) {
      if (r.kind === 'arcade') continue;
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
    return G3.world.canvasTex(512, 256, g => {
      g.clearRect(0, 0, 512, 256);
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
    });
  }
  function roadMarks(scene) {
    const gb = new G3.GB(false);
    const decal = (x, y, h, hw, hl, ci) => {
      const fx = Math.cos(h), fy = Math.sin(h), rx = -Math.sin(h), ry = Math.cos(h);
      const u0 = (ci % 4) / 4 + 0.004, u1 = ((ci % 4) + 1) / 4 - 0.004;
      const v1 = 1 - ((ci / 4) | 0) / 2 - 0.004, v0 = 1 - (((ci / 4) | 0) + 1) / 2 + 0.004;
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
      const edge = r.w / 2 - (r.kind === 'main' ? 1.6 : 1.0);
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
          if (r.kind === 'minor' && j.road.kind === 'main') {
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
      if (!ok) continue;
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
      if (b.noDraw || b.kind !== 'house') continue;
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
      const pts = [];
      for (const u of [0, 0.5, 1]) for (const vv of [0, 0.5, 1]) pts.push(at(r, d + u * W, sg * (o0 + vv * D)));
      let ok = true;
      for (const q of pts) {
        const rq = roadInfo(q.x, q.y);
        if (inWaterRaw(q.x, q.y) || hillAt(q.x, q.y) || inPark(q.x, q.y, 4) || nearBld(q.x, q.y, 3) || !free(q.x, q.y, 6) || railDist(q.x, q.y) < 18 ||
          nearLM(q.x, q.y, 110) || propHit(q.x, q.y, 3, true) || (rq && rq.road !== r && rq.d < rq.road.w / 2 + G3.SW + 2)) { ok = false; break; }
      }
      if (!ok) continue;
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
      if (r.kind === 'arcade') continue;
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
      if (rr() < 0.35) continue;
      const bx = x - nx * 9, by = y - ny * 9;
      if (!inWaterRaw(bx, by) || (last && hyp(last[0] - bx, last[1] - by) < 26)) continue;
      put('fishing_boat', bx, by, -(Math.atan2(ny, nx) + Math.PI / 2 + (rr() - 0.5) * 0.2), -1.4);
      last = [bx, by];
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

  /* ---------- インスタンス化 ---------- */
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
  const FAR = { guide_gantry: 1e9, tram_stop: 2200, karakuri_clock: 1e9, container_a: 2400, container_b: 2400, container_c: 2400, container_d: 2400, gs_canopy: 1600, gs_sign: 1600, fishing_boat: 1800,
    catenary_pole: 1100, park_toilet: 1000, solar_panel: 900, tv_antenna: 700, bus_shelter: 1000,
    guardrail: 1300, guard_pipe: 1000, hedge_planter: 1200, block_wall: 1000, awning_red: 1100, awning_green: 1100, awning_blue: 1100, awning_orange: 1100,
    sign_speed: 900, sign_stop: 900, curve_mirror: 900, parking_sign: 1200, clock_pole: 1400, map_board: 900 };
  const FAR_DEF = 650;
  // 影を落とすのは大きな物だけ（小物は影のパスの描画回数を増やすだけ）
  const SHADOW = /wall|fence|awning|booth|container|canopy|gs_|tram_stop|guide|karakuri|toilet|shelter|hedge|guardrail|gantry|catenary|boat|lantern|jungle|slide|swing|vending|map_board/;
  Object.assign(FAR, { bicycle_a: 480, bicycle_b: 480, bicycle_c: 480, ac_unit: 520, potted_plant: 450, propane: 520, tv_antenna: 650 });
  const CH = 650;   // チャンク一辺（ゲーム単位 = 260m）
  const chunks = [];
  function flush(scene) {
    const tmpV = new THREE.Vector3();
    for (const name in lists) {
      const node = G3.glbNode('street', name);
      stats[name] = lists[name].length;
      if (!node) continue;
      node.traverse(c => { if (c.isMesh) c.material = Array.isArray(c.material) ? c.material.map(streetMat) : streetMat(c.material); });
      const groups = new Map();
      for (const M of lists[name]) {
        const k = Math.floor(M.elements[12] / CH) + ',' + Math.floor(M.elements[14] / CH);
        (groups.get(k) || groups.set(k, []).get(k)).push(M);
      }
      const far = (FAR[name] || FAR_DEF) * (matchMedia('(pointer:coarse)').matches ? 0.7 : 1);
      const all = [];
      for (const [k, mats] of groups) {
        const g = G3.instanceNode(node, mats, { shadow: SHADOW.test(name) });
        g.traverse(o => { if (o.isInstancedMesh) { o.computeBoundingSphere(); o.frustumCulled = true; } });
        let cx = 0, cz = 0;
        for (const M of mats) { cx += M.elements[12]; cz += M.elements[14]; }
        cx /= mats.length; cz /= mats.length;
        chunks.push({ g, x: cx, z: cz, far: far + CH * 0.75 });
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
    upT -= dt;
    if (upT > 0) return;
    upT = 0.25;
    const c = G3.camera.position;
    for (const k of chunks) {
      const dx = k.x - c.x, dz = k.z - c.z;
      k.g.visible = dx * dx + dz * dz < k.far * k.far;
    }
  }

  function build(scene) {
    if (!G3.glb.street) return;
    seedOcc();
    tramStops();
    roadMarks(scene);
    guideSigns(scene);
    signs();
    dogo(scene);
    furniture(scene);
    ports();
    crossings(scene);
    catenary(scene);
    gasStations(scene);
    parks(scene);
    busShelters();
    roadworks();
    gomiStations();
    roadEdges();
    buildingDetails();
    roofs();
    boats();
    flush(scene);
    G3.street.stats = stats;
  }
  return { build, update, zoneOf };
})();
