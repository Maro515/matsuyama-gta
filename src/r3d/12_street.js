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
  const put = (name, x, y, rot, lift = 0, s = 1) => {
    (lists[name] || (lists[name] = [])).push(G3.M4(x, heightAt(x, y) + lift, y, rot, U * s));
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
        const p = at(r, d, (rr() < 0.5 ? 1 : -1) * (r.w / 2 + 4));
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
        const p = walkAt(r, sg, d, G3.SW - 1.3);
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
          const p = walkAt(r, sg, d, G3.SW - 0.9);
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
        const p = walkAt(r, sg, d + dd, G3.SW - 1.6);
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
        const p = walkAt(r, sg, d, G3.SW - 1.0);
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
      [4700, 3060, 'clock_pole'], [5820, 3690, 'clock_pole'], [7420, 2380, 'clock_pole'], [1290, 740, 'clock_pole']];
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
    const len = 7.5;   // ラック1基 = 3m
    for (let i = 0; i < racks; i++) {
      const dd = d + i * (len + 1);
      const c = walkAt(r, sg, dd + len / 2, G3.SW - 2.6);
      if (!free(c.x, c.y, 4.5)) return;
      const p = walkAt(r, sg, dd, G3.SW - 2.6);
      const rot = -p.a;
      onWalk('bike_rack', p.x, p.y, rot);
      for (let k = 0; k < 6; k++) {
        if (rr() < 0.3) continue;
        const q = walkAt(r, sg, dd + k * 1.5, G3.SW - 2.6);
        const ba = p.a + (sg > 0 ? Math.PI / 2 : -Math.PI / 2) + (rr() - 0.5) * 0.16;
        onWalk(['bicycle_a', 'bicycle_a', 'bicycle_b', 'bicycle_c'][(rr() * 4) | 0], q.x, q.y, -ba);
      }
      take(c.x, c.y, 4.5);
    }
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

  /* ---------- インスタンス化 ---------- */
  function flush(scene) {
    for (const name in lists) {
      const node = G3.glbNode('street', name);
      stats[name] = lists[name].length;
      if (!node) continue;
      node.traverse(c => { if (c.isMesh) c.material = Array.isArray(c.material) ? c.material.map(G3.lmMat) : G3.lmMat(c.material); });
      const g = G3.instanceNode(node, lists[name]);
      g.name = 'street_' + name;
      g.userData.pos = lists[name].map(M => [M.elements[12], M.elements[14]]);
      scene.add(g);
    }
    lists = {};
  }

  function build(scene) {
    if (!G3.glb.street) return;
    seedOcc();
    tramStops();
    guideSigns(scene);
    signs();
    furniture(scene);
    roadEdges();
    flush(scene);
    G3.street.stats = stats;
  }
  return { build, zoneOf };
})();
