/* 小道（路地・抜け道・袋小路・細道）の生成器 — 開発用（配信物には入らない）
   使い方: 開発ページ /src/game.html を3D表示で起動し終えてから
     await fetch('/build/gen_alleys.js').then(r => r.text()).then(t => (0, eval)(t));
     const A = genAlleys();   // → build/bake_alleys.py で src/game.html の ALLEY_DATA に焼き込む
   起動時に毎回走らせると数秒かかるため、結果を焼き込んでおく。建物・街具（3Dの当たり判定も含む）・樹木・街灯・
   水・畑・丘・公園・ランドマーク敷地・線路を避ける。
   1) 建物と建物のすき間を見つけ、その間を通って道路まで（必要なら角で2回まで曲がって）抜ける路地
   2) 郊外の空き地を抜ける小道（走査線で道路から道路へ）
   出力: [幅w, 様式s, x0,y0, x1,y1, ...]（折れ線、ゲーム単位 1=0.4m）
   様式: 0=裏路地 1=飲み屋横丁(二番町・三番町) 2=石畳(道後) 3=港町(三津浜) 4=住宅地 5=土の小道(郊外) */
(function () {
  /* 通り抜けの路地を「切り通す」計画（第1段。建物の列を割って道路から道路へ抜ける）。
     出力: [縦か(0/1), c, t0, t1, 幅w, 様式s]。ゲーム側の ALLEY_CUTS がこれで建物を割る（割った後の状態で genAlleys を回す） */
  window.genCuts = function (opt = {}) {
    const rng = mulberry32(opt.seed || 10401);
    const STEP = 2;
    const PTS = [...LAMPS.map(l => [l[0], l[1], 2.5]), ...POLES.map(p => [p.x, p.y, 2.5]), ...VENDING.map(v => [v.x, v.y, 3]),
      ...BUSSTOPS.map(b => [b[0], b[1], 8]), ...SIGNALS.map(q => [q.x, q.y, 3]), ...TREES.map(t => [t[0], t[1], 3.5]),
      ...parked.map(c => [c.x, c.y, 7]), ...MIKANS.map(m => [m.x, m.y, 4]), ...GIGSPOTS.map(g => [g[1], g[2], 12]), ...GREENH.map(g => [g.x, g.y, 34]),
      ...MISSIONS.flatMap(m => [m.start, m.goal, ...(m.cps || [])].filter(Boolean)).map(p => [p[0], p[1], 12])];
    const ptGrid = makeGrid(); for (const q of PTS) gridAdd(ptGrid, q[0] - q[2], q[1] - q[2], q[0] + q[2], q[1] + q[2], q);
    const fGrid = makeGrid(); for (const f of FIELDS) gridAdd(fGrid, f.x, f.y, f.x + f.w, f.y + f.h, f);
    const o2 = [], o3 = [], ob = [];
    const nearCanal = (x, y, m) => CANALS.some(k => { const a = k.vert ? x : y, t = k.vert ? y : x; return Math.abs(a - k.c) < CANAL_W / 2 + m && t > k.t0 - m && t < k.t1 + m; });
    // 建物以外の障害（建物は割るので見ない）。3Dの街具も建物に付いている物が多いので見ない（割った後に置き直される）
    const hard = (x, y, h) => {
      gridNear(ptGrid, x, y, o2); for (const q of o2) if (hyp(q[0] - x, q[1] - y) < q[2] + h) return true;
      for (const e of EXCLUDE) if (x > e[0] && x < e[2] && y > e[1] && y < e[3]) return true;
      gridNear(fGrid, x, y, o3); for (const f of o3) if (x > f.x - h - 2 && x < f.x + f.w + h + 2 && y > f.y - h - 2 && y < f.y + f.h + h + 2) return true;
      if (railDist(x, y) < 10 || (typeof jrLiftXY === 'function' && jrLiftXY(x, y) > 0)) return true;
      for (const l of LMS) if (l.solid && x > l.solid[0] - h - 3 && x < l.solid[2] + h + 3 && y > l.solid[1] - h - 3 && y < l.solid[3] + h + 3) return true;
      if (hillAt(x, y) || inPark(x, y, 2) || inWaterRaw(x, y) || nearCanal(x, y, h + 1)) return true;
      return false;
    };
    const onRoadA = (x, y) => { const ri = roadInfo(x, y); if (!ri) return null; const k = ri.road.kind; return ri.d < ri.road.w / 2 + (k === 'lane' || k === 'arcade' ? 0.4 : 7.0) ? ri : null; };
    const styleOf = (x, y) => {
      if (hyp(x - 7400, y - 2300) < 480) return 2;
      if (x > 5980 && x < 6480 && y > 3120 && y < 3430) return 1;
      if (x > 5400 && x < 6950 && y > 2180 && y < 3720) return 0;
      if (x > 4560 && x < 5400 && y > 2880 && y < 3200) return 0;
      if (x < 1700 && y < 2050) return 3;
      return 4;
    };
    const out = [], stat = { lines: 0, iv: 0, hardRej: 0, noCut: 0, bigRej: 0, clash: 0, ok: 0 };
    const clash = (vert, c, t0, t1) => out.some(a => a[0] === (vert ? 1 : 0) && Math.abs(a[1] - c) < 36 && Math.min(a[3], t1) - Math.max(a[2], t0) > 4);
    for (const z of ZONES) {
      const [zx0, zy0, zx1, zy1] = z.r;
      for (const vert of [false, true]) {
        for (let c = (vert ? zx0 : zy0) + 20 * rng(); c < (vert ? zx1 : zy1); ) {
          const P = t => vert ? [c, t] : [t, c];
          const dense = styleOf(...P(((vert ? zy0 : zx0) + (vert ? zy1 : zx1)) / 2)) <= 1;
          stat.lines++;
          const s0 = (vert ? zy0 : zx0) - 60, s1 = (vert ? zy1 : zx1) + 60;
          // 道路→道路の区間を拾う
          let ta = null, prevRoad = false;
          const ivs = [];
          for (let t = s0; t <= s1; t += STEP) {
            const isR = !!onRoadA(...P(t));
            if (isR) { if (ta !== null && !prevRoad) ivs.push([ta, t]); ta = null; prevRoad = true; continue; }
            if (prevRoad) ta = t;
            prevRoad = false;
          }
          for (const [t0, t1] of ivs) {
            const L = t1 - t0;
            if (L < 24 || L > 240) continue;
            stat.iv++;
            const st = styleOf(...P((t0 + t1) / 2));
            const w = st === 1 ? 5 : (rng() < 0.6 ? 5 : 6), half = w / 2 + 0.35;
            let bad = false;
            for (let t = t0 + 1; t < t1 - 1 && !bad; t += STEP) if (hard(...P(t), w / 2)) bad = true;
            if (bad) { stat.hardRej++; continue; }
            // 割る建物
            const cuts = new Set();
            for (let t = t0; t <= t1; t += 4) {
              gridNear(bldGrid, ...P(t), ob);
              for (const b of ob) {
                if (cuts.has(b)) continue;
                const [p0, p1, q0, q1] = vert ? [b.x0, b.x1, b.y0, b.y1] : [b.y0, b.y1, b.x0, b.x1];
                if (p1 <= c - half || p0 >= c + half || q1 <= t0 || q0 >= t1) continue;
                cuts.add(b);
              }
            }
            if (!cuts.size) {   // 割らなくても抜けられる: 建物の間を通るものだけ（空き地を横切るだけのものは郊外の小道に任せる）
              let n = 0, k = 0;
              for (let t = t0 + 2; t < t1 - 2; t += 3) {
                const [x, y] = P(t); n++;
                gridNear(bldGrid, x, y, ob);
                if (ob.some(b => !b.noDraw && (vert ? (y > b.y0 && y < b.y1 && Math.min(Math.abs(b.x1 - c), Math.abs(b.x0 - c)) < half + 8) : (x > b.x0 && x < b.x1 && Math.min(Math.abs(b.y1 - c), Math.abs(b.y0 - c)) < half + 8)))) k++;
              }
              let hn = 0, hk = 0;
              for (let t = t0 + 4; t < t1 - 4; t += 4) { const ri = roadInfo(...P(t)); hn++; if (ri && Math.abs(vert ? ri.ty : ri.tx) > 0.94 && ri.d < ri.road.w / 2 + 7 + half + 9) hk++; }
              if (!n || k / n < 0.35 || (hn && hk / hn > 0.25) || clash(vert, c, t0, t1) || rng() > 0.6) { stat.noCut++; continue; }
              out.push([vert ? 1 : 0, Math.round(c * 10) / 10, Math.round((t0 - 0.6) * 10) / 10, Math.round((t1 + 0.6) * 10) / 10, w, st]);
              stat.ok++; stat.free = (stat.free || 0) + 1;
              continue;
            }
            let big = false;
            for (const b of cuts) {
              const [p0, p1] = vert ? [b.x0, b.x1] : [b.y0, b.y1];
              if (b.noDraw || b.hgt >= 7 || (p1 - p0) > 90) big = true;
              if (b.kind === 'hotel' || b.kind === 'office' && b.hgt >= 5) big = true;
            }
            if (big || cuts.size > 8) { stat.bigRej++; continue; }
            // 道路・路地に沿って平行に走るものは要らない（歩道の裏か、路地の隣）
            let hn = 0, hk = 0;
            for (let t = t0 + 4; t < t1 - 4; t += 4) {
              const ri = roadInfo(...P(t)); hn++;
              if (ri && Math.abs(vert ? ri.ty : ri.tx) > 0.94 && ri.d < ri.road.w / 2 + 7 + half + 9) hk++;
            }
            if (hn && hk / hn > 0.25) { stat.hug = (stat.hug || 0) + 1; continue; }
            if (clash(vert, c, t0, t1)) { stat.clash++; continue; }
            if (rng() > (st === 1 ? 0.92 : st === 0 || st === 2 || st === 3 ? 0.85 : 0.5)) continue;
            out.push([vert ? 1 : 0, Math.round(c * 10) / 10, Math.round((t0 - 0.6) * 10) / 10, Math.round((t1 + 0.6) * 10) / 10, w, st]);
            stat.ok++;
          }
          c += (dense ? 26 : 40) + rng() * 18;
        }
      }
    }
    window.genCutsStats = stat;
    return out;
  };

  window.genAlleys = function (opt = {}) {
    const rng = mulberry32(opt.seed || 10301);
    const SP = opt.spacing || 30, STEP = 2;
    const PTS = [...LAMPS.map(l => [l[0], l[1], 3]), ...POLES.map(p => [p.x, p.y, 3]), ...VENDING.map(v => [v.x, v.y, 4]),
      ...BUSSTOPS.map(b => [b[0], b[1], 9]), ...SIGNALS.map(q => [q.x, q.y, 3]), ...TREES.map(t => [t[0], t[1], 4]),
      ...parked.map(c => [c.x, c.y, 8]), ...MIKANS.map(m => [m.x, m.y, 2.5]), ...GIGSPOTS.map(g => [g[1], g[2], 10]),
      ...MISSIONS.flatMap(m => [m.start, m.goal, ...(m.cps || [])].filter(Boolean)).map(p => [p[0], p[1], 10])];
    const ptGrid = makeGrid(); for (const q of PTS) gridAdd(ptGrid, q[0] - q[2], q[1] - q[2], q[0] + q[2], q[1] + q[2], q);
    const fGrid = makeGrid(); for (const f of FIELDS) gridAdd(fGrid, f.x, f.y, f.x + f.w, f.y + f.h, f);
    const o1 = [], o2 = [], o3 = [], o4 = [];
    const fcache = new Map();
    const freeA = (x, y, h) => {
      const key = Math.round(x * 2) + ',' + Math.round(y * 2) + ',' + h;
      const cv = fcache.get(key); if (cv !== undefined) return cv;
      const v = freeRaw(x, y, h); fcache.set(key, v); return v;
    };
    const freeRaw = (x, y, h) => {
      gridNear(bldGrid, x, y, o1); for (const b of o1) if (x > b.x0 - h - 0.8 && x < b.x1 + h + 0.8 && y > b.y0 - h - 0.8 && y < b.y1 + h + 0.8) return false;
      gridNear(ptGrid, x, y, o2); for (const q of o2) if (hyp(q[0] - x, q[1] - y) < q[2] + h) return false;
      if (propHit(x, y, h + 0.4, false)) return false;
      for (const e of EXCLUDE) if (x > e[0] && x < e[2] && y > e[1] && y < e[3]) return false;
      gridNear(fGrid, x, y, o3); for (const f of o3) if (x > f.x - h - 2 && x < f.x + f.w + h + 2 && y > f.y - h - 2 && y < f.y + f.h + h + 2) return false;
      if (railDist(x, y) < 10 || (typeof jrLiftXY === 'function' && jrLiftXY(x, y) > 0)) return false;
      for (const l of LMS) if (l.solid && x > l.solid[0] - h - 2 && x < l.solid[2] + h + 2 && y > l.solid[1] - h - 2 && y < l.solid[3] + h + 2) return false;
      if (hillAt(x, y) || inPark(x, y, 2) || inWaterRaw(x, y)) return false;
      return true;
    };
    // 歩道の外縁（路地・アーケードは道の端）まで来たら道路
    const onRoadA = (x, y) => { const ri = roadInfo(x, y); if (!ri) return null; const k = ri.road.kind; return ri.d < ri.road.w / 2 + (k === 'lane' || k === 'arcade' ? 0.4 : 7.0) ? ri : null; };
    const styleOf = (x, y) => {
      if (hyp(x - 7400, y - 2300) < 480) return 2;
      if (x > 5980 && x < 6480 && y > 3120 && y < 3430) return 1;
      if (x > 5400 && x < 6950 && y > 2180 && y < 3720) return 0;
      if (x > 4560 && x < 5400 && y > 2880 && y < 3200) return 0;
      if (x < 1700 && y < 2050) return 3;
      return -1;
    };
    // 折れ線の点を STEP おきに
    const samples = (pts, fn) => {
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i], L = hyp(bx - ax, by - ay);
        for (let s = 0; s < L; s += STEP) fn(ax + (bx - ax) * s / L, ay + (by - ay) * s / L, (bx - ax) / L, (by - ay) / L);
      }
    };
    const plLen = pts => { let L = 0; for (let i = 1; i < pts.length; i++) L += hyp(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };
    // 道路に沿って平行に走っている区間の割合（それは歩道の裏で小道ではない）
    const hugsRoad = (pts, h) => {
      let n = 0, k = 0;
      samples(pts, (x, y, dx, dy) => {
        n++;
        const ri = roadInfo(x, y);
        if (!ri) return;
        const par = Math.abs(ri.tx * dx + ri.ty * dy) > 0.94;
        if (par && ri.d < ri.road.w / 2 + 7 + h + 9) k++;
      });
      return n ? k / n : 0;
    };
    // 採用済みの小道との重なり（交差はよいが、重ねて敷かない）
    const occ = new Set(), okey = (x, y) => Math.floor(x / 3) + ',' + Math.floor(y / 3);
    const overlap = (pts, h) => {   // 新しい小道の幅いっぱいで見る（中心線だけだと平行に並ぶ小道を見逃す）
      let n = 0, k = 0;
      samples(pts, (x, y, dx, dy) => {
        n++;
        for (let o = -h; o <= h + 0.01; o += h / 2) if (occ.has(okey(x - dy * o, y + dx * o))) { k++; break; }
      });
      return n ? k / n : 0;
    };
    const mark = (pts, h) => samples(pts, (x, y, dx, dy) => {
      for (let o = -h - 1.5; o <= h + 1.5; o += 1.0) occ.add(okey(x - dy * o, y + dx * o));
    });
    // まっすぐ歩いて道路に出るか、ぶつかるまで
    const walk = (x, y, dx, dy, h, M) => {
      for (let s = STEP; s <= M; s += STEP) {
        const X = x + dx * s, Y = y + dy * s;
        if (onRoadA(X, Y)) return { x: X, y: Y, road: true, len: s };
        if (!freeA(X, Y, h)) return { x: x + dx * (s - STEP), y: y + dy * (s - STEP), road: false, len: s - STEP };
      }
      return { x: x + dx * M, y: y + dy * M, road: false, len: M };
    };
    // 突き当たり (x,y)（進んでいた向き dx,dy）から、角で曲がって道路へ。k=曲がれる回数
    const route = (x, y, dx, dy, h, k) => {
      for (const b of [0, 6, 12]) {
        const qx = x - dx * b, qy = y - dy * b;
        for (const s of (rng() < 0.5 ? [1, -1] : [-1, 1])) {
          const tx = -dy * s, ty = dx * s;
          const w = walk(qx, qy, tx, ty, h, 150);
          if (w.len < 6) continue;
          if (w.road) return [[qx, qy], [w.x, w.y]];
          if (k > 1) { const r = route(w.x, w.y, tx, ty, h, k - 1); if (r) return [[qx, qy], ...r]; }
        }
      }
      return null;
    };
    const simplify = pts => {
      const o = [pts[0]];
      for (let i = 1; i < pts.length - 1; i++) {
        const a = o[o.length - 1], b = pts[i], c = pts[i + 1];
        const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (Math.abs(cr) > 0.5 && hyp(b[0] - a[0], b[1] - a[1]) > 0.5) o.push(b);
      }
      o.push(pts[pts.length - 1]);
      return o;
    };
    const out = [];
    if (typeof ALLEYS !== 'undefined') for (const a of ALLEYS) mark(a.pts, a.w / 2);   // 割って作った路地（ALLEY_CUTS）とは重ねない
    const accept = (pts, w, st) => {
      out.push([w, st, ...pts.flatMap(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10])]);
      mark(pts, w / 2);
    };
    const inZone = (x, y) => ZONES.some(z => x > z.r[0] && x < z.r[2] && y > z.r[1] && y < z.r[3]);
    // ---- 1) 建物と建物のすき間 ----
    const B = buildings.filter(b => !b.noDraw && b.hgt > 1 && inZone((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2));
    const bGrid = makeGrid(); for (const b of B) gridAdd(bGrid, b.x0, b.y0, b.x1, b.y1, b);
    const stat = { gaps: 0, both: 0, dead: 0, none: 0, hug: 0, over: 0, gapAlleys: 0, scanAlleys: 0 };
    for (const a of B) {
      for (const vert of [true, false]) {   // vert: a の東側のすき間（南北の路地）、!vert: 南側のすき間（東西の路地）
        const ax1 = vert ? a.x1 : a.y1, a0 = vert ? a.y0 : a.x0, a1 = vert ? a.y1 : a.x1;
        let best = null, bg = 1e9;
        gridNear(bGrid, vert ? a.x1 + 12 : (a.x0 + a.x1) / 2, vert ? (a.y0 + a.y1) / 2 : a.y1 + 12, o4);
        for (const b of o4) {
          if (b === a) continue;
          const bx0 = vert ? b.x0 : b.y0, b0 = vert ? b.y0 : b.x0, b1 = vert ? b.y1 : b.x1;
          const g = bx0 - ax1, ov = Math.min(a1, b1) - Math.max(a0, b0);
          if (g < 4.6 || g > 24 || ov < 6) continue;
          if (g < bg) { bg = g; best = b; }
        }
        if (!best) continue;
        const bx0 = vert ? best.x0 : best.y0, b0 = vert ? best.y0 : best.x0, b1 = vert ? best.y1 : best.x1;
        const c = (ax1 + bx0) / 2;
        let h = Math.min(3.4, bg / 2 - 0.7);
        if (h < 1.6) continue;
        const tm = (Math.max(a0, b0) + Math.min(a1, b1)) / 2;
        const [cx, cy] = vert ? [c, tm] : [tm, c], [ux, uy] = vert ? [0, 1] : [1, 0];
        if (!freeA(cx, cy, h)) continue;
        stat.gaps++;
        const e0 = walk(cx, cy, -ux, -uy, h, 260), e1 = walk(cx, cy, ux, uy, h, 260);
        const side = (e, dx, dy) => {
          if (e.road) return { pts: [[e.x, e.y]], road: true };
          let r = route(e.x, e.y, dx, dy, h, 2);
          if (!r && h > 2.0) { r = route(e.x, e.y, dx, dy, 2.0, 2); if (r) h = 2.0; }
          return r ? { pts: r.slice().reverse(), road: true, turned: true } : { pts: [[e.x, e.y]], road: false };
        };
        const s0 = side(e0, -ux, -uy), s1 = side(e1, ux, uy);
        if (!s0.road && !s1.road) { stat.none++; continue; }
        // s0.pts は道路側の端から始まり突き当たりの点で終わる。s1 は突き当たり→道路の向き
        let pts = simplify([...s0.pts, ...s1.pts.slice().reverse()]);
        const L = plLen(pts);
        if (L < 10) continue;
        if (!(s0.road && s1.road)) { if (L > 130 || L < 14) { stat.dead++; continue; } }
        if (hugsRoad(pts, h) > 0.3) { stat.hug++; continue; }
        if (overlap(pts, h) > 0.3) { stat.over++; continue; }
        if (s0.road && s1.road) stat.both++;
        let st = styleOf(...pts[Math.floor(pts.length / 2)]);
        if (st < 0) st = 4;
        const w = Math.max(4, Math.min(7, Math.round(h * 2 * 2) / 2));
        accept(pts, w, st);
        stat.gapAlleys++;
      }
    }
    // ---- 1b) 道路の歩道の外から街区の中へ入る路地（入口の両脇か片側に建物があること） ----
    const sideBld = (x, y, ux, uy, h) => {   // (x,y) の左右（進行方向に直角）h+7 以内に建物があるか
      gridNear(bldGrid, x, y, o1);
      let L = false, R = false;
      for (const b of o1) {
        if (b.noDraw && b.hgt <= 1) continue;
        for (const [s, flag] of [[1, 'L'], [-1, 'R']]) {
          for (let o = h + 1; o <= h + 7; o += 2) {
            const px = x - uy * o * s, py = y + ux * o * s;
            if (px > b.x0 && px < b.x1 && py > b.y0 && py < b.y1) { if (flag === 'L') L = true; else R = true; break; }
          }
        }
      }
      return (L ? 1 : 0) + (R ? 1 : 0);
    };
    stat.probes = 0; stat.probeAlleys = 0;
    for (const r of ROADS) {
      if (r.kind === 'arcade') continue;
      for (let d = 18 + rng() * 20; d < r.pl.len - 18; d += 30 + rng() * 16) {
        const p = plAt(r.pl, d), nx = -Math.sin(p.a), ny = Math.cos(p.a);
        if (Math.abs(nx) < 0.985 && Math.abs(ny) < 0.985) continue;   // 斜めの道路からは出さない（建物は軸に沿う）
        if (!inZone(p.x, p.y) || r.junc.some(j => Math.abs(j.d - d) < j.road.w / 2 + 14)) continue;
        for (const sg of [1, -1]) {
          const ux = Math.round(nx * sg), uy = Math.round(ny * sg);
          const off = r.w / 2 + (r.kind === 'lane' ? 0.4 : 7.0) + 0.8;
          const sx = p.x + nx * sg * off, sy = p.y + ny * sg * off;
          const h = 2.4;
          if (!freeA(sx, sy, h) || !freeA(sx + ux * 6, sy + uy * 6, h)) continue;
          // 入口は建物の間（片側でも可）
          if (sideBld(sx + ux * 4, sy + uy * 4, ux, uy, h) === 0 || sideBld(sx + ux * 10, sy + uy * 10, ux, uy, h) === 0) continue;
          stat.probes++;
          const e = walk(sx, sy, ux, uy, h, 220);
          let pts = null, thru = false;
          if (e.road && e.len >= 20) { pts = [[sx - ux * 1.4, sy - uy * 1.4], [e.x, e.y]]; thru = true; }
          else if (!e.road) {
            const rt = e.len >= 8 ? route(e.x, e.y, ux, uy, h, 2) : null;
            if (rt) { pts = [[sx - ux * 1.4, sy - uy * 1.4], ...rt]; thru = true; }
            else if (e.len >= 14 && e.len <= 70 && rng() < 0.5) pts = [[sx - ux * 1.4, sy - uy * 1.4], [e.x, e.y]];
          }
          if (!pts) continue;
          pts = simplify(pts);
          if (thru && hyp(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < 24) continue;
          if (hugsRoad(pts, h) > 0.3 || overlap(pts, h) > 0.25) continue;
          let st = styleOf(...pts[Math.floor(pts.length / 2)]);
          if (st < 0) st = 4;
          accept(pts, rng() < 0.7 ? 5 : 6, st);   // 入口の路地は細め（2.0〜2.4m）
          stat.probeAlleys++;
        }
      }
    }
    // ---- 2) 郊外の空き地を抜ける小道（走査線で道路から道路へ） ----
    for (const z of ZONES) {
      const [zx0, zy0, zx1, zy1] = z.r;
      for (const vert of [false, true]) {
        for (let c = (vert ? zx0 : zy0) + SP * (0.2 + rng() * 0.5); c < (vert ? zx1 : zy1); c += SP * (0.75 + rng() * 0.5)) {
          const s0 = (vert ? zy0 : zx0) - 40, s1 = (vert ? zy1 : zx1) + 40;
          let run = null, startRoad = false, prevRoad = false;
          const flush = (endRoad, tEnd) => {
            if (run === null) return;
            const t0 = run, t1 = tEnd, L = t1 - t0;
            run = null;
            if (!(startRoad && endRoad && L >= 16)) return;
            const P = t => vert ? [c, t] : [t, c];
            if (styleOf(...P((t0 + t1) / 2)) >= 0) return;   // 市街地は 1) だけ
            if (rng() < 0.45) return;
            const pts = [P(t0 - 0.6), P(t1 + 0.6)];
            if (hugsRoad(pts, 2.4) > 0.25 || overlap(pts, 2.4) > 0.3) return;
            let wide = true;
            for (let t = t0 + 1; t < t1 - 1 && wide; t += STEP) if (!freeA(...P(t), 3.4)) wide = false;
            accept(pts, wide && rng() < 0.6 ? 7 : 5, 5);
            stat.scanAlleys++;
          };
          for (let t = s0; t <= s1; t += STEP) {
            const x = vert ? c : t, y = vert ? t : c;
            if (onRoadA(x, y)) { if (run !== null) flush(true, t); prevRoad = true; continue; }
            if (freeA(x, y, 2.4)) { if (run === null) { run = t; startRoad = prevRoad; } }
            else if (run !== null) flush(false, t);
            prevRoad = false;
          }
          if (run !== null) flush(false, s1);
        }
      }
    }
    window.genAlleysStats = stat;
    return out;
  };
})();
