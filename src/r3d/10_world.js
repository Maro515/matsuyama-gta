'use strict';
/* =========================================================
   静的な街の構築（地形・水・丘・田畑・道路・鉄道・建物・樹木・街具）
   ========================================================= */
G3.world = (function () {
  const THREE = G3.THREE;
  const U = G3.U;
  const WM = {};      // マテリアル
  const anim = { wheels: [], gondola: null, water: [], signals: [], winMats: [], lightPools: [], neon: [], wet: [], glow: [], carts: [] };

  /* ---------- ジオメトリ・ビルダー ---------- */
  class GB {
    constructor(col) { this.p = []; this.n = []; this.u = []; this.c = col ? [] : null; this.s = null; this.i = []; }
    v(x, y, z, u, v, nx, ny, nz, col, seed) {
      this.p.push(x, y, z); this.n.push(nx, ny, nz); this.u.push(u, v);
      if (this.c) this.c.push(col ? col[0] : 1, col ? col[1] : 1, col ? col[2] : 1);
      if (seed !== undefined) { (this.s || (this.s = [])).push(seed); }
      return this.p.length / 3 - 1;
    }
    // 4頂点 a..d（反時計回り）を、面法線つきで追加
    quad(P, UV, col, seed) {
      const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2];
      const bx = P[3][0] - P[0][0], by = P[3][1] - P[0][1], bz = P[3][2] - P[0][2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const i0 = this.v(...P[0], ...UV[0], nx, ny, nz, col, seed);
      const i1 = this.v(...P[1], ...UV[1], nx, ny, nz, col, seed);
      const i2 = this.v(...P[2], ...UV[2], nx, ny, nz, col, seed);
      const i3 = this.v(...P[3], ...UV[3], nx, ny, nz, col, seed);
      this.i.push(i0, i1, i2, i0, i2, i3);
    }
    tri(P, UV, col) {
      const ax = P[1][0] - P[0][0], ay = P[1][1] - P[0][1], az = P[1][2] - P[0][2];
      const bx = P[2][0] - P[0][0], by = P[2][1] - P[0][1], bz = P[2][2] - P[0][2];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      const i0 = this.v(...P[0], ...UV[0], nx, ny, nz, col);
      const i1 = this.v(...P[1], ...UV[1], nx, ny, nz, col);
      const i2 = this.v(...P[2], ...UV[2], nx, ny, nz, col);
      this.i.push(i0, i1, i2);
    }
    // 軸平行の箱（下面なし）
    box(x0, y0, z0, x1, y1, z1, col, uvs = 4) {
      const f = (P, w, h) => this.quad(P, [[0, 0], [w / uvs, 0], [w / uvs, h / uvs], [0, h / uvs]], col);
      f([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], x1 - x0, y1 - y0);
      f([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], x1 - x0, y1 - y0);
      f([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], z1 - z0, y1 - y0);
      f([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], z1 - z0, y1 - y0);
      f([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], x1 - x0, z1 - z0);
    }
    geo() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
      if (this.c) g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
      if (this.s) g.setAttribute('seed', new THREE.Float32BufferAttribute(this.s, 1));
      g.setIndex(this.i);
      g.computeBoundingSphere();
      return g;
    }
    mesh(mat, shadow = true) {
      const m = new THREE.Mesh(this.geo(), mat);
      m.castShadow = shadow; m.receiveShadow = true;
      return m;
    }
  }
  G3.GB = GB;

  const C = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };   // sRGB→線形（three管理下）
  const rnd = mulberry32(2024);

  /* ---------- 共通マテリアル ---------- */
  function texRep(name, rx, ry) {
    const t = G3.tex[name];
    if (!t) return null;
    const c = t.clone();
    c.repeat.set(rx || 1, ry || rx || 1);
    c.needsUpdate = true;
    return c;
  }
  // ワールド座標でテクスチャを貼る（vWP.xz / scale）
  function worldUV(mat, scale, extra) {
    mat.onBeforeCompile = sh => {
      sh.uniforms.uWS = { value: scale };
      if (extra && extra.uniforms) Object.assign(sh.uniforms, extra.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP=(modelMatrix*vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nuniform float uWS;' + ((extra && extra.decl) || ''))
        .replace('#include <map_fragment>', (extra && extra.map) ||
          '#ifdef USE_MAP\n vec4 sampledDiffuseColor = texture2D( map, vWP.xz/uWS );\n diffuseColor *= sampledDiffuseColor;\n#endif');
      if (extra && extra.after) sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + extra.after);
      mat.userData.shader = sh;
    };
    mat.customProgramCacheKey = () => 'wuv' + scale + (extra ? extra.key || '' : '');
    return mat;
  }

  function buildMaterials() {
    WM.ground = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    WM.water = new THREE.MeshStandardMaterial({ color: 0x1d4a5e, roughness: 0.05, metalness: 0.0, envMapIntensity: 1.1 });
    if (G3.tex.water_n) {
      WM.water.normalMap = texRep('water_n', 1, 1);
      WM.water.normalScale.set(0.32, 0.32);
      anim.water.push(WM.water.normalMap);
    }
    WM.asphalt = worldUV(new THREE.MeshStandardMaterial({ map: G3.tex.asphalt, roughness: 0.88, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }), 9);
    anim.wet.push(WM.asphalt);
    WM.sidewalk = new THREE.MeshStandardMaterial({ map: G3.tex.sidewalk, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
    anim.wet.push(WM.sidewalk);
    WM.curb = new THREE.MeshStandardMaterial({ map: G3.tex.concrete, color: 0xc9c6bd, roughness: 0.8 });
    WM.paver = new THREE.MeshStandardMaterial({ map: G3.tex.sidewalk, color: 0xe7ddc8, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -6 });
    WM.markW = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -40 });
    WM.markY = new THREE.MeshStandardMaterial({ color: 0xf0b020, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -40 });
    WM.rail = new THREE.MeshStandardMaterial({ color: 0x7d7f80, roughness: 0.55, metalness: 0.7, envMapIntensity: 0.4, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -50 });
    WM.ballast = new THREE.MeshStandardMaterial({ map: texRep('gravel', 1, 1), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
    WM.sleeper = new THREE.MeshStandardMaterial({ color: 0x8a8378, roughness: 0.9 });
    WM.hill = worldUV(new THREE.MeshStandardMaterial({ map: G3.tex.grass, vertexColors: true, roughness: 0.95 }), 40);
    WM.field = worldUV(new THREE.MeshStandardMaterial({ map: G3.tex.soil, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 20);
    WM.paddy = worldUV(new THREE.MeshStandardMaterial({ map: G3.tex.paddy, vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }), 20);
    WM.levee = new THREE.MeshStandardMaterial({ map: G3.tex.grass, color: 0x9ab36f, roughness: 0.95 });
    WM.concrete = new THREE.MeshStandardMaterial({ map: G3.tex.concrete, vertexColors: true, roughness: 0.85 });
    WM.plaster = new THREE.MeshStandardMaterial({ map: G3.tex.plaster, vertexColors: true, roughness: 0.85 });
    WM.kawara = new THREE.MeshStandardMaterial({ map: G3.tex.kawara, vertexColors: true, roughness: 0.55, metalness: 0.1 });
    WM.metal = new THREE.MeshStandardMaterial({ color: 0x9a9fa4, vertexColors: true, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide });
    WM.stone = new THREE.MeshStandardMaterial({ map: G3.tex.stonewall, roughness: 0.9, side: THREE.DoubleSide });
    WM.greenhouse = new THREE.MeshStandardMaterial({ color: 0xe9eff1, roughness: 0.35, transparent: true, opacity: 0.72, side: THREE.DoubleSide, depthWrite: false });
    WM.ghFrame = new THREE.MeshStandardMaterial({ color: 0xb8bcbf, roughness: 0.4, metalness: 0.7 });
    // 外壁（夜間は窓が個別に点灯）
    for (const f of ['office', 'glass', 'mansion', 'shop', 'house', 'hotel', 'gshop', 'goffice', 'ghouse', 'machiya', 'gmachiya', 'warehouse', 'gwarehouse', 'danchi']) {
      const m = new THREE.MeshStandardMaterial({ map: G3.tex['fac_' + f], vertexColors: true, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.9 });
      const mask = G3.tex['facm_' + f];
      const ground = f[0] === 'g';
      const uni = { uMask: { value: mask }, uNight: { value: 0 }, uRatio: { value: ground ? 0.7 : 0.38 }, uEmit: { value: ground ? 0.5 : 0.36 } };
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, uni);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float seed;\nvarying float vSeed;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSeed=seed;vFacY=(modelMatrix*vec4(transformed,1.0)).y;')
          .replace('varying float vSeed;', 'varying float vSeed;varying float vFacY;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform sampler2D uMask;uniform float uNight,uRatio,uEmit;varying float vSeed;varying float vFacY;\nfloat h21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}')
          .replace('#include <map_fragment>', '#include <map_fragment>\nvec4 facM=texture2D(uMask,vMapUv);float glassM=max(facM.r,facM.g);\ndiffuseColor.rgb*=mix(0.62,1.0,smoothstep(0.0,4.5,vFacY));')
          .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,0.1,glassM);')
          .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
            vec2 cel=floor(vMapUv)+vec2(vSeed*7.13,vSeed*3.71);
            float hA=h21(cel+vec2(.17,0.)),hB=h21(cel+vec2(0.,.31));
            float lA=step(hA,uRatio),lB=step(hB,uRatio);
            vec3 warm=mix(vec3(1.,.74,.42),vec3(.82,.9,1.),step(.72,fract(hA*7.)));
            totalEmissiveRadiance+=(facM.r*lA+facM.g*lB)*warm*uNight*uEmit;`);
      };
      m.customProgramCacheKey = () => 'fac' + (ground ? 'g' : 'u');
      m.userData.uni = uni;
      anim.winMats.push(m);
      WM['fac_' + f] = m;
    }
    // 看板・ネオン
    WM.sign = new THREE.MeshStandardMaterial({ map: signAtlas(), roughness: 0.5, emissiveMap: null });
    WM.sign.emissive = new THREE.Color(0xffffff);
    WM.sign.emissiveMap = WM.sign.map;
    WM.sign.emissiveIntensity = 0;
    anim.neon.push(WM.sign);
    WM.ad = new THREE.MeshStandardMaterial({ map: adAtlas(), roughness: 0.5 });
    WM.ad.emissive = new THREE.Color(0xffffff); WM.ad.emissiveMap = WM.ad.map; WM.ad.emissiveIntensity = 0;
    anim.neon.push(WM.ad);
    WM.lampGlow = new THREE.MeshBasicMaterial({ map: radialTex(), color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -80 });
  }

  /* ---------- キャンバス生成テクスチャ ---------- */
  function canvasTex(w, h, draw, srgb = true) {
    const cv2 = document.createElement('canvas'); cv2.width = w; cv2.height = h;
    draw(cv2.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(cv2);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }
  function radialTex() {
    return canvasTex(128, 128, (g, w) => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    });
  }
  G3.radialTex = radialTex;
  const SIGNS = [['居酒屋', '#b8282a'], ['ラーメン', '#d8a020'], ['カラオケ', '#6a2fa8'], ['薬', '#2a7ad0'], ['歯科', '#2e8a5a'],
    ['うどん', '#e8e0c8'], ['鯛めし', '#1f5aa8'], ['じゃこ天', '#c85a1a'], ['質', '#202020'], ['焼鳥', '#a01818'], ['喫茶', '#5a3a22'], ['不動産', '#2a4a8a'],
    // 道後温泉の界隈だけ（土産物・旅館の品名）
    ['坊っちゃん団子', '#2e6b3a'], ['みかんジュース', '#e8781a'], ['今治タオル', '#1e4f9a'], ['砥部焼', '#eef0ee', '#1e4f9a'], ['タルト', '#6a3a1e'], ['地ビール', '#1a1a1a', '#e8c860'], ['旅館', '#4a2e1e']];
  const SIGN_BASE = 12, SIGN_DOGO = [12, 13, 14, 15, 16, 17, 18, 7, 6, 5];   // 道後の店は土産物の看板
  function signAtlas() {
    return canvasTex(64 * SIGNS.length, 256, (g) => {
      SIGNS.forEach(([t, col, ink], i) => {
        const x = i * 64;
        g.fillStyle = col; g.fillRect(x, 0, 64, 256);
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 4; g.strokeRect(x + 4, 4, 56, 248);
        const light = (col === '#e8e0c8');
        g.fillStyle = ink || (light ? '#7a1a10' : '#fff');
        const ch = [...t];
        const step = Math.min(56, 230 / ch.length);
        g.font = `900 ${Math.min(40, Math.floor(step * 0.98))}px "Hiragino Mincho ProN","Yu Mincho",serif`; g.textAlign = 'center';
        ch.forEach((cc, k) => g.fillText(cc, x + 32, 24 + step * k + step * .72));
      });
    });
  }
  const ADS = [['伊予柑ソーダ', '#ff8a1a', '#fff'], ['坊っちゃん不動産', '#1e4f9a', '#fff'], ['マドンナ生命', '#d43a6a', '#fff'],
    ['道後ビール', '#2a2a2a', '#f2c84a'], ['しまなみ自動車', '#127a6a', '#fff'], ['ぬくい湯温泉', '#b0281e', '#fff']];
  G3.adCount = ADS.length;
  function adAtlas() {
    return canvasTex(512, 128 * ADS.length, (g) => {
      ADS.forEach(([t, bg, fg], i) => {
        const y = i * 128;
        const gr = g.createLinearGradient(0, y, 512, y + 128);
        gr.addColorStop(0, bg); gr.addColorStop(1, '#000');
        g.fillStyle = bg; g.fillRect(0, y, 512, 128);
        g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, y, 512, 40);
        g.fillStyle = fg; g.font = '900 58px "Hiragino Sans","Yu Gothic",sans-serif'; g.textAlign = 'center';
        g.fillText(t, 256, y + 86);
        g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 6; g.strokeRect(3, y + 3, 506, 122);
      });
    });
  }

  /* ---------- 地表（土地被覆テクスチャ） ---------- */
  const LCS = 0.45;
  function landcover() {
    const w = Math.round(W * LCS), h = Math.round(H * LCS);
    return canvasTex(w, h, (g) => {
      g.scale(LCS, LCS);
      g.fillStyle = '#a3a585'; g.fillRect(0, 0, W, H);
      // 市街地の舗装・宅地
      for (const z of ZONES) {
        const [x0, y0, x1, y1] = z.r;
        g.fillStyle = 'rgba(160,156,146,.85)';
        g.fillRect(x0 - 60, y0 - 60, x1 - x0 + 120, y1 - y0 + 120);
      }
      g.fillStyle = 'rgba(150,146,138,.9)'; g.fillRect(4300, 1500, 2900, 3000);
      // 敷地のまだら: 駐車場のアスファルト・コンクリート・砂利・土・草むらの不規則な広がり（市街と郊外で割合を変える）
      const r2 = mulberry32(77);
      const KINDS = { asph: [118, 118, 112], conc: [176, 172, 162], grav: [160, 152, 138], soil: [150, 128, 98], weed: [124, 142, 88], grass: [108, 134, 74] };
      const CITY = [['asph', .32], ['conc', .26], ['grav', .2], ['soil', .1], ['weed', .12]];
      const SUB = [['weed', .3], ['grass', .14], ['soil', .2], ['grav', .18], ['asph', .1], ['conc', .08]];
      const pick = (tab) => { let t = r2(); for (const [k, w] of tab) { if ((t -= w) <= 0) return k; } return tab[0][0]; };
      for (let i = 0; i < 30000; i++) {
        const x = r2() * W, y = r2() * H;
        const city = x > 4300 && x < 7200 && y > 1500 && y < 4500;
        const k = pick(city ? CITY : SUB), c = KINDS[k], rad = 7 + r2() * r2() * 40, n = 9;
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.6 + r2() * 0.35).toFixed(2)})`;
        g.beginPath();
        for (let j = 0; j < n; j++) { const a = j / n * TAU, rr = rad * (0.6 + r2() * 0.55); const px = x + Math.cos(a) * rr * 1.25, py = y + Math.sin(a) * rr; j ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.closePath(); g.fill();
      }
      // 建物の足元の汚れ（壁と地面の境目をくっきり）
      g.lineWidth = 3.2; g.strokeStyle = 'rgba(58,54,48,.38)';
      for (const b of buildings) if (!b.noDraw) g.strokeRect(b.x0 - 1.2, b.y0 - 1.2, b.x1 - b.x0 + 2.4, b.y1 - b.y0 + 2.4);
      // 河川敷（草地）
      for (const rv of RIVERS) {
        g.strokeStyle = '#86a062'; g.lineWidth = rv.w + 70; g.lineCap = 'round'; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(rv.pl.pts[0][0], rv.pl.pts[0][1]);
        for (const p of rv.pl.pts) g.lineTo(p[0], p[1]);
        g.stroke();
      }
      // 公園
      for (const p of PARKS) {
        g.fillStyle = '#7c9e57';
        if (p.k === 'rect') g.fillRect(p.x0, p.y0, p.x1 - p.x0, p.y1 - p.y0);
        else { g.beginPath(); g.arc(p.x, p.y, p.r + 14, 0, TAU); g.fill(); }
      }
      // 城の堀の土手
      g.strokeStyle = '#7f9c5c'; g.lineCap = 'butt';
      for (const mo of MOATS) { g.lineWidth = mo.w + 30; g.beginPath(); mo.pl.pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.stroke(); }
      // 梅津寺ビーチ
      g.fillStyle = '#d8c79c'; g.beginPath(); g.ellipse(1160, 940, 40, 110, -.25, 0, TAU); g.fill();
      // 空港（芝＋エプロン）
      g.fillStyle = '#90a76a'; g.fillRect(560, 4180, 1080, 760);
      g.fillStyle = '#8d8e8c'; g.fillRect(900, 4350, 330, 230);
      // 坊っちゃんスタジアムの外周・グラウンド
      g.fillStyle = '#8e8f8a'; g.beginPath(); g.ellipse(5155, 5200, 175, 135, 0, 0, TAU); g.fill();
      g.fillStyle = '#6f9a50'; g.beginPath(); g.ellipse(5155, 5200, 118, 82, 0, 0, TAU); g.fill();
      g.fillStyle = '#c8a878'; g.beginPath(); g.moveTo(5155, 5246); g.lineTo(5113, 5200); g.lineTo(5155, 5154); g.lineTo(5197, 5200); g.closePath(); g.fill();
      // 大学の芝生・校庭・駐車場
      for (const l of LMS) if (l.t === 'campus') { const s = l.solid; g.fillStyle = '#8eaa6c'; g.fillRect(s[0] - 20, s[1] - 20, s[2] - s[0] + 40, s[3] - s[1] + 40); }
      g.fillStyle = '#c4ae86'; g.fillRect(6800, 3384, 160, 90); g.fillRect(5170, 4086, 160, 99);
      g.fillStyle = '#8b8c88'; g.fillRect(4950, 3240, 110, 110);
      g.strokeStyle = 'rgba(240,240,240,.8)'; g.lineWidth = 1.2;
      g.beginPath();
      for (let xx = 4958; xx <= 5050; xx += 11) { g.moveTo(xx, 3246); g.lineTo(xx, 3266); g.moveTo(xx, 3324); g.lineTo(xx, 3344); }
      g.stroke();
      // 二之丸庭園
      g.fillStyle = '#b6cf94'; g.fillRect(5660, 2960, 80, 60);
      // 港の岸壁（コンクリート）
      g.fillStyle = '#9c9c96';
      g.fillRect(860, 1690, 160, 120); g.fillRect(1230, 580, 200, 140); g.fillRect(4400, 250, 170, 110);
    });
  }

  function buildGround(scene) {
    const t = landcover();
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    WM.ground.map = t;
    const det = G3.tex.detail;
    WM.ground.onBeforeCompile = sh => {
      sh.uniforms.uDet = { value: det };
      sh.uniforms.uGrass = { value: G3.tex.grass };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP=(modelMatrix*vec4(transformed,1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP;uniform sampler2D uDet,uGrass;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float dA=texture2D(uDet,vWP.xz/26.).r, dB=texture2D(uDet,vWP.xz/230.).r;
          vec3 gr=texture2D(uGrass,vWP.xz/30.).rgb;
          float greenish=clamp((diffuseColor.g-max(diffuseColor.r,diffuseColor.b))*12.,0.,1.);
          diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*gr*2.1,greenish*.75);
          diffuseColor.rgb*=0.78+0.32*dA+0.22*(dB-.5);`);
    };
    // 陸地ポリゴン（海を除く）。ShapeはXY平面で (x, -y) を使い -90°回転して XZ へ。
    const coast = SEA.slice(3, SEA.length - 1); // [7050,90] .. [520,5300]
    const land = [[40000, 90], ...coast, [600, 5700], [700, 40000], [40000, 40000]];
    const mk = pts => {
      const sh = new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], -p[1])));
      const g = new THREE.ShapeGeometry(sh);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / W, 1 - pos.getZ(i) / H);
      return g;
    };
    const gm = new THREE.Mesh(T3.mergeGeometries([mk(land), mk(ISLAND)]), WM.ground);
    gm.receiveShadow = true;
    scene.add(gm);
    // 北の陸地（海岸線の東側の北）
    const north = new THREE.Mesh(mk([[7050, 90], [40000, 90], [40000, -40000], [9000, -40000], [7050, -100]]), WM.ground);
    scene.add(north);
    // 護岸（海側へ落ちる垂直面）
    const gb = new GB(true);
    const sk = [...coast, [600, 5700]];
    for (let i = 1; i < sk.length; i++) {
      const a = sk[i - 1], b = sk[i];
      gb.quad([[a[0], 0, a[1]], [a[0], -3, a[1]], [b[0], -3, b[1]], [b[0], 0, b[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], C('#8f8c84'));
    }
    for (let i = 0; i < ISLAND.length; i++) {
      const a = ISLAND[i], b = ISLAND[(i + 1) % ISLAND.length];
      gb.quad([[b[0], 0, b[1]], [b[0], -3, b[1]], [a[0], -3, a[1]], [a[0], 0, a[1]]], [[0, 0], [0, 1], [1, 1], [1, 0]], C('#b9a882'));
    }
    scene.add(gb.mesh(WM.concrete, false));
  }

  /* ---------- 水面 ---------- */
  function buildWater(scene) {
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000), WM.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(W / 2, -0.8, H / 2);
    sea.receiveShadow = true;
    scene.add(sea);
    const wm2 = WM.water.clone();
    wm2.polygonOffset = true; wm2.polygonOffsetFactor = -1; wm2.polygonOffsetUnits = -2;
    wm2.color.set(0x2c5a5c);
    if (wm2.normalMap) { wm2.normalMap = WM.water.normalMap; }
    const gb = new GB(false);
    for (const rv of RIVERS) ribbon(gb, rv.pl.pts, -rv.w / 2, rv.w / 2, () => 0.05, 30);
    // 堀（MOATS: 松山城・道後公園）
    for (const mo of MOATS) ribbon(gb, mo.pl.pts, -mo.w / 2, mo.w / 2, () => 0.05, 30);
    const m = gb.mesh(wm2, false);
    scene.add(m);
    // 石垣の護岸: 道路・歩道橋が渡る所は切る
    const sw = new GB(false);
    MOATS.forEach((mo, mi) => {
      const cuts = [];
      let c0 = null;
      for (let d = 0; d <= mo.pl.len + 2; d += 2) {
        const p = plAt(mo.pl, Math.min(d, mo.pl.len));
        const ri = roadInfo(p.x, p.y);
        const wet = !(ri && ri.road.kind !== 'arcade' && ri.d < ri.road.w / 2 + SW + 1);
        if (!wet && c0 === null) c0 = d;
        if (wet && c0 !== null) { cuts.push([c0 - 1, d + 1]); c0 = null; }
      }
      if (c0 !== null) cuts.push([c0 - 1, mo.pl.len]);
      for (const f of FOOTBRIDGES) if (f.m === mi) cuts.push([f.d - f.w / 2 - 0.5, f.d + f.w / 2 + 0.5]);
      for (const [a, b] of minusIntervals(mo.pl.len, cuts)) {
        const pts = subPts(mo.pl, a, b);
        if (pts.length < 2) continue;
        wallStrip(sw, pts, -mo.w / 2, -0.6, 3.2);
        wallStrip(sw, pts, mo.w / 2, -0.6, 3.2);
        // 天端（笠石）
        ribbon(sw, pts, -mo.w / 2 - 1.1, -mo.w / 2, () => 3.2, 6);
        ribbon(sw, pts, mo.w / 2, mo.w / 2 + 1.1, () => 3.2, 6);
        wallStrip(sw, pts, -mo.w / 2 - 1.1, 0, 3.2);
        wallStrip(sw, pts, mo.w / 2 + 1.1, 0, 3.2);
      }
    });
    scene.add(sw.mesh(WM.stone, false));
    buildBridges(scene);
  }



  /* ---------- 道後公園（湯築城跡）: 土塁の盛り土と砂利の園路 ---------- */
  function buildYuzuki(scene) {
    if (typeof YUZUKI === 'undefined') return;
    const Y = YUZUKI, gbM = new GB(true), gbP = new GB(true);
    // 土塁（高さは heightAt と同じ yuzukiMound）
    const NA = 220, NR = 10;
    for (let i = 0; i < NA; i++) for (let j = 0; j < NR; j++) {
      const a0 = i / NA * TAU, a1 = (i + 1) / NA * TAU, r0 = Y.r0 - 1 + (Y.r1 - Y.r0 + 2) * j / NR, r1 = Y.r0 - 1 + (Y.r1 - Y.r0 + 2) * (j + 1) / NR;
      const P = (r, a) => { const x = Y.x + Math.cos(a) * r, z = Y.y + Math.sin(a) * r; return [x, yuzukiMound(x, z) + 0.04, z]; };
      const A = P(r0, a0), B = P(r0, a1), Cc = P(r1, a1), D = P(r1, a0);
      if (A[1] + B[1] + Cc[1] + D[1] < 0.3) continue;
      const sh = 0.86 + 0.14 * Math.sin((j + 0.5) / NR * Math.PI);
      gbM.quad([A, D, Cc, B], [[A[0] / 30, A[2] / 30], [D[0] / 30, D[2] / 30], [Cc[0] / 30, Cc[2] / 30], [B[0] / 30, B[2] / 30]], C('#6f8a52').map(v => v * sh));
    }
    // 園路: 橋の切れ目から本壇のふもとへ、と内側を一周
    const path = (pts, w) => ribbon(gbP, pts, -w / 2, w / 2, (x, z) => heightAt(x, z) + 0.08, 6, C('#d8ccb0'));
    for (const g of Y.gaps) {
      const pts = [];
      const cp = Y.compound;
      for (let r = Y.r1 + 2; r >= 44; r -= 4) {
        const x = Y.x + Math.cos(g) * r, z = Y.y + Math.sin(g) * r;
        if (x > cp[0] - 4 && x < cp[2] + 4 && z > cp[1] - 4 && z < cp[3] + 4) break;   // 屋敷の塀の手前で止める
        pts.push([x, z]);
      }
      if (pts.length > 1) path(pts, 7);
    }
    const ring = [];
    for (let i = 0; i <= 96; i++) { const a = i / 96 * TAU; ring.push([Y.x + Math.cos(a) * 77, Y.y + Math.sin(a) * 77]); }
    path(ring, 5);
    const mp = new THREE.MeshStandardMaterial({ map: G3.tex.gravel, vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
    const mm = gbM.mesh(WM.hill, false); mm.receiveShadow = true;
    const pm = gbP.mesh(mp, false); pm.receiveShadow = true;
    scene.add(mm, pm);
  }

  /* ---------- みかん山の段々畑（石積み・みかんの列・農道・モノレールと運搬車） ---------- */
  function buildEstates(scene) {
    if (typeof ESTATES === 'undefined' || !ESTATES.length) return;
    const gbW = new GB(true), gbR = new GB(true), gbP = new GB(true), gbM = new GB(true);
    const rs = mulberry32(9401);
    const rowTex = canvasTex(128, 128, g => {   // みかんの葉と実
      const r2 = mulberry32(9402);
      g.fillStyle = '#2c4a22'; g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 260; i++) { g.fillStyle = ['#3b5e2b', '#2f5226', '#4a6e34', '#24401c'][(r2() * 4) | 0]; g.beginPath(); g.ellipse(r2() * 128, r2() * 128, 4 + r2() * 4, 2 + r2() * 2, r2() * 3, 0, TAU); g.fill(); }
      for (let i = 0; i < 34; i++) { const x = r2() * 128, y = 10 + r2() * 108; g.fillStyle = '#f08a1c'; g.beginPath(); g.arc(x, y, 2.6 + r2() * 1.2, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,220,150,.6)'; g.beginPath(); g.arc(x - 0.8, y - 0.8, 0.9, 0, TAU); g.fill(); }
    });
    rowTex.wrapS = rowTex.wrapT = THREE.RepeatWrapping;
    for (const e of ESTATES) {
      const h = HILLS[e.hi], Rav = (h.rx + h.ry) / 2;
      const N = t => { const nx = Math.cos(t) / h.rx, ny = Math.sin(t) / h.ry, l = Math.hypot(nx, ny); return [nx / l, ny / l]; };   // 外向き（下り）
      const T = t => { const tx = -Math.sin(t) * h.rx, ty = Math.cos(t) * h.ry, l = Math.hypot(tx, ty); return [tx / l, ty / l]; };
      const g = (x, y) => heightAt(x, y);
      // 石積みの段: 下り側の面＋天端
      for (const w of e.walls) for (const [t0, t1] of w.segs) {
        const st = 3.5 / (w.r * Rav);
        let A = null;
        for (let t = t0; ; t += st) {
          const tt = Math.min(t, t1), [x, y] = estatePt(e, w.r, tt), n = N(tt);
          const top = g(x, y) + 0.7, bot = g(x + n[0] * 3, y + n[1] * 3) - 0.4;
          const B = { x, y, ix: x - n[0] * 0.8, iy: y - n[1] * 0.8, top, bot };
          if (A) {
            const c = C(rs() < 0.5 ? '#a19c90' : '#948f84');
            gbW.quad([[A.x, A.bot, A.y], [B.x, B.bot, B.y], [B.x, B.top, B.y], [A.x, A.top, A.y]], [[0, 0], [st * w.r * Rav / 3, 0], [st * w.r * Rav / 3, (B.top - B.bot) / 3], [0, (A.top - A.bot) / 3]], c);
            gbW.quad([[A.x, A.top, A.y], [B.x, B.top, B.y], [B.ix, B.top, B.iy], [A.ix, A.top, A.iy]], [[0, 0], [1, 0], [1, 0.25], [0, 0.25]], c.map(v => v * 1.08));
          }
          A = B;
          if (tt >= t1) break;
        }
      }
      // みかんの列（生け垣状。高さ約0.9m）
      for (const w of e.rows) for (const [t0, t1] of w.segs) {
        const st = 3.5 / (w.r * Rav);
        let A = null, u = 0;
        for (let t = t0; ; t += st) {
          const tt = Math.min(t, t1), [x, y] = estatePt(e, w.r, tt), n = N(tt);
          const P = o => [x + n[0] * o, y + n[1] * o];
          const [ox, oy] = P(1.3), [ix, iy] = P(-1.3), [ox2, oy2] = P(0.8), [ix2, iy2] = P(-0.8);
          const gm = g(x, y);
          const B = { o: [ox, g(ox, oy), oy], i: [ix, g(ix, iy), iy], o2: [ox2, gm + 2.3, oy2], i2: [ix2, gm + 2.3, iy2], u };
          if (A) {
            const u0 = A.u / 6, u1 = B.u / 6, col = C(rs() < 0.5 ? '#ffffff' : '#e6eedc');
            gbR.quad([A.o, B.o, B.o2, A.o2], [[u0, 0], [u1, 0], [u1, 0.45], [u0, 0.45]], col);
            gbR.quad([A.o2, B.o2, B.i2, A.i2], [[u0, 0.45], [u1, 0.45], [u1, 0.7], [u0, 0.7]], col);
            gbR.quad([A.i2, B.i2, B.i, A.i], [[u0, 0.7], [u1, 0.7], [u1, 1.15], [u0, 1.15]], col);
          }
          A = B; u += st * w.r * Rav;
          if (tt >= t1) break;
        }
      }
      // 農道（コンクリート）: 山すそから上へ
      const rTop = e.R0 - 0.02, rBot = e.R1 + 0.04, tw = T(e.tc);
      let A = null;
      for (let r = rBot; r >= rTop - 1e-9; r -= 4 / Rav) {
        const [x, y] = estatePt(e, r, e.tc);
        const L = [x + tw[0] * 4.5, y + tw[1] * 4.5], R = [x - tw[0] * 4.5, y - tw[1] * 4.5];
        const B = [[L[0], g(L[0], L[1]) + 0.4, L[1]], [R[0], g(R[0], R[1]) + 0.4, R[1]]];   // 山の面は粗い多角形なので少し浮かせる
        if (A) gbP.quad([A[0], A[1], B[1], B[0]], [[0, 0], [1, 0], [1, 1.3], [0, 1.3]], C('#c4c0b6'));
        A = B;
      }
      // モノレール（支柱＋角レール）
      const rt = r => e.tc + 9 / (r * Rav);
      const railPts = [];
      for (let r = e.railT0; r >= e.railT1 - 1e-9; r -= 2.5 / Rav) { const [x, y] = estatePt(e, r, rt(r)); railPts.push([x, g(x, y) + 1.7, y]); }
      for (let i = 0; i < railPts.length; i++) {
        const p = railPts[i];
        if (i % 2 === 0) gbM.box(p[0] - 0.12, p[1] - 1.75, p[2] - 0.12, p[0] + 0.12, p[1], p[2] + 0.12, C('#9aa0a4'), 2);
        if (i) {
          const q = railPts[i - 1], dx = p[0] - q[0], dz = p[2] - q[2], l = Math.hypot(dx, dz) || 1, sx = -dz / l * 0.2, sz = dx / l * 0.2;
          gbM.quad([[q[0] + sx, q[1], q[2] + sz], [p[0] + sx, p[1], p[2] + sz], [p[0] + sx, p[1] + 0.45, p[2] + sz], [q[0] + sx, q[1] + 0.45, q[2] + sz]], [[0, 0], [1, 0], [1, 1], [0, 1]], C('#b4babe'));
          gbM.quad([[q[0] - sx, q[1] + 0.45, q[2] - sz], [p[0] - sx, p[1] + 0.45, p[2] - sz], [p[0] - sx, p[1], p[2] - sz], [q[0] - sx, q[1], q[2] - sz]], [[0, 0], [1, 0], [1, 1], [0, 1]], C('#b4babe'));
          gbM.quad([[q[0] - sx, q[1] + 0.45, q[2] - sz], [q[0] + sx, q[1] + 0.45, q[2] + sz], [p[0] + sx, p[1] + 0.45, p[2] + sz], [p[0] - sx, p[1] + 0.45, p[2] - sz]], [[0, 0], [1, 0], [1, 1], [0, 1]], C('#c8ced2'));
        }
      }
      // 運搬車（エンジン＋荷台にみかんのコンテナ）。レールに沿って上り下り
      // 部品は頂点カラーで1メッシュにまとめる（描画回数を増やさない）
      const parts = [];
      const mk = (w2, h2, d2, col, x, y, z) => {
        const gg = new THREE.BoxGeometry(w2, h2, d2).toNonIndexed(); gg.translate(x, y, z);
        const c = new THREE.Color(col), n = gg.attributes.position.count, ca = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) { ca[i * 3] = c.r; ca[i * 3 + 1] = c.g; ca[i * 3 + 2] = c.b; }
        gg.setAttribute('color', new THREE.BufferAttribute(ca, 3)); gg.deleteAttribute('uv'); parts.push(gg);
      };
      mk(1.6, 1.4, 1.4, 0x3a6ea8, 1.6, 1.2, 0); mk(3.0, 0.25, 2.0, 0x8a8e90, -0.6, 0.6, 0);
      for (const [cx, cz] of [[-1.3, -0.5], [-1.3, 0.5], [0.1, -0.5], [0.1, 0.5]]) mk(1.2, 0.8, 0.85, 0xf2a020, cx, 1.15, cz);
      mk(0.5, 0.5, 0.5, 0x222222, 2.2, 1.9, 0.3);
      if (!buildEstates.cartMat) buildEstates.cartMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
      const cart = new THREE.Mesh(T3.mergeGeometries(parts), buildEstates.cartMat);
      cart.castShadow = true;
      scene.add(cart);
      anim.carts.push({ o: cart, pts: railPts, ph: rs() * 100 });
    }
    const mw = new THREE.MeshStandardMaterial({ map: G3.tex.stonewall, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    const mr = new THREE.MeshStandardMaterial({ map: rowTex, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const mp = new THREE.MeshStandardMaterial({ map: G3.tex.concrete, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
    for (const [gb, m, sh] of [[gbW, mw, true], [gbR, mr, true], [gbP, mp, false], [gbM, WM.metal, true]]) { const o = gb.mesh(m, sh); o.receiveShadow = true; scene.add(o); }
  }

  /* ---------- 河川敷（遊歩道・護岸の石張り・飛び石・中州） ---------- */
  function buildRiverside(scene) {
    if (typeof RIVERSIDE === 'undefined') return;
    const gbP = new GB(true), gbR = new GB(true), gbS = new GB(true);
    // 橋の欄干などに掛かる所で遊歩道を切る（橋は buildWater で先にできている）
    const trimmed = [];
    for (const w of RIVERSIDE.walks) {
      const rv = RIVERS[w.ri];
      let d0 = null;
      for (let d = w.d0; d <= w.d1 + 3; d += 3) {
        const dd = Math.min(d, w.d1), p = plAt(rv.pl, dd);
        let ok = d <= w.d1;
        if (ok) for (const off of [6, 9, 12]) { const o = w.sg * (rv.w / 2 + off); if (typeof propHit === 'function' && propHit(p.x - Math.sin(p.a) * o, p.y + Math.cos(p.a) * o, 1.2, false)) { ok = false; break; } }
        if (ok && d0 === null) d0 = dd;
        if (!ok && d0 !== null) { if (dd - d0 >= 30) trimmed.push({ ...w, d0, d1: dd - 4 }); d0 = null; }
      }
    }
    RIVERSIDE.walks = trimmed;
    // 遊歩道（ダスト舗装の帯＋縁石）
    for (const w of RIVERSIDE.walks) {
      const rv = RIVERS[w.ri], pts = subPts(rv.pl, w.d0, w.d1);
      const o0 = w.sg * (rv.w / 2 + 5.5), o1 = w.sg * (rv.w / 2 + 12.5);
      ribbon(gbP, pts, Math.min(o0, o1), Math.max(o0, o1), () => 0.07, 8, C('#efdcb2'));
      for (const o of [o0, o1]) ribbon(gbP, pts, o - 0.3, o + 0.3, () => 0.18, 4, C('#a8a49a'));
    }
    // 水際の石張り護岸（両岸、道路の橋の所は橋が上に載る）
    for (const rv of RIVERS) for (const sg of [1, -1]) {
      const o0 = sg * (rv.w / 2 - 2.5), o1 = sg * (rv.w / 2 + 2.2);
      ribbon(gbR, rv.pl.pts, Math.min(o0, o1), Math.max(o0, o1), () => 0.09, 5, C('#9d998f'));
    }
    // 飛び石（平たい石を少しずらして並べる）
    const rs = mulberry32(9302);
    for (const s of STEPSTONES) {
      const L = hyp(s.bx - s.ax, s.by - s.ay), ux = (s.bx - s.ax) / L, uy = (s.by - s.ay) / L;
      for (let d = 1.3; d < L; d += 2.7) {
        const lat = (rs() - 0.5) * 1.0, x = s.ax + ux * d - uy * lat, y = s.ay + uy * d + ux * lat, r0 = 1.15 + rs() * 0.3;
        const k = 9, P = [];
        for (let i = 0; i < k; i++) { const a = i / k * TAU, rr = r0 * (0.85 + rs() * 0.3); P.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
        const top = 0.22 + rs() * 0.06, col = C(rs() < 0.5 ? '#a9a59b' : '#b8b3a8');
        for (let i = 0; i < k; i++) {
          const a = P[i], b = P[(i + 1) % k];
          gbS.tri([[x, top, y], [b[0], top, b[1]], [a[0], top, a[1]]], [[0, 0], [1, 0], [0, 1]], col);
          gbS.quad([[a[0], -0.4, a[1]], [b[0], -0.4, b[1]], [b[0], top, b[1]], [a[0], top, a[1]]], [[0, 0], [1, 0], [1, 1], [0, 1]], col.map(v => v * 0.8));
        }
      }
    }
    // 重信川の中州（砂利の楕円）
    for (const b of RIVERSIDE.bars) {
      const k = 18, ca = Math.cos(b.a), sa = Math.sin(b.a), P = [];
      for (let i = 0; i < k; i++) { const t = i / k * TAU, u = Math.cos(t) * b.l / 2, v = Math.sin(t) * b.w / 2 * (0.8 + 0.2 * Math.cos(t * 3)); P.push([b.x + ca * u - sa * v, b.y + sa * u + ca * v]); }
      for (let i = 0; i < k; i++) { const a = P[i], c = P[(i + 1) % k]; gbS.tri([[b.x, 0.1, b.y], [c[0], 0.1, c[1]], [a[0], 0.1, a[1]]], [[b.x / 8, b.y / 8], [c[0] / 8, c[1] / 8], [a[0] / 8, a[1] / 8]], C('#c9bfa8')); }
    }
    const off = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 };
    const mp = new THREE.MeshStandardMaterial({ map: G3.tex.gravel, vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, ...off });
    const mr = new THREE.MeshStandardMaterial({ map: G3.tex.stonewall, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, ...off });
    const ms = new THREE.MeshStandardMaterial({ map: G3.tex.gravel, vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    for (const [gb, m] of [[gbP, mp], [gbR, mr], [gbS, ms]]) { const o = gb.mesh(m, false); o.receiveShadow = true; scene.add(o); }
  }

  /* ---------- 用水路（CANALS: 田畑のあいだのコンクリート水路・板橋・暗渠の口・水門） ---------- */
  function buildCanals(scene) {
    if (typeof CANALS === 'undefined' || !CANALS.length) return;
    const gbW = new GB(false), gbC = new GB(true), gbM = new GB(true);
    const h = CANAL_W / 2, th = 0.55, top = 1.0, wy = 0.07;
    const cOut = C('#bdbab0'), cTop = C('#cfccc2'), cIn = C('#7c8074'), cBr = C('#c4c1b7'), cHole = C('#1c1e1d');
    // 軸に沿った座標 t と横方向 o から (x, z) へ
    const P = (cn, t, o, y) => cn.vert ? [cn.c + o, y, t] : [t, y, cn.c + o];
    const face = (gb, a, b, c, d, col, uw, uh) => gb.quad([a, b, c, d], [[0, 0], [uw / 3, 0], [uw / 3, uh / 3], [0, uh / 3]], col);
    const crossWall = (cn, t, dir, hole) => {   // 水路を横切る壁（端・暗渠の口）。dir は水のある側
      const t0 = Math.min(t, t + dir * th), t1 = Math.max(t, t + dir * th);
      face(gbC, P(cn, t0, -h, 0), P(cn, t0, h, 0), P(cn, t0, h, top), P(cn, t0, -h, top), cOut, CANAL_W, top);
      face(gbC, P(cn, t1, -h, 0), P(cn, t1, h, 0), P(cn, t1, h, top), P(cn, t1, -h, top), cOut, CANAL_W, top);
      face(gbC, P(cn, t0, -h, top), P(cn, t1, -h, top), P(cn, t1, h, top), P(cn, t0, h, top), cTop, th, CANAL_W);
      if (hole) { const tf = dir > 0 ? t1 + 0.02 : t0 - 0.02; face(gbC, P(cn, tf, -1.1, wy), P(cn, tf, 1.1, wy), P(cn, tf, 1.1, wy + 0.75), P(cn, tf, -1.1, wy + 0.75), cHole, 2.2, 0.75); }
    };
    let nb = 0, ng = 0;
    for (const cn of CANALS) {
      cn.parts.forEach((p, i) => {
        const [k, a, b] = p;
        if (k === 'c') return;
        if (k === 'b') {   // 板橋（地面とほぼ同じ高さのコンクリート板）
          const A = P(cn, a, -h - 0.4, 0), B = P(cn, b, h + 0.4, 0);
          gbC.box(Math.min(A[0], B[0]), 0, Math.min(A[2], B[2]), Math.max(A[0], B[0]), 0.22, Math.max(A[2], B[2]), cBr, 3);
          // 3つに1つは小さな水門（ハンドル付き）
          if (nb++ % 3 === 1) {
            const g0 = P(cn, b + 0.6, -h, 0), g1 = P(cn, b + 0.6, h, 0);
            const st = C('#5f7f96');
            for (const q of [g0, g1]) gbM.box(q[0] - 0.18, 0, q[2] - 0.18, q[0] + 0.18, 3.4, q[2] + 0.18, st, 3);
            const m0 = P(cn, b + 0.42, -h, 3.0), m1 = P(cn, b + 0.78, h, 3.4);
            gbM.box(Math.min(m0[0], m1[0]), 3.0, Math.min(m0[2], m1[2]), Math.max(m0[0], m1[0]), 3.4, Math.max(m0[2], m1[2]), st, 3);
            const p0 = P(cn, b + 0.5, -h + th, 0.2), p1 = P(cn, b + 0.7, h - th, 1.6);
            gbM.box(Math.min(p0[0], p1[0]), 0.2, Math.min(p0[2], p1[2]), Math.max(p0[0], p1[0]), 1.6, Math.max(p0[2], p1[2]), C('#6a6e6c'), 3);
            const w0 = P(cn, b + 0.6, -0.5, 3.4), w1 = P(cn, b + 0.6, 0.5, 3.5);
            gbM.box(Math.min(w0[0], w1[0]) - 0.5 * !cn.vert, 3.4, Math.min(w0[2], w1[2]) - 0.5 * cn.vert, Math.max(w0[0], w1[0]) + 0.5 * !cn.vert, 3.55, Math.max(w0[2], w1[2]) + 0.5 * cn.vert, C('#c23a2e'), 3);
            ng++;
          }
          return;
        }
        // 水面
        const q = [P(cn, a, -h + th, wy), P(cn, b, -h + th, wy), P(cn, b, h - th, wy), P(cn, a, h - th, wy)];
        gbW.quad(q, q.map(v => [v[0] / 8, v[2] / 8]));
        // 両側の壁: 外面・天端・内面（湿って暗い）
        for (const s of [-1, 1]) {
          const oO = s * h, oI = s * (h - th);
          face(gbC, P(cn, a, oO, 0), P(cn, b, oO, 0), P(cn, b, oO, top), P(cn, a, oO, top), cOut, b - a, top);
          face(gbC, P(cn, a, oO, top), P(cn, b, oO, top), P(cn, b, oI, top), P(cn, a, oI, top), cTop, b - a, th);
          face(gbC, P(cn, a, oI, wy), P(cn, b, oI, wy), P(cn, b, oI, top), P(cn, a, oI, top), cIn, b - a, top);
          for (const t of [a, b]) face(gbC, P(cn, t, oO, 0), P(cn, t, oI, 0), P(cn, t, oI, top), P(cn, t, oO, top), cOut, th, top);
        }
        // 端は横壁で閉じ、暗渠の手前には管の口をつける
        const prev = cn.parts[i - 1], next = cn.parts[i + 1];
        if (!prev) crossWall(cn, a, 1, false); else if (prev[0] === 'c') crossWall(cn, a, 1, true);
        if (!next) crossWall(cn, b, -1, false); else if (next[0] === 'c') crossWall(cn, b, -1, true);
      });
    }
    const mc = new THREE.MeshStandardMaterial({ map: G3.tex.concrete, vertexColors: true, roughness: 0.92, side: THREE.DoubleSide });
    const mw = WM.water.clone();
    mw.color.set(0x34503f); mw.polygonOffset = true; mw.polygonOffsetFactor = -2; mw.polygonOffsetUnits = -4;
    const wm = gbW.mesh(mw, false); wm.receiveShadow = true;
    scene.add(wm, gbC.mesh(mc, true), gbM.mesh(WM.metal, true));
    G3.canalStats = { canals: CANALS.length, bridges: nb, gates: ng };
  }
  /* ---------- 橋（道路×川・堀、鉄道×川、堀の歩道橋） ---------- */
  function riverAt(x, y) {
    for (const rv of RIVERS) {
      const p = rv.pl.pts;
      for (let i = 1; i < p.length; i++) if (seg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]).d < rv.w / 2 + 2) return true;
    }
    return !!moatAt(x, y);
  }
  function buildBridges(scene) {
    const gbP = new GB(false), gbG = new GB(false), gbD = new GB(false), gbR = new GB(false);
    const parapet = (pts, off, h, th, gb) => {
      const o0 = off - th / 2, o1 = off + th / 2;
      wallStrip(gb, pts, o1, 0.3, h); wallStrip(gb, pts, o0, 0.3, h);   // 両面マテリアル
      ribbon(gb, pts, o0, o1, () => h, 4);
    };
    const collideAlong = (pl, a, b, off, th) => {
      for (let d = a; d < b; d += 8) {
        const e = Math.min(b, d + 8), p = plAt(pl, (d + e) / 2);
        const nx = -Math.sin(p.a), ny = Math.cos(p.a);
        addCollider({ x: p.x + nx * off, y: p.y + ny * off, hx: (e - d) / 2 + 0.5, hy: th / 2 + 0.2, a: p.a, m: 3 });
      }
    };
    const spans = (pl, test) => {
      const out = [];
      let s0 = null;
      for (let d = 0; d <= pl.len; d += 2) {
        const p = plAt(pl, d), w = test(p.x, p.y);
        if (w && s0 === null) s0 = d;
        if (!w && s0 !== null) { out.push([Math.max(0, s0 - 5), Math.min(pl.len, d + 3)]); s0 = null; }
      }
      if (s0 !== null) out.push([Math.max(0, s0 - 5), pl.len]);
      return out;
    };
    let nb = 0;
    for (const r of ROADS) {
      if (r.kind === 'arcade') continue;
      for (const [a, b] of spans(r.pl, riverAt)) {
        const pts = subPts(r.pl, a, b);
        if (pts.length < 2) continue;
        const off = r.w / 2 + SW + 0.6;
        for (const sg of [1, -1]) {
          parapet(pts, sg * off, 3.0, 0.9, gbP);
          collideAlong(r.pl, a, b, sg * off, 0.9);
        }
        // 橋桁の側面（水面まで）
        wallStrip(gbG, pts, off + 0.45, -1.2, 0.3); wallStrip(gbG, pts, -off - 0.45, -1.2, 0.3);
        nb++;
      }
    }
    // 鉄道橋（ガーダー）
    for (const rl of RAILS) {
      for (const [a, b] of spans(rl.pl, (x, y) => RIVERS.some(rv => { const p = rv.pl.pts; for (let i = 1; i < p.length; i++) if (seg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]).d < rv.w / 2 + 2) return true; return false; }))) {
        const pts = subPts(rl.pl, a, b);
        if (pts.length < 2) continue;
        for (const sg of [1, -1]) parapet(pts, sg * 6.2, 2.6, 0.6, gbR);
      }
    }
    // 堀の歩道橋（太鼓橋風の欄干つき）
    for (const f of FOOTBRIDGES) {
      const mo = MOATS[f.m], p = plAt(mo.pl, f.d);
      const nx = -Math.sin(p.a), ny = Math.cos(p.a), tx = Math.cos(p.a), ty = Math.sin(p.a);
      const L = mo.w / 2 + 4;
      const A = [p.x - nx * L, p.y - ny * L], B = [p.x + nx * L, p.y + ny * L];
      const bpl = buildPl([A, B]);
      const pts = [A, B];
      ribbon(gbD, pts, -f.w / 2, f.w / 2, () => 0.16, 6);
      for (const sg of [1, -1]) {
        parapet(pts, sg * (f.w / 2 + 0.3), 2.6, 0.5, f.m === 1 ? gbR : gbP);
        collideAlong(bpl, 0, bpl.len, sg * (f.w / 2 + 0.3), 0.5);
      }
    }
    const conc = new THREE.MeshStandardMaterial({ map: G3.tex.concrete || null, color: 0xd6d2c8, roughness: 0.85, side: THREE.DoubleSide });
    scene.add(gbP.mesh(conc, true), gbG.mesh(conc, false));
    scene.add(gbD.mesh(new THREE.MeshStandardMaterial({ color: 0x9a8a72, roughness: 0.85 }), true));
    scene.add(gbR.mesh(new THREE.MeshStandardMaterial({ color: 0xa3402e, roughness: 0.6, side: THREE.DoubleSide }), true));
    anim.bridges = nb;
  }
  function wallStrip(gb, pts, off, y0, y1) {
    const n = miterNormals(pts);
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const L = hyp(b[0] - a[0], b[1] - a[1]);
      const ax = a[0] + n[i - 1][0] * off, az = a[1] + n[i - 1][1] * off;
      const bx = b[0] + n[i][0] * off, bz = b[1] + n[i][1] * off;
      gb.quad([[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [[d / 6, 0], [(d + L) / 6, 0], [(d + L) / 6, (y1 - y0) / 6], [d / 6, (y1 - y0) / 6]]);
      d += L;
    }
  }

  /* ---------- リボン（ポリラインの帯） ---------- */
  function miterNormals(pts) {
    const n = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx, ty;
      if (i === 0) { tx = b[0] - p[0]; ty = b[1] - p[1]; }
      else if (i === pts.length - 1) { tx = p[0] - a[0]; ty = p[1] - a[1]; }
      else {
        const l1 = hyp(p[0] - a[0], p[1] - a[1]) || 1, l2 = hyp(b[0] - p[0], b[1] - p[1]) || 1;
        tx = (p[0] - a[0]) / l1 + (b[0] - p[0]) / l2; ty = (p[1] - a[1]) / l1 + (b[1] - p[1]) / l2;
      }
      const l = hyp(tx, ty) || 1; tx /= l; ty /= l;
      let nx = -ty, ny = tx;
      if (i > 0 && i < pts.length - 1) {
        const sx = p[0] - a[0], sy = p[1] - a[1], sl = hyp(sx, sy) || 1;
        const dot = (nx * -sy / sl + ny * sx / sl);
        const k = 1 / Math.max(0.5, Math.abs(dot));
        nx *= k; ny *= k;
      }
      n.push([nx, ny]);
    }
    return n;
  }
  // 横断方向 [o0,o1] の帯。yfn(x,z) で高さ、uvs: テクスチャ1枚のワールド長。
  function ribbon(gb, pts, o0, o1, yfn, uvs, col, d0 = 0) {
    if (pts.length < 2) return;
    const n = miterNormals(pts);
    let d = d0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const L = hyp(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const P0 = [a[0] + n[i - 1][0] * o0, a[1] + n[i - 1][1] * o0], P1 = [a[0] + n[i - 1][0] * o1, a[1] + n[i - 1][1] * o1];
      const P2 = [b[0] + n[i][0] * o1, b[1] + n[i][1] * o1], P3 = [b[0] + n[i][0] * o0, b[1] + n[i][1] * o0];
      gb.quad([[P0[0], yfn(P0[0], P0[1]), P0[1]], [P1[0], yfn(P1[0], P1[1]), P1[1]], [P2[0], yfn(P2[0], P2[1]), P2[1]], [P3[0], yfn(P3[0], P3[1]), P3[1]]],
        [[d / uvs, o0 / uvs], [d / uvs, o1 / uvs], [(d + L) / uvs, o1 / uvs], [(d + L) / uvs, o0 / uvs]], col);
      d += L;
    }
  }
  // 側面（縁石など）: オフセット off で高さ y0→y1、outward=+1 で外向き
  function curbWall(gb, pts, off, y0fn, y1fn, side) {
    const n = miterNormals(pts);
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const L = hyp(b[0] - a[0], b[1] - a[1]);
      if (L < 0.01) continue;
      const A = [a[0] + n[i - 1][0] * off, a[1] + n[i - 1][1] * off], B = [b[0] + n[i][0] * off, b[1] + n[i][1] * off];
      const ya0 = y0fn(A[0], A[1]), ya1 = y1fn(A[0], A[1]), yb0 = y0fn(B[0], B[1]), yb1 = y1fn(B[0], B[1]);
      if (side > 0) gb.quad([[A[0], ya0, A[1]], [B[0], yb0, B[1]], [B[0], yb1, B[1]], [A[0], ya1, A[1]]], [[d / 4, 0], [(d + L) / 4, 0], [(d + L) / 4, .1], [d / 4, .1]]);
      else gb.quad([[B[0], yb0, B[1]], [A[0], ya0, A[1]], [A[0], ya1, A[1]], [B[0], yb1, B[1]]], [[d / 4, 0], [(d + L) / 4, 0], [(d + L) / 4, .1], [d / 4, .1]]);
      d += L;
    }
  }
  // ポリラインの部分区間 [d0,d1]
  function subPts(pl, d0, d1) {
    d0 = clamp(d0, 0, pl.len); d1 = clamp(d1, 0, pl.len);
    if (d1 - d0 < 0.5) return [];
    const out = [];
    const p0 = plAt(pl, d0); out.push([p0.x, p0.y]);
    for (let i = 1; i < pl.pts.length - 1; i++) if (pl.cum[i] > d0 + 0.01 && pl.cum[i] < d1 - 0.01) out.push(pl.pts[i]);
    const p1 = plAt(pl, d1); out.push([p1.x, p1.y]);
    return out;
  }
  function minusIntervals(len, cuts) {
    cuts = cuts.map(c => [Math.max(0, c[0]), Math.min(len, c[1])]).filter(c => c[1] > c[0]).sort((a, b) => a[0] - b[0]);
    const out = [];
    let s = 0;
    for (const c of cuts) { if (c[0] > s) out.push([s, c[0]]); s = Math.max(s, c[1]); }
    if (s < len) out.push([s, len]);
    return out;
  }
  G3.ribbon = ribbon; G3.subPts = subPts; G3.minusIntervals = minusIntervals;

  /* ---------- 丘・山 ---------- */
  function buildHills(scene) {
    const gb = new GB(true);
    for (const h of HILLS3) {
      const R = 30, S = 80;
      const ring = [];
      for (let i = 0; i <= R; i++) {
        const r = i / R, row = [];
        for (let j = 0; j <= S; j++) {
          const a = j / S * TAU;
          const x = h.x + Math.cos(a) * h.rx * r, z = h.y + Math.sin(a) * h.ry * r;
          const y = hillProfile(h, x, z) + 0.02;
          row.push([x, y, z]);
        }
        ring.push(row);
      }
      for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) {
        const a = ring[i][j], b = ring[i][j + 1], c = ring[i + 1][j + 1], d = ring[i + 1][j];
        const sh = h.castle ? 1.0 : 0.8 - 0.25 * (i / R);
        const col = h.castle ? C('#8fa86b') : C(i % 3 ? '#6f8a52' : '#66804b');
        gb.quad([a, b, c, d], [[0, 0], [1, 0], [1, 1], [0, 1]], col.map(v => v * sh));
      }
    }
    const g = gb.geo();
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, WM.hill);
    m.receiveShadow = true;
    scene.add(m);
  }

  /* ---------- 遠景（四国山地・伊予灘の島々） ---------- */
  function buildBackdrop(scene) {
    const gb = new GB(true);
    const cx = W / 2 + 600, cz = H / 2;
    const nz = mulberry32(31);
    const ridge = [];
    for (let i = 0; i < 64; i++) ridge.push(nz());
    const hAt = (a) => {   // 方位角に沿った稜線の高さ（滑らかな乱数）
      const t = ((a / TAU) % 1 + 1) % 1 * 64;
      const i0 = Math.floor(t), f = t - i0;
      const sm = f * f * (3 - 2 * f);
      return ridge[i0 % 64] * (1 - sm) + ridge[(i0 + 1) % 64] * sm;
    };
    // 方位: 0=東, π/2=南。北西〜西は海なので山を低く/なし
    const N = 160;
    for (let i = 0; i < N; i++) {
      const a0 = -Math.PI * 0.55 + i / N * Math.PI * 1.45, a1 = -Math.PI * 0.55 + (i + 1) / N * Math.PI * 1.45;
      for (const [R, amp, base, col] of [[9500, 900, 160, '#56705a'], [12500, 1500, 250, '#6f8590'], [15500, 2100, 300, '#8fa0ab']]) {
        const k0 = Math.sin((i / N) * Math.PI), k1 = Math.sin(((i + 1) / N) * Math.PI);
        const h0 = base + amp * (0.35 + 0.65 * hAt(a0 * 3 + R)) * (0.4 + 0.6 * k0);
        const h1 = base + amp * (0.35 + 0.65 * hAt(a1 * 3 + R)) * (0.4 + 0.6 * k1);
        const P = (a, r, y) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
        gb.quad([P(a0, R, -50), P(a1, R, -50), P(a1, R + 900, h1), P(a0, R + 900, h0)], [[0, 0], [1, 0], [1, 1], [0, 1]], C(col));
      }
    }
    // 伊予灘・瀬戸内の島影（西〜北）
    const isl = [[-3200, 900, 700, 150], [-2600, 2600, 500, 110], [-1800, -1600, 900, 170], [600, -2600, 1200, 220], [3200, -3400, 1600, 260], [-4200, 4200, 1300, 200]];
    for (const [ix, iz, r, h] of isl) {
      const S2 = 14;
      for (let k = 0; k < S2; k++) {
        const a0 = k / S2 * TAU, a1 = (k + 1) / S2 * TAU;
        const p0 = [ix + Math.cos(a0) * r, -1, iz + Math.sin(a0) * r * 0.6], p1 = [ix + Math.cos(a1) * r, -1, iz + Math.sin(a1) * r * 0.6];
        gb.tri([p0, p1, [ix, h, iz]], [[0, 0], [1, 0], [.5, 1]], C('#5b7262'));
      }
    }
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(gb.geo(), m);
    mesh.geometry.computeVertexNormals();
    scene.add(mesh);
  }

  /* ---------- 田畑・ビニールハウス ---------- */
  function buildFields(scene) {
    const gbS = new GB(true), gbP = new GB(true), gbL = new GB(false);
    for (const f of FIELDS) {
      const paddy = ['#9dbf7a', '#a8c684', '#b5cc8e', '#8fb471'].includes(f.c);
      const gb = paddy ? gbP : gbS;
      const x0 = f.x, z0 = f.y, x1 = f.x + f.w, z1 = f.y + f.h, y = 0.06;
      const col = paddy ? [1, 1, 1] : C(f.c).map(v => v * 1.35);
      // 畝の向き: 縦(f.v)なら u=x
      const P = [[x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]];
      gb.quad(P, f.v ? [[x0, z1], [x1, z1], [x1, z0], [x0, z0]].map(q => [q[0] / 20, q[1] / 20]) : [[z1, x0], [z1, x1], [z0, x1], [z0, x0]].map(q => [q[0] / 20, q[1] / 20]), col);
      // 畦
      const L = 0.9, Hh = 0.7;
      gbL.box(x0 - L, 0, z0 - L, x1 + L, Hh, z0, null, 6);
      gbL.box(x0 - L, 0, z1, x1 + L, Hh, z1 + L, null, 6);
      gbL.box(x0 - L, 0, z0, x0, Hh, z1, null, 6);
      gbL.box(x1, 0, z0, x1 + L, Hh, z1, null, 6);
    }
    // 畝は worldUV シェーダーの代わりに UV で向きを持たせるため通常マテリアルを使う
    const mS = new THREE.MeshStandardMaterial({ map: texRep('soil', 1, 1), vertexColors: true, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    const mP = new THREE.MeshStandardMaterial({ map: texRep('paddy', 1, 1), vertexColors: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    scene.add(gbS.mesh(mS, false), gbP.mesh(mP, false), gbL.mesh(WM.levee, false));
    // ビニールハウス
    const shell = [], frames = [];
    for (const gh of GREENH) {
      const g = new THREE.CylinderGeometry(7, 7, 52, 14, 1, true, 0, Math.PI);
      g.rotateZ(Math.PI / 2); g.rotateY(gh.a);
      g.translate(gh.x, 0, gh.y);
      shell.push(g);
      for (let k = -24; k <= 24; k += 6) {
        const fr = new THREE.TorusGeometry(7.05, 0.15, 4, 12, Math.PI);
        fr.rotateY(Math.PI / 2 + gh.a);
        fr.translate(gh.x + Math.cos(gh.a) * k, 0, gh.y + Math.sin(gh.a) * k);
        frames.push(fr);
      }
    }
    if (shell.length) {
      scene.add(new THREE.Mesh(T3.mergeGeometries(shell), WM.greenhouse));
      const fm = new THREE.Mesh(T3.mergeGeometries(frames), WM.ghFrame); fm.castShadow = true; scene.add(fm);
    }
  }

  /* ---------- 道路 ---------- */
  const SW = 7, CURB = 0.38;       // 歩道幅（2.8m）・縁石高さ（15cm）
  function roadCuts(r) {
    const cutsL = [], cutsR = [], mark = [];
    for (const j of r.junc) {
      const o = j.road;
      const ta = plAt(r.pl, j.d).a, tb = plAt(o.pl, j.od).a;
      const s = Math.max(0.35, Math.abs(Math.sin(tb - ta)));
      const half = (o.w / 2 + 0.5) / s;
      const iv = [j.d - half, j.d + half];
      // 幹線・一般道の中央線や車線境界は、路地が取り付くだけの所では途切れさせない
      if (o.kind !== 'lane' || r.kind === 'lane') mark.push([j.d - half - 1.5, j.d + half + 1.5]);
      // 相手がこの道路で終わる(T字)なら片側だけ切る
      const oEnd = j.od < 10 || j.od > o.pl.len - 10;
      if (oEnd) {
        const q = plAt(o.pl, j.od < 10 ? Math.min(o.pl.len, j.od + 30) : Math.max(0, j.od - 30));
        const pr = plAt(r.pl, j.d);
        const side = (Math.cos(pr.a) * (q.y - pr.y) - Math.sin(pr.a) * (q.x - pr.x));
        // 法線 n=(-sin,cos) 側を L（オフセット正）とする
        if (side > 0) cutsL.push(iv); else cutsR.push(iv);
      } else { cutsL.push(iv); cutsR.push(iv); }
    }
    return { cutsL, cutsR, mark };
  }
  G3.roadCuts = roadCuts; G3.CURB = CURB; G3.SW = SW;
  function buildRoads(scene) {
    const flatY = (y) => (x, z) => heightAt(x, z) + y;
    const sorted = ROADS.slice().sort((a, b) => (a.kind === 'main') - (b.kind === 'main'));
    const gbSide = new GB(false), gbCurb = new GB(false), gbW = new GB(false), gbY = new GB(false), gbArc = new GB(false), gbGut = new GB(false);
    sorted.forEach((r, k) => {
      if (r.kind === 'arcade') {
        ribbon(gbArc, r.pts, -r.w / 2, r.w / 2, flatY(0.12), 6);
        return;
      }
      // 車道（道路ごとにポリゴンオフセットを変えて重なりのちらつきを防ぐ）
      const gb = new GB(false);
      ribbon(gb, r.pts, -r.w / 2 - 0.3, r.w / 2 + 0.3, flatY(0.05), 9);
      const mat = WM.asphalt.clone();
      mat.onBeforeCompile = WM.asphalt.onBeforeCompile;
      mat.customProgramCacheKey = WM.asphalt.customProgramCacheKey;
      mat.polygonOffsetUnits = -4 - k * 2;
      anim.wet.push(mat);
      const m = gb.mesh(mat, false);
      scene.add(m);
      if (r.kind === 'lane') {
        // 路地: 歩道なし。両端に白い外側線（交差点で切る）
        const cl = roadCuts(r);
        for (const [a, b] of minusIntervals(r.pl.len, cl.mark)) {
          const pts = subPts(r.pl, a, b);
          if (pts.length < 2) continue;
          const eo = r.w / 2 - 0.9;
          ribbon(gbW, pts, eo - 0.22, eo + 0.22, flatY(0.07), 10);
          ribbon(gbW, pts, -eo - 0.22, -eo + 0.22, flatY(0.07), 10);
          // 両端のU字溝（コンクリートの蓋とところどころ鉄の格子）
          ribbon(gbGut, pts, r.w / 2 - 0.55, r.w / 2 + 0.45, flatY(0.09), 5);
          ribbon(gbGut, pts, -r.w / 2 - 0.45, -r.w / 2 + 0.55, flatY(0.09), 5);
        }
        return;
      }
      // 歩道（交差点で切る）
      const cuts = roadCuts(r);
      for (const [side, cl] of [[1, cuts.cutsL], [-1, cuts.cutsR]]) {
        for (const [a, b] of minusIntervals(r.pl.len, cl)) {
          const pts = subPts(r.pl, a, b);
          if (pts.length < 2) continue;
          const o0 = side > 0 ? r.w / 2 : -r.w / 2 - SW, o1 = side > 0 ? r.w / 2 + SW : -r.w / 2;
          ribbon(gbSide, pts, o0, o1, flatY(CURB), 4);
          // 縁石（車道側の立ち上がり）と外側の段差
          const ci = side > 0 ? r.w / 2 : -r.w / 2;
          const co = side > 0 ? r.w / 2 + SW : -r.w / 2 - SW;
          curbWall(gbCurb, pts, ci, flatY(0), flatY(CURB), side > 0 ? -1 : 1);
          curbWall(gbCurb, pts, co, flatY(0), flatY(CURB), side > 0 ? 1 : -1);
          // 縁石天端の白いライン（境界ブロック）
          ribbon(gbCurb, pts, side > 0 ? ci : ci - 0.6, side > 0 ? ci + 0.6 : ci, flatY(CURB + 0.01), 4);
        }
      }
      // 路面標示（交差点では途切れる）
      const segs = minusIntervals(r.pl.len, cuts.mark);
      for (const [a, b] of segs) {
        const pts = subPts(r.pl, a, b);
        if (pts.length < 2) continue;
        const yy = flatY(0.07);
        if (r.kind === 'main') {
          const eo = r.w / 2 - 1.6;
          ribbon(gbW, pts, eo - 0.32, eo + 0.32, yy, 10);
          ribbon(gbW, pts, -eo - 0.32, -eo + 0.32, yy, 10);
          if (!r.tram) {
            ribbon(gbY, pts, 0.15, 0.55, yy, 10);
            ribbon(gbY, pts, -0.55, -0.15, yy, 10);
          }
          // 車線境界の破線
          dashes(gbW, r.pl, a, b, r.w / 4 + (r.tram ? 1.5 : 0), 0.32, 7.5, 11, yy);
          dashes(gbW, r.pl, a, b, -r.w / 4 - (r.tram ? 1.5 : 0), 0.32, 7.5, 11, yy);
        } else {
          const eo = r.w / 2 - 1.0;
          ribbon(gbW, pts, eo - 0.28, eo + 0.28, yy, 10);
          ribbon(gbW, pts, -eo - 0.28, -eo + 0.28, yy, 10);
          if (r.w >= 28 && !r.tram) dashes(gbW, r.pl, a, b, 0, 0.3, 7.5, 7.5, yy);
        }
      }
    });
    scene.add(gbSide.mesh(WM.sidewalk, false));
    const cm = gbCurb.mesh(WM.curb, false); scene.add(cm);
    scene.add(gbW.mesh(WM.markW, false), gbY.mesh(WM.markY, false), gbArc.mesh(WM.paver, false));
    // U字溝の蓋（50cmの蓋が並び、4枚に1枚は鉄の格子）
    const gutTex = canvasTex(256, 32, g => {
      for (let i = 0; i < 4; i++) {
        const x0 = i * 64;
        if (i === 2) {
          g.fillStyle = '#3a3c3e'; g.fillRect(x0, 0, 64, 32);
          g.fillStyle = '#16181a'; for (let k = 4; k < 60; k += 6) g.fillRect(x0 + k, 3, 3, 26);
        } else {
          g.fillStyle = i % 2 ? '#a8a49a' : '#b2aea4'; g.fillRect(x0, 0, 64, 32);
          g.fillStyle = 'rgba(40,38,34,.55)'; g.fillRect(x0 + 26, 13, 12, 6);   // 蓋の持ち手の穴
          g.fillStyle = 'rgba(60,56,50,.25)'; g.fillRect(x0, 0, 64, 3);
        }
        g.fillStyle = '#4a4844'; g.fillRect(x0, 0, 2, 32);
      }
    });
    gutTex.wrapS = gutTex.wrapT = THREE.RepeatWrapping;
    const gm = gbGut.mesh(new THREE.MeshStandardMaterial({ map: gutTex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -40 }), false);
    gm.receiveShadow = true; scene.add(gm);
    buildCrosswalks(scene);
    buildTramRails(scene);
    buildArcadeRoofs(scene);
  }
  // 中心市街地: 歩道の外側（街灯・自販機の帯〜沿道の建物の正面）まで舗装して広い歩道にする
  function buildFrontage(scene) {
    if (typeof INFILL_AREA !== 'function') return;
    const gb = new GB(false), gbC = new GB(false);
    const yC = (x, z) => heightAt(x, z) + CURB;
    for (const r of ROADS) {
      if (r.kind === 'arcade' || !INFILL_BLVD.has(r.n)) continue;   // 歩道の外まで舗装するのは並木の大通りだけ
      const o0 = r.w / 2 + SW, o1 = r.w / 2 + INFILL_FRONT + 0.3;
      const cuts = [];
      for (const j of r.junc) {
        const ta = plAt(r.pl, j.d).a, tb = plAt(j.road.pl, j.od).a;
        const sn = Math.max(0.35, Math.abs(Math.sin(tb - ta)));
        const half = (j.road.w / 2 + (j.road.kind === 'arcade' ? 0.5 : INFILL_FRONT + 0.5)) / sn;
        cuts.push([j.d - half, j.d + half]);
      }
      for (const [a, b] of minusIntervals(r.pl.len, cuts)) {
        // 区間を INFILL_AREA の中だけ・水面でない所だけに分ける
        let s0 = null;
        const flush = (e) => {
          if (s0 !== null && e - s0 > 6) {
            const pts = subPts(r.pl, s0, e);
            if (pts.length >= 2) for (const sg of [1, -1]) {
              const lo = sg > 0 ? o0 : -o1, hi = sg > 0 ? o1 : -o0;
              ribbon(gb, pts, lo, hi, yC, 4);
              curbWall(gbC, pts, sg * o1, (x, z) => heightAt(x, z), yC, sg > 0 ? 1 : -1);
            }
          }
          s0 = null;
        };
        for (let d = a; d <= b; d += 4) {
          const p = plAt(r.pl, d);
          let ok = INFILL_AREA(p.x, p.y);
          if (ok) for (const sg of [1, -1]) {
            const q = [p.x - Math.sin(p.a) * sg * (o0 + o1) / 2, p.y + Math.cos(p.a) * sg * (o0 + o1) / 2];
            if (inWaterRaw(q[0], q[1])) ok = false;
          }
          if (ok && s0 === null) s0 = d;
          if (!ok) flush(d);
        }
        flush(b);
      }
    }
    const m = gb.mesh(WM.sidewalk, false);
    m.renderOrder = 0;
    scene.add(m, gbC.mesh(WM.curb, false));
  }
  function dashes(gb, pl, a, b, off, hw, dl, gap, yfn) {
    for (let d = a + 2; d + dl < b - 2; d += dl + gap) {
      const pts = subPts(pl, d, d + dl);
      if (pts.length >= 2) ribbon(gb, pts, off - hw, off + hw, yfn, 10);
    }
  }
  function buildCrosswalks(scene) {
    const gb = new GB(false);
    for (const cwk of CROSSWALKS) {
      const ri = roadInfo(cwk[0], cwk[1]);
      if (!ri) continue;
      const r = ri.road;
      const d = dOnPl(r.pl, cwk[0], cwk[1]);
      const p = plAt(r.pl, d);
      const tx = Math.cos(p.a), tz = Math.sin(p.a), nx = -tz, nz = tx;
      const y = heightAt(p.x, p.y) + 0.075;
      const half = r.w / 2 - 1.2;
      // 縞（車の進行方向に平行、長さ4m=10u、幅45cm）
      for (let o = -half; o <= half - 1.1; o += 2.25) {
        const o0 = o, o1 = o + 1.12;
        const P = (along, off) => [p.x + tx * along + nx * off, y, p.y + tz * along + nz * off];
        gb.quad([P(-5, o0), P(-5, o1), P(5, o1), P(5, o0)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
      // 停止線（左側通行: 進行方向+の車線は法線+側）
      for (const dir of [1, -1]) {
        const along = -dir * 9.5;
        const P = (al, off) => [p.x + tx * al + nx * off, y, p.y + tz * al + nz * off];
        const o0 = dir > 0 ? -half : 0.5, o1 = dir > 0 ? -0.5 : half;
        gb.quad([P(along - 0.55, o0), P(along - 0.55, o1), P(along + 0.55, o1), P(along + 0.55, o0)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      }
    }
    scene.add(gb.mesh(WM.markW, false));
  }
  function buildTramRails(scene) {
    const gb = new GB(false);
    for (const pl of [TRAM_LOOP, DOGO_LINE]) {
      const y = (x, z) => heightAt(x, z) + 0.085;
      for (const s of [-1, 1]) ribbon(gb, pl.pts, s * 1.34 - 0.16, s * 1.34 + 0.16, y, 10);
      // 溝（暗い溝）
    }
    scene.add(gb.mesh(WM.rail, false));
  }
  function buildArcadeRoofs(scene) {
    const gbG = new GB(false), gbF = new GB(true);
    for (const r of ROADS) {
      if (r.kind !== 'arcade') continue;
      const h0 = 13, h1 = 16.5;
      // 柱と梁（6mおき）
      for (let d = 4; d < r.pl.len - 2; d += 15) {
        const p = plAt(r.pl, d);
        const nx = -Math.sin(p.a), nz = Math.cos(p.a);
        for (const s of [-1, 1]) {
          const x = p.x + nx * s * (r.w / 2 - 0.6), z = p.y + nz * s * (r.w / 2 - 0.6);
          gbF.box(x - 0.35, 0, z - 0.35, x + 0.35, h0, z + 0.35, C('#8e9296'), 4);
          addCollider({ x, y: z, r: 0.5 });
        }
        // アーチ（折れ線）
        const N = 8;
        for (let i = 0; i < N; i++) {
          const t0 = i / N, t1 = (i + 1) / N;
          const o0 = (t0 - .5) * r.w, o1 = (t1 - .5) * r.w;
          const y0 = h0 + Math.sin(t0 * Math.PI) * (h1 - h0), y1 = h0 + Math.sin(t1 * Math.PI) * (h1 - h0);
          const ax = p.x + nx * o0, az = p.y + nz * o0, bx = p.x + nx * o1, bz = p.y + nz * o1;
          const tx = Math.cos(p.a) * 0.3, tz = Math.sin(p.a) * 0.3;
          gbF.quad([[ax - tx, y0, az - tz], [bx - tx, y1, bz - tz], [bx + tx, y1, bz + tz], [ax + tx, y0, az + tz]], [[0, 0], [1, 0], [1, 1], [0, 1]], C('#8e9296'));
          gbF.quad([[ax + tx, y0 - 0.5, az + tz], [bx + tx, y1 - 0.5, bz + tz], [bx - tx, y1 - 0.5, bz - tz], [ax - tx, y0 - 0.5, az - tz]], [[0, 0], [1, 0], [1, 1], [0, 1]], C('#7a7e82'));
        }
      }
      // ガラス屋根（ヴォールト）
      const N = 8;
      for (let i = 0; i < N; i++) {
        const t0 = i / N, t1 = (i + 1) / N;
        const o0 = (t0 - .5) * r.w, o1 = (t1 - .5) * r.w;
        const y0 = h0 + Math.sin(t0 * Math.PI) * (h1 - h0), y1 = h0 + Math.sin(t1 * Math.PI) * (h1 - h0);
        const n = miterNormals(r.pts);
        for (let k = 1; k < r.pts.length; k++) {
          const a = r.pts[k - 1], b = r.pts[k];
          const A0 = [a[0] + n[k - 1][0] * o0, y0, a[1] + n[k - 1][1] * o0], A1 = [a[0] + n[k - 1][0] * o1, y1, a[1] + n[k - 1][1] * o1];
          const B0 = [b[0] + n[k][0] * o0, y0, b[1] + n[k][1] * o0], B1 = [b[0] + n[k][0] * o1, y1, b[1] + n[k][1] * o1];
          gbG.quad([A0, B0, B1, A1], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        }
      }
    }
    const glass = new THREE.MeshStandardMaterial({ color: 0xd4e2ea, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false });
    const g = gbG.mesh(glass, false);
    scene.add(g);
    const f = gbF.mesh(WM.metal, true);
    scene.add(f);
  }

  /* ---------- 鉄道（郊外線・JR） ---------- */
  // [a,b] の区間だけ step ごとに刻んだ点列（高架のこう配を出すため）
  function densePts(pl, a, b, step) {
    const out = [];
    for (let i = 0; i < pl.pts.length; i++) if (pl.cum[i] < a) out.push(pl.pts[i]);
    for (let d = Math.max(0, a); d <= Math.min(pl.len, b); d += step) { const p = plAt(pl, d); out.push([p.x, p.y]); }
    for (let i = 0; i < pl.pts.length; i++) if (pl.cum[i] > b) out.push(pl.pts[i]);
    return out;
  }
  function buildRailways(scene) {
    const gbB = new GB(false), gbR = new GB(false);
    const sl = [];
    const track = (pts, off, half, g, slp) => {   // 線路1本（バラスト・レール・枕木）。g(x,z)=路盤の高さ
      const yb = (x, z) => g(x, z) + 0.2;
      ribbon(gbB, pts, off - half, off + half, yb, 8);
      for (const s of [-1, 1]) {
        const o = off + s * 1.34;
        ribbon(gbR, pts, o - 0.15, o + 0.15, (x, z) => g(x, z) + 0.72, 10);
        curbWall(gbR, pts, o - 0.15, (x, z) => g(x, z) + 0.45, (x, z) => g(x, z) + 0.72, -1);
        curbWall(gbR, pts, o + 0.15, (x, z) => g(x, z) + 0.45, (x, z) => g(x, z) + 0.72, 1);
      }
      if (slp) for (const [pl, a, b] of slp) for (let d = a; d < b; d += 1.6) {
        const p = plAt(pl, d), x = p.x - Math.sin(p.a) * off, z = p.y + Math.cos(p.a) * off;
        sl.push([x, heightAt(x, z) + railLift(pl, d) + 0.35, z, p.a]);
      }
    };
    for (const r of RAILS) {
      const jr = typeof JR_EL !== 'undefined' && r.pl === JR_EL.pl;
      const E = jr ? JR_EL.flat + JR_EL.ramp + 12 : 0;
      const pts = jr ? densePts(r.pl, JR_EL.c - E, JR_EL.c + E, 6) : r.pl.pts;
      const L = jr ? jrLiftXY : () => 0;
      const g = (x, z) => heightAt(x, z) + L(x, z);
      track(pts, 0, 5, g, [[r.pl, 0, r.pl.len]]);
      // 路盤の側面: 地上は地面から、高架は桁の上面から
      const y0 = (x, z) => L(x, z) > 3 ? g(x, z) - 0.05 : heightAt(x, z);
      curbWall(gbB, pts, 5, y0, (x, z) => g(x, z) + 0.2, 1);
      curbWall(gbB, pts, -5, y0, (x, z) => g(x, z) + 0.2, -1);
      // JR松山駅の高架ホーム（2面4線）の残り3線（列車は走らない）
      if (jr) {
        const a = JR_EL.c - JR_EL.sta, b = JR_EL.c + JR_EL.sta;
        const sp = [];
        for (let d = a; d <= b; d += 6) { const p = plAt(r.pl, d); sp.push([p.x, p.y]); }
        for (const off of JR_EL.sub) track(sp, off, 3.2, g, [[r.pl, a, b]]);
      }
    }
    scene.add(gbB.mesh(WM.ballast, false), gbR.mesh(WM.rail, false));
    const sg = new THREE.BoxGeometry(0.5, 0.3, 5.2);
    const im = new THREE.InstancedMesh(sg, WM.sleeper, sl.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
    sl.forEach((s, i) => {
      q.setFromEuler(e.set(0, -s[3], 0));
      m4.compose(new THREE.Vector3(s[0], s[1], s[2]), q, one);
      im.setMatrixAt(i, m4);
    });
    im.receiveShadow = true;
    scene.add(im);
  }

  /* ---------- JR松山駅付近の高架橋（2024年9月に高架化）と高架駅 ---------- */
  // 向き a の直方体（中心 x,z・長さ方向の半長 hl・幅の半長 hw・高さ y0→y1、底面なし）
  function obox(gb, x, z, a, hl, hw, y0, y1, col) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (u, v, y) => [x + ca * u - sa * v, y, z + sa * u + ca * v];
    const f = (A, B, uvw) => gb.quad([P(A[0], A[1], y0), P(B[0], B[1], y0), P(B[0], B[1], y1), P(A[0], A[1], y1)],
      [[0, 0], [uvw / 6, 0], [uvw / 6, (y1 - y0) / 6], [0, (y1 - y0) / 6]], col);
    f([hl, -hw], [hl, hw], 2 * hw); f([hl, hw], [-hl, hw], 2 * hl); f([-hl, hw], [-hl, -hw], 2 * hw); f([-hl, -hw], [hl, -hw], 2 * hl);
    gb.quad([P(-hl, -hw, y1), P(-hl, hw, y1), P(hl, hw, y1), P(hl, -hw, y1)], [[0, 0], [0, 1], [1, 1], [1, 0]], col);
  }
  function buildViaduct(scene) {
    if (typeof JR_EL === 'undefined') return;
    const pl = JR_EL.pl, c = JR_EL.c, E = JR_EL.flat + JR_EL.ramp, step = 6;
    const gb = new GB(true), gbP = new GB(true), gbY = new GB(false);
    const CD = C('#d3d0c8'), CU = C('#a9a69e'), CPL = C('#c6c2b8'), CR = C('#e6e8ea'), CS = C('#8e959b');
    const inSta = d => Math.abs(d - c) <= JR_EL.sta + 3;
    const W = d => inSta(d) ? JR_EL.deck : [-8, 8];
    const keyNear = (x, y, r) => [...MIKANS.map(m => [m.x, m.y]), ...GIGSPOTS.map(g => [g[1], g[2]]), ...MISSIONS.flatMap(m => [m.start, m.goal, ...(m.cps || [])].filter(Boolean))]
      .some(k => hyp(k[0] - x, k[1] - y) < r);
    const onRoad = (x, y, m) => { const ri = roadInfo(x, y); return ri && ri.d < ri.road.w / 2 + G3.SW + m; };
    const at = (d, o) => { const p = plAt(pl, d); return { x: p.x - Math.sin(p.a) * o, z: p.y + Math.cos(p.a) * o, a: p.a }; };
    let prevW = null, nPier = 0;
    for (let d = c - E; d < c + E - 0.01; d += step) {
      const d2 = Math.min(d + step, c + E), dm = (d + d2) / 2;
      const l1 = railLift(pl, d), l2 = railLift(pl, d2);
      const on = l1 >= 3 || l2 >= 3;
      const [o0, o1] = W(dm);
      const t = (dd, o) => { const q = at(dd, o); return heightAt(q.x, q.z) + railLift(pl, dd); };
      const V = (dd, o, y) => { const q = at(dd, o); return [q.x, y, q.z]; };
      if (!on) { prevW = null; continue; }
      const T = o => [t(d, o), t(d2, o)];
      const [ta0, tb0] = T(o0), [ta1, tb1] = T(o1);
      // 桁: 上面（バラストの下・駅では床）・下面・両側面（高欄まで）
      gb.quad([V(d, o0, ta0), V(d, o1, ta1), V(d2, o1, tb1), V(d2, o0, tb0)], [[0, 0], [1, 0], [1, 1], [0, 1]], CD);
      gb.quad([V(d, o1, ta1 - 2.2), V(d, o0, ta0 - 2.2), V(d2, o0, tb0 - 2.2), V(d2, o1, tb1 - 2.2)], [[0, 0], [1, 0], [1, 1], [0, 1]], CU);
      const H = 2.8;   // 高欄の高さ（1.1m）
      gb.quad([V(d, o1, ta1 - 2.2), V(d2, o1, tb1 - 2.2), V(d2, o1, tb1 + H), V(d, o1, ta1 + H)], [[0, 0], [1, 0], [1, .8], [0, .8]], CD);
      gb.quad([V(d2, o0, tb0 - 2.2), V(d, o0, ta0 - 2.2), V(d, o0, ta0 + H), V(d2, o0, tb0 + H)], [[0, 0], [1, 0], [1, .8], [0, .8]], CD);
      gb.quad([V(d2, o1 - 0.5, tb1), V(d, o1 - 0.5, ta1), V(d, o1 - 0.5, ta1 + H), V(d2, o1 - 0.5, tb1 + H)], [[0, 0], [1, 0], [1, .5], [0, .5]], CPL);
      gb.quad([V(d, o0 + 0.5, ta0), V(d2, o0 + 0.5, tb0), V(d2, o0 + 0.5, tb0 + H), V(d, o0 + 0.5, ta0 + H)], [[0, 0], [1, 0], [1, .5], [0, .5]], CPL);
      gb.quad([V(d, o1 - 0.5, ta1 + H), V(d, o1, ta1 + H), V(d2, o1, tb1 + H), V(d2, o1 - 0.5, tb1 + H)], [[0, 0], [1, 0], [1, .1], [0, .1]], CD);
      gb.quad([V(d, o0, ta0 + H), V(d, o0 + 0.5, ta0 + H), V(d2, o0 + 0.5, tb0 + H), V(d2, o0, tb0 + H)], [[0, 0], [1, 0], [1, .1], [0, .1]], CD);
      // 端（橋台・駅の幅が変わる所）の妻面
      const wKey = o0 + ',' + o1;
      if (prevW !== wKey) {
        const [w0, w1] = prevW ? prevW.split(',').map(Number) : [0, 0];
        const ww0 = Math.max(o0, w0), ww1 = Math.min(o1, w1);
        // 前の区間より広い部分（または始まり）に手前向きの面
        for (const [a0, a1] of (prevW ? [[o0, Math.min(ww0, o1)], [Math.max(ww1, o0), o1]] : [[o0, o1]])) if (a1 - a0 > 0.1)
          gb.quad([V(d, a0, t(d, a0) - 2.2), V(d, a1, t(d, a1) - 2.2), V(d, a1, t(d, a1) + H), V(d, a0, t(d, a0) + H)], [[0, 0], [1, 0], [1, 1], [0, 1]], CD);   // -進行方向向き
      }
      const nextOn = d2 < c + E - 0.01 && (railLift(pl, d2 + step) >= 3 || l2 >= 3);
      const nW = nextOn ? W(d2 + step / 2) : null;
      if (!nextOn || (nW[0] + ',' + nW[1]) !== wKey) {
        const [n0, n1] = nW || [0, 0];
        for (const [a0, a1] of (nW ? [[o0, Math.min(Math.max(o0, n0), o1)], [Math.max(Math.min(o1, n1), o0), o1]] : [[o0, o1]])) if (a1 - a0 > 0.1)
          gb.quad([V(d2, a1, t(d2, a1) - 2.2), V(d2, a0, t(d2, a0) - 2.2), V(d2, a0, t(d2, a0) + H), V(d2, a1, t(d2, a1) + H)], [[0, 0], [1, 0], [1, 1], [0, 1]], CD);   // +進行方向向き
      }
      prevW = wKey;
      // 橋脚（道路・歩道の上には立てない＝道路をまたぐ）。こう配の低い所は路盤が地面まで（盛土の擁壁）
      const lm = railLift(pl, dm);
      if (lm < 8) {
        for (const o of [o0, o1]) { const q2 = at(d, o), q3 = at(d2, o); gbP.quad(o === o1 ? [[q2.x, heightAt(q2.x, q2.z), q2.z], [q3.x, heightAt(q3.x, q3.z), q3.z], [q3.x, t(d2, o) - 2.2, q3.z], [q2.x, t(d, o) - 2.2, q2.z]] : [[q3.x, heightAt(q3.x, q3.z), q3.z], [q2.x, heightAt(q2.x, q2.z), q2.z], [q2.x, t(d, o) - 2.2, q2.z], [q3.x, t(d2, o) - 2.2, q3.z]], [[0, 0], [1, 0], [1, 1], [0, 1]], CU); }
      } else if (Math.round((dm - c) / step) % 4 === 0) {
        const piers = inSta(dm) ? [-12, 20] : [0];
        for (const o of piers) {
          const q = at(dm, o);
          if (onRoad(q.x, q.z, 1.5) || inWaterRaw(q.x, q.z) || keyNear(q.x, q.z, 10)) continue;
          const g0 = heightAt(q.x, q.z);
          obox(gbP, q.x, q.z, q.a, 1.6, inSta(dm) ? 2.2 : 2.6, g0, g0 + lm - 2.2, CU);
          addCollider({ x: q.x, y: q.z, hx: 1.6, hy: inSta(dm) ? 2.2 : 2.6, a: q.a, m: 2 });
          nPier++;
        }
      }
    }
    // 高架ホーム（島式2面）と上屋
    const pa = c - JR_EL.sta + 4, pb = c + JR_EL.sta - 4;
    for (const [p0, p1] of JR_EL.plats) {
      for (let d = pa; d < pb - 0.01; d += step) {
        const d2 = Math.min(d + step, pb);
        const V = (dd, o, dy) => { const q = at(dd, o); return [q.x, heightAt(q.x, q.z) + railLift(pl, dd) + dy, q.z]; };
        const PT = 3.7;   // ホーム面（レール面＋1.1m）
        gb.quad([V(d, p0, PT), V(d, p1, PT), V(d2, p1, PT), V(d2, p0, PT)], [[0, 0], [1, 0], [1, 1], [0, 1]], CPL);
        gb.quad([V(d, p1, 0), V(d2, p1, 0), V(d2, p1, PT), V(d, p1, PT)], [[0, 0], [1, 0], [1, .3], [0, .3]], CU);
        gb.quad([V(d2, p0, 0), V(d, p0, 0), V(d, p0, PT), V(d2, p0, PT)], [[0, 0], [1, 0], [1, .3], [0, .3]], CU);
        for (const e of [p0 + 0.9, p1 - 1.2]) gbY.quad([V(d, e, PT + 0.03), V(d, e + 0.3, PT + 0.03), V(d2, e + 0.3, PT + 0.03), V(d2, e, PT + 0.03)], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        // 上屋（屋根は白い折板）
        const RY = PT + 8.6;
        gbP.quad([V(d, p0 - 1.0, RY), V(d, p1 + 1.0, RY), V(d2, p1 + 1.0, RY), V(d2, p0 - 1.0, RY)], [[0, 0], [1, 0], [1, 1], [0, 1]], CR);
        gbP.quad([V(d, p1 + 1.0, RY - 0.5), V(d, p0 - 1.0, RY - 0.5), V(d2, p0 - 1.0, RY - 0.5), V(d2, p1 + 1.0, RY - 0.5)], [[0, 0], [1, 0], [1, 1], [0, 1]], CS);
        gbP.quad([V(d, p1 + 1.0, RY - 0.5), V(d2, p1 + 1.0, RY - 0.5), V(d2, p1 + 1.0, RY), V(d, p1 + 1.0, RY)], [[0, 0], [1, 0], [1, .1], [0, .1]], CR);
        gbP.quad([V(d2, p0 - 1.0, RY - 0.5), V(d, p0 - 1.0, RY - 0.5), V(d, p0 - 1.0, RY), V(d2, p0 - 1.0, RY)], [[0, 0], [1, 0], [1, .1], [0, .1]], CR);
        if (Math.round((d - pa) / step) % 4 === 0) { const q = at(d + 3, (p0 + p1) / 2), y = heightAt(q.x, q.z) + railLift(pl, d + 3); obox(gbP, q.x, q.z, q.a, 0.35, 0.35, y + PT, y + RY - 0.5, CS); }
      }
    }
    scene.add(gb.mesh(WM.concrete, true), gbP.mesh(WM.concrete, true));
    const ym = gbY.mesh(new THREE.MeshStandardMaterial({ color: 0xe8c020, roughness: 0.6 }), false); scene.add(ym);
    // 駅名の看板（高欄の外側、東西）と高架下の商業ゾーン「JR松山駅だんだん通り」
    const signTex = canvasTex(1024, 160, g => {
      g.fillStyle = '#f4f6f8'; g.fillRect(0, 0, 1024, 160);
      g.fillStyle = '#1aa0d8'; g.fillRect(0, 0, 1024, 18); g.fillRect(0, 142, 1024, 18);
      g.fillStyle = '#1d2530'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '900 86px "Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif'; g.fillText('松山駅', 512, 70);
      g.font = '700 26px Helvetica,Arial,sans-serif'; g.fillText('MATSUYAMA  STATION', 512, 124);
      g.font = '700 24px "Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif'; g.textAlign = 'left'; g.fillText('JR四国 予讃線', 26, 124);
    });
    const danTex = canvasTex(1024, 128, g => {
      const cols = ['#f2e6c8', '#e8f0f4', '#f6e0d8', '#e6f2e0', '#f4ecd0', '#e4e8f4'];
      for (let i = 0; i < 8; i++) {
        const x = i * 128;
        g.fillStyle = '#3a3e44'; g.fillRect(x, 0, 128, 128);
        g.fillStyle = cols[i % cols.length]; g.fillRect(x + 6, 40, 116, 82);   // ガラスの店先（明るい）
        g.fillStyle = 'rgba(40,44,50,.35)'; for (let k = 1; k < 4; k++) g.fillRect(x + 6 + k * 29, 40, 2, 82);
      }
      g.fillStyle = '#e8641e'; g.fillRect(0, 0, 1024, 34);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = '800 24px "Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif'; g.fillText('JR松山駅だんだん通り', 256, 18); g.fillText('JR松山駅だんだん通り', 768, 18);
    });
    const smat = new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.4, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0 });
    const dmat = new THREE.MeshStandardMaterial({ map: danTex, roughness: 0.5, emissive: 0xffffff, emissiveMap: danTex, emissiveIntensity: 0 });
    anim.neon.push(smat, dmat);
    const gbS = new GB(false), gbD = new GB(false), gbDr = new GB(true);
    for (const [o, sg] of [[JR_EL.deck[0] - 0.05, -1], [JR_EL.deck[1] + 0.05, 1]]) {
      const hl = 22, q0 = at(c - hl * sg, o), q1 = at(c + hl * sg, o);
      const t0 = heightAt(q0.x, q0.z) + JR_EL.h - 1.6, t1 = t0 + 7.0;
      gbS.quad([[q0.x, t0, q0.z], [q1.x, t0, q1.z], [q1.x, t1, q1.z], [q0.x, t1, q0.z]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    let nShop = 0;
    for (let d = c - JR_EL.sta + 8; d < c + JR_EL.sta - 8; d += 12) {
      const [s0, s1] = [-15, 23];
      const ok = [s0, (s0 + s1) / 2, s1].every(o => [d, d + 6, d + 12].every(dd => { const q = at(dd, o); return !onRoad(q.x, q.z, 3) && !keyNear(q.x, q.z, 16); }));
      if (!ok) continue;
      const V = (dd, o, y) => { const q = at(dd, o); return [q.x, heightAt(q.x, q.z) + y, q.z]; };
      const SH = 10.5;
      gbD.quad([V(d + 12, s0, 0), V(d, s0, 0), V(d, s0, SH), V(d + 12, s0, SH)], [[0, 0], [0.375, 0], [0.375, 1], [0, 1]]);   // 東面
      gbD.quad([V(d, s1, 0), V(d + 12, s1, 0), V(d + 12, s1, SH), V(d, s1, SH)], [[0.5, 0], [0.875, 0], [0.875, 1], [0.5, 1]]); // 西面
      gbDr.quad([V(d, s0, SH), V(d, s1, SH), V(d + 12, s1, SH), V(d + 12, s0, SH)], [[0, 0], [1, 0], [1, 1], [0, 1]], C('#55585e'));
      for (const [dd, sg] of [[d, -1], [d + 12, 1]]) {   // 区画の端（通路側）は閉じる
        const A = sg > 0 ? [V(dd, s1, 0), V(dd, s0, 0), V(dd, s0, SH), V(dd, s1, SH)] : [V(dd, s0, 0), V(dd, s1, 0), V(dd, s1, SH), V(dd, s0, SH)];
        gbDr.quad(A, [[0, 0], [1, 0], [1, 1], [0, 1]], C('#7a7e84'));
      }
      const q = at(d + 6, (s0 + s1) / 2);
      addCollider({ x: q.x, y: q.z, hx: 6, hy: (s1 - s0) / 2, a: q.a, m: 2 });
      nShop++;
    }
    scene.add(gbS.mesh(smat, false), gbD.mesh(dmat, true), gbDr.mesh(WM.concrete, true));
    G3.viaductStats = { piers: nPier, shops: nShop };
  }

  /* ---------- 建物 ---------- */
  const FLOOR = 7, BAY = { office: 9, glass: 9, mansion: 9, shop: 7.5, house: 9, hotel: 9, gshop: 9, goffice: 9, ghouse: 9,
    machiya: 9, gmachiya: 9, warehouse: 9, gwarehouse: 18, danchi: 9 };
  // 地区ごとの建物の様式（乱数は使わず位置と seed で決める）
  //  町家: 三津浜の古い町並み・道後の湯の町・古町／倉庫: 空港南の南吉田・余戸の工業地・堀江港／団地: 郊外のマンション
  function styleOf(b) {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, area = (b.x1 - b.x0) * (b.y1 - b.y0), s = b.seed;
    if (b.hgt <= 3 && b.kind !== 'mansion' && b.kind !== 'hotel') {
      if (hyp(cx - 1300, cy - 1720) < 560 && s % 6 !== 0) return 'machiya';
      if (b.kind === 'shop' && hyp(cx - 7400, cy - 2300) < 480 && s % 2 === 0) return 'machiya';
      if (b.kind === 'house' && hyp(cx - 4800, cy - 2500) < 380 && s % 3 === 0) return 'machiya';
    }
    if (b.hgt <= 2 && b.kind !== 'mansion' && b.kind !== 'shop') {
      if (cx > 1100 && cx < 3300 && cy > 4100 && cy < 5080 && (area > 1500 || s % 2 === 0)) return 'warehouse';
      if (hyp(cx - 4482, cy - 380) < 320) return 'warehouse';
      if (cx > 3000 && cx < 4900 && cy > 3700 && cy < 5050 && area > 1900 && s % 3 === 0) return 'warehouse';
    }
    if (b.kind === 'house' && s % 13 === 0) return 'machiya';
    if (b.kind === 'mansion' && !(cx > 5450 && cx < 6900 && cy > 2260 && cy < 3560) && s % 3 !== 2) return 'danchi';
    return null;
  }
  function upperTex(b) {
    if (b.sty) return b.sty;
    if (b.kind === 'house') return 'house';
    if (b.kind === 'mansion') return 'mansion';
    if (b.kind === 'hotel') return 'hotel';
    if (b.kind === 'shop') return 'shop';
    return (b.hgt >= 5 && b.seed % 3 === 0) ? 'glass' : 'office';
  }
  function groundTex(b) {
    if (b.sty) return b.sty === 'danchi' ? 'danchi' : 'g' + b.sty;
    if (b.kind === 'house') return 'ghouse';
    if (b.kind === 'shop') return 'gshop';
    if (b.kind === 'office') return b.seed % 2 ? 'gshop' : 'goffice';
    return 'goffice';
  }
  function tintOf(b) {
    const c = new THREE.Color(b.c);
    const l = (c.r + c.g + c.b) / 3 || 1;
    return [lerp(1, c.r / l, 0.55) * 1.02, lerp(1, c.g / l, 0.55) * 1.02, lerp(1, c.b / l, 0.55) * 1.02];
  }
  function frontSide(b) {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const ri = roadInfo(cx, cy);
    if (!ri) return 0;
    const dx = ri.x - cx, dy = ri.y - cy;
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;   // 1:東 3:西
    return dy > 0 ? 2 : 0;                                    // 2:南 0:北
  }
  function buildBuildings(scene) {
    const GBs = {};
    const gbOf = k => GBs[k] || (GBs[k] = new GB(true));
    const gbRoof = new GB(true), gbPar = new GB(true), gbKaw = new GB(true), gbEq = new GB(true), gbSign = new GB(false), gbAd = new GB(false), gbBal = new GB(true);
    const signs = [];
    for (const b of buildings) {
      if (b.noDraw) continue;
      b.sty = styleOf(b);
      if (b.sty === 'machiya') b.hW = Math.min(b.hW, 15 + b.seed % 2);   // 町家は総二階まで（低い軒）
    }
    for (const b of buildings) {
      if (b.noDraw) continue;
      const x0 = b.x0, z0 = b.y0, x1 = b.x1, z1 = b.y1;
      const top = b.hW, gH = Math.max(6, top - FLOOR * (b.sty === 'machiya' ? 1 : b.hgt));
      const pitched = b.kind === 'house' || b.sty === 'machiya' || b.sty === 'warehouse';
      const tint = tintOf(b);
      const ut = upperTex(b), gt = groundTex(b);
      const faces = [
        [[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]],
      ];
      // 立体感: 足元の幅木・各階の水平な庇（帯）・マンション正面のバルコニー
      const cxB = (x0 + x1) / 2, czB = (z0 + z1) / 2, fsB = frontSide(b);
      faces.forEach((f, fi) => {
        const [A, B] = [f[1], f[0]];
        const len = hyp(B[0] - A[0], B[1] - A[1]);
        if (len < 4) return;
        let nx = -(B[1] - A[1]) / len, nz = (B[0] - A[0]) / len;
        const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
        if ((mx + nx - cxB) * nx + (mz + nz - czB) * nz < (mx - cxB) * nx + (mz - czB) * nz) { nx = -nx; nz = -nz; }
        const dark = tint.map(v => v * 0.55);
        ledge(gbPar, A, B, nx, nz, 0, 1.4, 0.25, dark);
        const isFront = fi === [0, 1, 2, 3][fsB];
        if (b.sty === 'machiya' && isFront) ledge(gbPar, A, B, nx, nz, gH - 0.25, gH + 0.3, 2.4, C('#55585c'));   // 一階の庇
        if (b.kind === 'house') return;
        const floors = Math.round((top - gH) / FLOOR);
        const lc = tint.map(v => v * 0.86);
        ledge(gbPar, A, B, nx, nz, gH - 0.6, gH, 0.9, lc);
        if (b.kind === 'mansion' && isFront && b.sty !== 'danchi') {
          for (let k = 1; k < floors; k++) {
            const z = gH + k * FLOOR;
            ledge(gbPar, A, B, nx, nz, z - 0.45, z, 3.0, lc);                    // 床スラブ
            ledge(gbBal, A, B, nx, nz, z, z + 2.75, 3.0, C('#9aa3ab'), 0.18);     // 手すり（腰壁）
          }
        } else {
          for (let k = 1; k < floors; k++) ledge(gbPar, A, B, nx, nz, gH + k * FLOOR - 0.35, gH + k * FLOOR, 0.35, lc);
        }
      });
      // 外側から見た反時計回りにするため順序を反転
      faces.forEach((f, fi) => {
        const [A, B] = [f[1], f[0]];
        const len = hyp(B[0] - A[0], B[1] - A[1]);
        const sd = b.seed + fi * 0.37;
        // 1階
        const nbG = Math.max(1, Math.round(len / BAY[gt]));
        gbOf(gt).quad([[A[0], 0, A[1]], [B[0], 0, B[1]], [B[0], gH, B[1]], [A[0], gH, A[1]]],
          [[0, 0], [nbG, 0], [nbG, 1], [0, 1]], tint, sd);
        // 上階
        const nb = Math.max(1, Math.round(len / BAY[ut]));
        const fl = (top - gH) / FLOOR;
        gbOf(ut).quad([[A[0], gH, A[1]], [B[0], gH, B[1]], [B[0], top, B[1]], [A[0], top, A[1]]],
          [[0, 0], [nb, 0], [nb, fl], [0, fl]], tint, sd);
      });
      if (b.sty === 'warehouse') {
        houseRoof(gbEq, gbPar, b, top, tint, 0.13, [C('#c4d2dc'), C('#d2b8a8'), C('#bcd4c6'), C('#dcdcd6')][b.seed % 4]);   // 鋼板の緩い切妻
      } else if (pitched) {
        houseRoof(gbKaw, gbPar, b, top, tint);
      } else {
        // 陸屋根＋パラペット
        const p = 0.5, ph = 1.3;
        gbRoof.quad([[x0, top + 0.2, z1], [x1, top + 0.2, z1], [x1, top + 0.2, z0], [x0, top + 0.2, z0]],
          [[x0 / 12, z1 / 12], [x1 / 12, z1 / 12], [x1 / 12, z0 / 12], [x0 / 12, z0 / 12]], C('#bdbab2'));
        const pc = tint.map(v => v * 0.92);
        gbPar.box(x0, top, z0, x1, top + ph, z0 + p, pc);
        gbPar.box(x0, top, z1 - p, x1, top + ph, z1, pc);
        gbPar.box(x0, top, z0 + p, x0 + p, top + ph, z1 - p, pc);
        gbPar.box(x1 - p, top, z0 + p, x1, top + ph, z1 - p, pc);
        rooftop(gbEq, b, top);
      }
      // 袖看板（商店）
      if (b.kind === 'shop' && b.sg) {
        const fs = frontSide(b);
        const cxb = (b.x0 + b.x1) / 2, cyb = (b.y0 + b.y1) / 2;
        const si = hyp(cxb - 7390, cyb - 2250) < 420 ? SIGN_DOGO[b.seed % SIGN_DOGO.length] : b.seed % SIGN_BASE;
        const sh0 = gH + 1, sh1 = Math.min(top - 1, gH + 1 + Math.max(10, (top - gH) * 0.75));
        signs.push({ b, fs, si, sh0, sh1 });
      }
      // 屋上広告塔
      if (b.kind === 'office' && !pitched && b.hgt >= 5 && b.seed % 4 === 0) adBoard(gbAd, gbEq, b, top);
      if (b.kind === 'hotel') yuSign(gbAd, gbEq, b, top);
    }
    for (const k in GBs) {
      const m = GBs[k].mesh(WM['fac_' + k], true);
      scene.add(m);
    }
    const rm = gbRoof.mesh(WM.concrete, false); rm.receiveShadow = true; scene.add(rm);
    scene.add(gbPar.mesh(WM.plaster, true), gbKaw.mesh(WM.kawara, true), gbEq.mesh(WM.metal, true), gbBal.mesh(WM.metal, true));
    // 袖看板（両面に文字）
    for (const s of signs) {
      const b = s.b;
      const u0 = s.si / SIGNS.length, u1 = (s.si + 1) / SIGNS.length;
      let px, pz, ox, oz;
      if (s.fs === 0) { px = b.x0 + 3; pz = b.y0; ox = 0; oz = -1; }
      else if (s.fs === 2) { px = b.x1 - 3; pz = b.y1; ox = 0; oz = 1; }
      else if (s.fs === 1) { px = b.x1; pz = b.y0 + 3; ox = 1; oz = 0; }
      else { px = b.x0; pz = b.y1 - 3; ox = -1; oz = 0; }
      const d0 = 0.4, d1 = 3.8, t = 0.35;
      const tx = -oz * t, tz = ox * t;
      const P = (d, h, s2) => [px + ox * d + tx * s2, h, pz + oz * d + tz * s2];
      gbSign.quad([P(d0, s.sh0, 1), P(d1, s.sh0, 1), P(d1, s.sh1, 1), P(d0, s.sh1, 1)], [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
      gbSign.quad([P(d1, s.sh0, -1), P(d0, s.sh0, -1), P(d0, s.sh1, -1), P(d1, s.sh1, -1)], [[u0, 0], [u1, 0], [u1, 1], [u0, 1]]);
      gbSign.quad([P(d1, s.sh0, 1), P(d1, s.sh0, -1), P(d1, s.sh1, -1), P(d1, s.sh1, 1)], [[u0, 0], [u0 + .001, 0], [u0 + .001, .01], [u0, .01]]);
    }
    scene.add(gbSign.mesh(WM.sign, true), gbAd.mesh(WM.ad, true));
  }
  // 壁面 A→B に沿って外へ out だけ張り出す帯（高さ z0..z1）。thick を与えると薄い板（手すり）
  function ledge(gb, A, B, nx, nz, z0, z1, out, col, thick) {
    const ex = 0.05;
    const tx = (B[0] - A[0]), tz = (B[1] - A[1]), L = hyp(tx, tz), ux = tx / L * ex, uz = tz / L * ex;
    const a0 = [A[0] - ux, A[1] - uz], b0 = [B[0] + ux, B[1] + uz];
    const o1 = out, o0 = thick ? out - thick : 0;
    const P = (p, o, y) => [p[0] + nx * o, y, p[1] + nz * o];
    const q = (pts) => gb.quad(pts, [[0, 0], [1, 0], [1, 1], [0, 1]], col);
    // 外面・上面・下面・両端（向きは外から見て反時計回り）
    const face = (p1, p2, p3, p4) => {
      const ux2 = p2[0] - p1[0], uy2 = p2[1] - p1[1], uz2 = p2[2] - p1[2], vx = p4[0] - p1[0], vy = p4[1] - p1[1], vz = p4[2] - p1[2];
      return [uy2 * vz - uz2 * vy, uz2 * vx - ux2 * vz, ux2 * vy - uy2 * vx];
    };
    const add = (pts, want) => { const n = face(...pts); if (n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) pts.reverse(); q(pts); };
    add([P(a0, o1, z0), P(b0, o1, z0), P(b0, o1, z1), P(a0, o1, z1)], [nx, 0, nz]);
    add([P(a0, o0, z1), P(b0, o0, z1), P(b0, o1, z1), P(a0, o1, z1)], [0, 1, 0]);
    add([P(a0, o0, z0), P(b0, o0, z0), P(b0, o1, z0), P(a0, o1, z0)], [0, -1, 0]);
    if (thick) add([P(a0, o0, z0), P(b0, o0, z0), P(b0, o0, z1), P(a0, o0, z1)], [-nx, 0, -nz]);
    const tdx = tx / L, tdz = tz / L;
    add([P(a0, o0, z0), P(a0, o1, z0), P(a0, o1, z1), P(a0, o0, z1)], [-tdx, 0, -tdz]);
    add([P(b0, o0, z0), P(b0, o1, z0), P(b0, o1, z1), P(b0, o0, z1)], [tdx, 0, tdz]);
  }
  function houseRoof(gbK, gbP, b, top, tint, pitch, rcol) {
    const x0 = b.x0, z0 = b.y0, x1 = b.x1, z1 = b.y1, o = pitch ? 0.8 : 1.2;
    const longX = (x1 - x0) >= (z1 - z0);
    const span = longX ? (z1 - z0) : (x1 - x0);
    const rh = span * (pitch || 0.32);
    const rc = rcol || [C('#5a626e'), C('#71584e'), C('#4e5a66'), C('#6a6a66')][b.seed % 4].map(v => v * 1.6);
    if (longX) {
      const zm = (z0 + z1) / 2;
      const A = [x0 - o, top - 0.6, z0 - o], B = [x1 + o, top - 0.6, z0 - o], Cc = [x1 + o, top + rh, zm], D = [x0 - o, top + rh, zm];
      const E = [x1 + o, top - 0.6, z1 + o], F = [x0 - o, top - 0.6, z1 + o];
      const L = (x1 - x0 + 2 * o) / 3, Sl = hyp(rh + 0.6, span / 2 + o) / 3;
      gbK.quad([A, D, Cc, B], [[0, 0], [0, Sl], [L, Sl], [L, 0]], rc);
      gbK.quad([E, Cc, D, F], [[0, 0], [0, Sl], [L, Sl], [L, 0]], rc);
      gbP.tri([[x0, top, z1], [x0, top + rh * (span / 2) / (span / 2 + o), zm], [x0, top, z0]], [[0, 0], [.5, 1], [1, 0]], tint);
      gbP.tri([[x1, top, z0], [x1, top + rh * (span / 2) / (span / 2 + o), zm], [x1, top, z1]], [[0, 0], [.5, 1], [1, 0]], tint);
      gbK.box(x0 - o, top + rh - 0.1, zm - 0.45, x1 + o, top + rh + 0.55, zm + 0.45, rc.map(v => v * 0.8), 3);
    } else {
      const xm = (x0 + x1) / 2;
      const A = [x0 - o, top - 0.6, z1 + o], B = [x0 - o, top - 0.6, z0 - o], Cc = [xm, top + rh, z0 - o], D = [xm, top + rh, z1 + o];
      const E = [x1 + o, top - 0.6, z0 - o], F = [x1 + o, top - 0.6, z1 + o];
      const L = (z1 - z0 + 2 * o) / 3, Sl = hyp(rh + 0.6, span / 2 + o) / 3;
      gbK.quad([A, D, Cc, B], [[0, 0], [0, Sl], [L, Sl], [L, 0]], rc);
      gbK.quad([E, Cc, D, F], [[0, 0], [0, Sl], [L, Sl], [L, 0]], rc);
      gbP.tri([[x0, top, z0], [xm, top + rh * (span / 2) / (span / 2 + o), z0], [x1, top, z0]], [[0, 0], [.5, 1], [1, 0]], tint);
      gbP.tri([[x1, top, z1], [xm, top + rh * (span / 2) / (span / 2 + o), z1], [x0, top, z1]], [[0, 0], [.5, 1], [1, 0]], tint);
      gbK.box(xm - 0.45, top + rh - 0.1, z0 - o, xm + 0.45, top + rh + 0.55, z1 + o, rc.map(v => v * 0.8), 3);
    }
  }
  function rooftop(gb, b, top) {
    const r = mulberry32(b.seed * 7 + 1);
    const w = b.x1 - b.x0, d = b.y1 - b.y0;
    const n = 1 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) {
      const ux = b.x0 + 2 + r() * Math.max(1, w - 7), uz = b.y0 + 2 + r() * Math.max(1, d - 5);
      gb.box(ux, top, uz, ux + 2.2, top + 1.6, uz + 1.0, C('#d9d9d4'), 3);
    }
    if (b.hgt >= 4) {
      const ex = b.x0 + w * (0.25 + r() * 0.4), ez = b.y0 + d * (0.25 + r() * 0.4);
      gb.box(ex - 3, top, ez - 2.5, ex + 3, top + 5.5, ez + 2.5, C('#c8c5bd'), 3);
    }
    if (b.hgt >= 3 && r() < 0.5) {
      const tx = b.x1 - 5, tz = b.y1 - 5;
      gb.box(tx - 2, top + 2.6, tz - 2, tx + 2, top + 6.2, tz + 2, C('#cfd4d6'), 3);
      for (const [sx, sz] of [[-1.6, -1.6], [1.6, -1.6], [1.6, 1.6], [-1.6, 1.6]])
        gb.box(tx + sx - .15, top, tz + sz - .15, tx + sx + .15, top + 2.6, tz + sz + .15, C('#8a8e92'), 3);
    }
  }
  function adBoard(gbA, gbE, b, top) {
    const fs = frontSide(b);
    const ai = b.seed % ADS.length;
    const v0 = 1 - (ai + 1) / ADS.length, v1 = 1 - ai / ADS.length;
    const H0 = top + 3, H1 = top + 11;
    let A, B, n;
    const ix = 1.5;
    if (fs === 0 || fs === 2) {
      const z = fs === 0 ? b.y0 + ix : b.y1 - ix;
      const xa = b.x0 + 2, xb = Math.min(b.x1 - 2, xa + 32);
      A = fs === 0 ? [xb, z] : [xa, z]; B = fs === 0 ? [xa, z] : [xb, z];
    } else {
      const x = fs === 1 ? b.x1 - ix : b.x0 + ix;
      const za = b.y0 + 2, zb = Math.min(b.y1 - 2, za + 32);
      A = fs === 1 ? [x, za] : [x, zb]; B = fs === 1 ? [x, zb] : [x, za];
    }
    // 正面（道路側）
    gbA.quad([[B[0], H0, B[1]], [A[0], H0, A[1]], [A[0], H1, A[1]], [B[0], H1, B[1]]], [[0, v0], [1, v0], [1, v1], [0, v1]]);
    // 裏側の骨組み
    const m = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    for (const P of [A, B, m]) gbE.box(P[0] - 0.3, top, P[1] - 0.3, P[0] + 0.3, H1, P[1] + 0.3, C('#7d8186'), 3);
  }
  function yuSign(gbA, gbE, b, top) {
    // 「湯」の屋上看板：ADアトラスの最後（ぬくい湯温泉）を使う
    const ai = ADS.length - 1;
    const v0 = 1 - (ai + 1) / ADS.length, v1 = 1 - ai / ADS.length;
    const z = b.y0 + 1.5, xa = (b.x0 + b.x1) / 2 - 10, xb = xa + 20;
    gbA.quad([[xb, top + 2, z], [xa, top + 2, z], [xa, top + 7, z], [xb, top + 7, z]], [[0, v0], [1, v0], [1, v1], [0, v1]]);
    gbE.box(xa, top, z, xa + 0.5, top + 7, z + 0.5, C('#7d8186'), 3);
    gbE.box(xb - 0.5, top, z, xb, top + 7, z + 0.5, C('#7d8186'), 3);
  }

  /* ---------- モデルの複製配置（GLBノード） ---------- */
  function glbNode(file, name) {
    const g = G3.glb[file];
    if (!g) return null;
    return g.scene.getObjectByName(name) || null;
  }
  G3.glbNode = glbNode;
  // ノードを InstancedMesh 群に変換（matrices はノードのルート変換）
  const nightMats = new Map();
  function nightify(m) {
    if (!m || !/^(LampLight|VendLight)/.test(m.name || '')) return m;
    if (!nightMats.has(m)) { m.userData.base = m.emissiveIntensity || 1; nightMats.set(m, m); }
    return m;
  }
  function instanceNode(node, mats4, opts = {}) {
    const group = new THREE.Group();
    node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    node.traverse(o => {
      if (!o.isMesh) return;
      const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      const im = new THREE.InstancedMesh(o.geometry, Array.isArray(o.material) ? o.material.map(nightify) : nightify(o.material), mats4.length);
      im.userData.local = local;
      const m = new THREE.Matrix4();
      mats4.forEach((M, i) => { m.multiplyMatrices(M, local); im.setMatrixAt(i, m); });
      im.castShadow = opts.shadow !== false; im.receiveShadow = true;
      im.frustumCulled = false;
      group.add(im);
    });
    return group;
  }
  G3.instanceNode = instanceNode;
  const _q = new THREE.Quaternion(), _e = new THREE.Euler();
  function M4(x, y, z, rotY, s, sy) {
    _q.setFromEuler(_e.set(0, rotY, 0));
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(s, sy || s, s));
  }
  G3.M4 = M4;

  /* ---------- 樹木 ---------- */
  const treeChunks = [];
  let treeT = 0;
  function buildTrees(scene) {
    const groups = { broad_a: [], broad_b: [], pine: [], street: [], mikan: [], far: [], sakura: [] };
    const r = mulberry32(99);
    const avenue = new Set();
    for (const t of TREES) {
      const h = hillAt(t[0], t[1]);
      const ri = roadInfo(t[0], t[1]);
      const nearRoad = ri && ri.d < ri.road.w / 2 + 16;
      const y = heightAt(t[0], t[1]);
      const s = U * (0.75 + t[2] / 11 * 0.5);
      if (nearRoad) groups.street.push(M4(t[0], y, t[1], r() * TAU, U * 0.9));
      else if (h && h.castle && r() < 0.45) groups.pine.push(M4(t[0], y, t[1], r() * TAU, s));
      else (r() < .5 ? groups.broad_a : groups.broad_b).push(M4(t[0], y, t[1], r() * TAU, s));
    }
    for (const o of ORCHARDS) groups.mikan.push(M4(o[0], heightAt(o[0], o[1]), o[1], r() * TAU, U * (0.85 + r() * 0.3)));
    if (typeof RIVERSIDE !== 'undefined') for (const t of RIVERSIDE.sakura) groups.sakura.push(M4(t[0], heightAt(t[0], t[1]), t[1], r() * TAU, U * (0.85 + r() * 0.3)));
    // 山の森（遠景用の軽いモデル）
    for (const h of HILLS3) {
      const n = Math.round(h.rx * h.ry / (h.castle ? 900 : 1500) * G3.Q.trees);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, rr = Math.sqrt(r()) * 0.96;
        if (h.castle && rr < 0.42) continue;
        const x = h.x + Math.cos(a) * h.rx * rr, z = h.y + Math.sin(a) * h.ry * rr;
        if (inWaterRaw(x, z)) continue;
        if (h.castle) { (r() < .5 ? groups.pine : groups.broad_a).push(M4(x, heightAt(x, z), z, r() * TAU, U * (0.8 + r() * 0.5))); continue; }
        groups.far.push(M4(x, heightAt(x, z) - 0.5, z, r() * TAU, U * (1.0 + r() * 0.8)));
      }
    }
    // 城山（勝山）は森に: 斜面に木を足し、本丸の広場には桜（本丸・登り口・ロープウェイ・ミッション地点・建物は空ける）
    {
      const rc = mulberry32(9701), h = HILLS3.find(q => q.castle), c = CASTLE_DECK;
      const KP = [...MIKANS.map(m => [m.x, m.y]), ...MISSIONS.flatMap(m => [m.start, ...(m.goal ? [m.goal] : [])]), ...GIGSPOTS.map(g => [g[1], g[2]])];
      const rope = [[6338, 2892], [5945, 2762]];
      const okAt = (x, z, m) => !(inWaterRaw(x, z) || KP.some(k => hyp(k[0] - x, k[1] - z) < 10) || propHit(x, z, m, false) || seg(x, z, rope[0][0], rope[0][1], rope[1][0], rope[1][1]).d < 18 ||
        (() => { const ri = roadInfo(x, z); return ri && ri.d < ri.road.w / 2 + 8; })());
      for (let i = 0; i < 560; i++) {
        const a = rc() * TAU, rr = Math.sqrt(rc()) * 0.95;
        if (rr < 0.4) continue;
        const x = h.x + Math.cos(a) * h.rx * rr, z = h.y + Math.sin(a) * h.ry * rr;
        if (x > c.x0 - 26 && x < c.x1 + 26 && z > c.y0 - 26 && z < c.ry1 + 8) continue;
        if (!okAt(x, z, 2)) continue;
        const k = rc();
        (k < 0.45 ? groups.pine : k < 0.75 ? groups.broad_a : groups.broad_b).push(M4(x, heightAt(x, z), z, rc() * TAU, U * (0.75 + rc() * 0.5)));
      }
      let ns = 0;
      for (let x = c.x0 + 8; x < c.x1 - 6 && ns < 18; x += 13) for (let z = c.y0 + 8; z < c.y1 - 6 && ns < 18; z += 13) {
        if (hyp(x - c.x, z - c.y) < 30 || Math.abs(x - c.x) < c.rx + 4 && z > c.y1 - 20 || !okAt(x, z, 5)) continue;
        groups.sakura.push(M4(x, heightAt(x, z), z, rc() * TAU, U * (0.8 + rc() * 0.25))); ns++;
      }
    }
    // 堀・水面に落ちた木は除き、幹に当たり判定
    const _p = new THREE.Vector3();
    for (const k in groups) groups[k] = groups[k].filter(M => { _p.setFromMatrixPosition(M); return !inWaterRaw(_p.x, _p.z); });
    for (const k in groups) for (const M of groups[k]) { _p.setFromMatrixPosition(M); addCollider({ x: _p.x, y: _p.z, r: k === 'mikan' ? 0.45 : 0.7 }); }
    // 600単位のチャンクに分けて視錐台カリング＋距離で間引く
    const TFAR = { mikan: 1300, street: 1600, broad_a: 2200, broad_b: 2200, pine: 2200, far: 1e9, sakura: 2200 };
    for (const k in groups) {
      if (!groups[k].length) continue;
      const node = glbNode('trees', 'tree_' + k) || fallbackTree(k);
      const ch = new Map();
      for (const M of groups[k]) {
        const key = Math.floor(M.elements[12] / 600) + ',' + Math.floor(M.elements[14] / 600);
        (ch.get(key) || ch.set(key, []).get(key)).push(M);
      }
      for (const mats of ch.values()) {
        const g = instanceNode(node, mats, { shadow: k !== 'far' });
        g.traverse(o => { if (o.isInstancedMesh) { o.computeBoundingSphere(); o.frustumCulled = true; } });
        let cx = 0, cz = 0;
        for (const M of mats) { cx += M.elements[12]; cz += M.elements[14]; }
        treeChunks.push({ g, x: cx / mats.length, z: cz / mats.length, far: TFAR[k] + 450 });
        scene.add(g);
      }
    }
    // 樹冠の下の柔らかい接地影（AOの代わり）
    const blobs = [];
    for (const k of ['broad_a', 'broad_b', 'pine', 'street', 'mikan', 'sakura']) for (const M of groups[k]) blobs.push([M, k === 'mikan' ? 1.6 : k === 'street' ? 3.0 : 3.8]);
    const bg = new THREE.PlaneGeometry(2, 2); bg.rotateX(-Math.PI / 2);
    const bm = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: G3.radialTex(), transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -60 });
    const bi = new THREE.InstancedMesh(bg, bm, blobs.length);
    const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    blobs.forEach(([M, r], i) => {
      M.decompose(pos, q, sc);
      pos.y += 0.15;
      bi.setMatrixAt(i, new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new THREE.Vector3(r * sc.x, 1, r * sc.x)));
    });
    bi.frustumCulled = false;
    bi.renderOrder = 1;
    scene.add(bi);
  }
  function fallbackTree(k) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 3, 6), new THREE.MeshStandardMaterial({ color: 0x5b4632 }));
    trunk.position.y = 1.5;
    const leafCol = k === 'pine' ? 0x2f4d2c : k === 'mikan' ? 0x3c6a33 : 0x4a7040;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(k === 'mikan' ? 1.4 : 2.2, 1), new THREE.MeshStandardMaterial({ color: leafCol, roughness: 0.9, flatShading: true }));
    crown.position.y = k === 'mikan' ? 1.8 : 4;
    g.add(trunk, crown);
    return g;
  }

  /* ---------- 街具 ---------- */
  function roadAngleAt(x, y) {
    const ri = roadInfo(x, y);
    if (!ri) return { a: 0, toRoad: 0 };
    return { a: Math.atan2(ri.ty, ri.tx), toRoad: Math.atan2(ri.y - y, ri.x - x), ri };
  }
  function buildProps(scene) {
    const add = (name, list, fb) => {
      if (!list.length) return;
      const node = glbNode('props', name) || fb();
      scene.add(instanceNode(node, list));
    };
    // 街灯: アームを道路側へ
    const lamps = LAMPS.map(l => { const r = roadAngleAt(l[0], l[1]); return M4(l[0], heightAt(l[0], l[1]) + CURB, l[1], -r.toRoad, U); });
    // 当たり判定（見た目どおりに止まる）
    LAMPS.forEach((l, i) => addCollider({ x: l[0], y: l[1], r: 0.5, brk: 95, bid: 'lamp#' + i }));
    for (const p of POLES) addCollider({ x: p.x, y: p.y, r: 0.55 });
    for (const sg of SIGNALS) addCollider({ x: sg.x, y: sg.y, r: 0.4 });
    for (const v of VENDING) { const r = roadAngleAt(v.x, v.y); addCollider({ x: v.x, y: v.y, hx: 1.05, hy: 1.35, a: r.toRoad }); }
    for (const b of BUSSTOPS) {
      const r = roadAngleAt(b[0], b[1]), c = Math.cos(r.toRoad), sn = Math.sin(r.toRoad);
      addCollider({ x: b[0], y: b[1], r: 0.35 });
      addCollider({ x: b[0] - c * 1.5, y: b[1] - sn * 1.5, hx: 0.5, hy: 1.8, a: r.toRoad });
    }
    add('lamp', lamps, () => simpleProp(0x7a7e84, 0.15, 15));
    G3.brkExtra = { lamp: { node: glbNode('props', 'lamp'), mats: lamps, group: scene.children[scene.children.length - 1] } };
    // 電柱
    const poles = POLES.map(p => { const r = roadAngleAt(p.x, p.y); return M4(p.x, heightAt(p.x, p.y) + CURB, p.y, -r.a, U); });
    add('pole', poles, () => simpleProp(0x8a8478, 0.25, 24));
    // 自販機（道路を向く）
    const vm = { red: [], blue: [], white: [] };
    for (const v of VENDING) {
      const r = roadAngleAt(v.x, v.y);
      const k = v.c === '#d43c3c' ? 'red' : v.c === '#2456a8' ? 'blue' : 'white';
      vm[k].push(M4(v.x, heightAt(v.x, v.y) + CURB, v.y, -r.toRoad, U));
    }
    for (const k in vm) add('vending_' + k, vm[k], () => simpleBox(k === 'red' ? 0xc8282a : k === 'blue' ? 0x2456a8 : 0xeeeeee, 2.6, 4.6, 2));
    // バス停
    add('busstop', BUSSTOPS.map(b => { const r = roadAngleAt(b[0], b[1]); return M4(b[0], heightAt(b[0], b[1]) + CURB, b[1], -r.toRoad, U); }), () => simpleProp(0xe8862c, 0.12, 6));
    // 電線（電柱間のたるみ）
    const wire = [];
    for (const p of POLES) {
      if (p.lx == null) continue;
      const y0 = heightAt(p.x, p.y) + 21.5, y1 = heightAt(p.lx, p.ly) + 21.5;
      const r = roadAngleAt(p.x, p.y);
      const nx = -Math.sin(r.a), nz = Math.cos(r.a);
      for (const off of [-2.2, 0, 2.2]) {
        let px = p.x + nx * off, pz = p.y + nz * off, py = y0;
        const N = 8;
        for (let i = 1; i <= N; i++) {
          const t = i / N;
          const x = lerp(p.x, p.lx, t) + nx * off, z = lerp(p.y, p.ly, t) + nz * off;
          const y = lerp(y0, y1, t) - Math.sin(t * Math.PI) * 1.6;
          wire.push(px, py, pz, x, y, z);
          px = x; py = y; pz = z;
        }
      }
    }
    // 路面電車の架線
    for (const pl of [TRAM_LOOP, DOGO_LINE]) {
      for (let d = 0; d + 40 < pl.len; d += 40) {
        const a = plAt(pl, d), b = plAt(pl, d + 40);
        wire.push(a.x, heightAt(a.x, a.y) + 15, a.y, b.x, heightAt(b.x, b.y) + 15, b.y);
      }
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x23262a, transparent: true, opacity: 0.75 })));
    // 信号機（灯器は個別に制御するため通常のクローン）
    const sigNode = glbNode('props', 'signal');
    for (const sg of SIGNALS) {
      const o = sigNode ? sigNode.clone(true) : simpleProp(0x7d8188, 0.15, 15);
      // アームの向き = (-sin a, cos a)
      const armA = Math.atan2(Math.cos(sg.a), -Math.sin(sg.a));
      o.position.set(sg.x, heightAt(sg.x, sg.y) + CURB, sg.y);
      o.rotation.y = -armA;
      o.scale.setScalar(U);
      const lamps = {};
      o.traverse(c => {
        if (c.isMesh) { c.castShadow = true; }
        if (c.isMesh && c.material && /^Sig[GYR]/.test(c.material.name)) {
          c.material = c.material.clone();
          lamps[c.material.name[3]] = c.material;
        }
      });
      anim.signals.push({ sg, lamps });
      scene.add(o);
    }
    // マンホール
    const mh = new GB(false);
    // 幹線のマンホールに加えて、生活道路・路地にも（交差点を避けて）
    const mhs = MANHOLES.slice();
    for (const r of ROADS) {
      if (r.kind !== 'minor' && r.kind !== 'lane') continue;
      const step = r.kind === 'lane' ? 55 : 80;
      for (let d = 25, k = 0; d < r.pl.len - 15; d += step, k++) {
        if (r.junc.some(j => Math.abs(j.d - d) < j.road.w / 2 + 6)) continue;
        const p = plAt(r.pl, d), o = (k % 2 ? 1 : -1) * (r.kind === 'lane' ? 1.8 : r.w * 0.16);
        mhs.push([p.x - Math.sin(p.a) * o, p.y + Math.cos(p.a) * o]);
      }
    }
    for (const m of mhs) {
      const y = heightAt(m[0], m[1]) + 0.08, r2 = 1.6;
      mh.quad([[m[0] - r2, y, m[1] + r2], [m[0] + r2, y, m[1] + r2], [m[0] + r2, y, m[1] - r2], [m[0] - r2, y, m[1] - r2]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    const mhTex = canvasTex(128, 128, g => {
      g.clearRect(0, 0, 128, 128);
      g.fillStyle = '#4a4c4f'; g.beginPath(); g.arc(64, 64, 62, 0, TAU); g.fill();
      g.strokeStyle = '#2c2e31'; g.lineWidth = 3;
      for (let r3 = 14; r3 < 60; r3 += 11) { g.beginPath(); g.arc(64, 64, r3, 0, TAU); g.stroke(); }
      for (let a = 0; a < 12; a++) { g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a / 12 * TAU) * 60, 64 + Math.sin(a / 12 * TAU) * 60); g.stroke(); }
      g.fillStyle = '#ff9d2e'; g.beginPath(); g.arc(64, 64, 9, 0, TAU); g.fill();
    });
    scene.add(mh.mesh(new THREE.MeshStandardMaterial({ map: mhTex, transparent: true, roughness: 0.4, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -60 }), false));
    // 夜の光だまり（街灯の下）
    const lp = new GB(false);
    for (const l of LAMPS) {
      const r = roadAngleAt(l[0], l[1]);
      const x = l[0] + Math.cos(r.toRoad) * 6, z = l[1] + Math.sin(r.toRoad) * 6, y = heightAt(x, z) + 0.12, s = 22;
      lp.quad([[x - s, y, z + s], [x + s, y, z + s], [x + s, y, z - s], [x - s, y, z - s]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    }
    const lpm = lp.mesh(WM.lampGlow, false);
    lpm.renderOrder = 2;
    scene.add(lpm);
  }
  function simpleProp(col, r, h) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.3, h / U, 6), new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
    m.position.y = h / U / 2;
    g.add(m);
    return g;
  }
  function simpleBox(col, w, h, d) {
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(w / U, h / U, d / U), new THREE.MeshStandardMaterial({ color: col, roughness: 0.4 }));
    m.position.y = h / U / 2;
    g.add(m);
    return g;
  }

  /* ---------- ランドマーク ---------- */
  // LMSの名前 → landmarks.glb のノード名・回転
  const LM_MAP = {
    '松山城': ['castle', 0], '萬翠荘': ['bansuiso', 0], '松山市役所': ['cityhall', 0], '愛媛県庁': ['prefoffice', 0],
    '松山市駅・高島屋': ['takashimaya', 0], 'JR松山駅': ['jrstation', 0], '道後温泉本館': ['dogo_honkan', 0],
    '道後温泉駅': ['dogo_station', 0], '子規記念博物館': ['shiki', 0], '石手寺': ['ishiteji', 0], '愛媛大学': ['campus_a', 0],
    '松山大学': ['campus_b', 0], '松山赤十字病院': ['hospital', 0], '松山東警察署': ['police', 0], '護国神社': ['shrine', 0],
    '坊っちゃんスタジアム': ['stadium', 0], '松山総合公園': ['parktower', 0], '松山空港': ['airport', 0], '三津浜港': ['port', 0],
    '松山観光港': ['ferryterminal', 0], '高浜駅': ['takahama_station', 0], 'ロープウェイ乗り場': ['ropeway', 0],
    '松山三越': ['mitsukoshi', 0], '坂の上の雲ミュージアム': ['sakakumo', 0], '愛媛県美術館': ['artmuseum', 0],
    '伊予銀行本店': ['iyogin', 0], 'フジグラン松山': ['fujigran', 0], '南海放送鉄塔': ['radiotower', 0],
    '松山東高': ['school_a', 0], '市立小学校': ['school_b', 0], '伊佐爾波神社': ['isaniwa', 0], '椿神社': ['tsubaki', 0],
    '飛鳥乃湯泉': ['asuka', 0],
  };
  // Blender側のマテリアル命名規約に従い、ゲーム用マテリアルへ差し替える
  const lmCache = {};
  function lmMat(m) {
    const n = m.name || '';
    if (lmCache[n]) return lmCache[n];
    let r = m;
    if (n.startsWith('FAC_')) {
      const base = WM['fac_' + n.slice(4)];
      if (base) {
        r = base.clone();
        r.vertexColors = false;
        r.onBeforeCompile = base.onBeforeCompile;
        const key = base.customProgramCacheKey();
        r.customProgramCacheKey = () => key + 'lm';
        r.userData.uni = base.userData.uni;
      }
    } else if (n.startsWith('TEX_')) {
      const t = G3.tex[n.slice(4)];
      r = new THREE.MeshStandardMaterial({ map: t || null, color: m.color, roughness: m.roughness, metalness: m.metalness, side: m.side });
    } else if (n.startsWith('NightGlow')) {
      r = m.clone();
      // Blender 側は昼の見た目のため発光強度0で書き出している → 発光色をここで与える
      if (r.emissive && r.emissive.getHex() === 0) r.emissive.set(n.includes('Red') ? 0xff5a30 : /Light|Clock|Sign/.test(n) ? 0xfff2dc : 0xffcf8a);
      r.userData.glowK = /Light|Clock|Sign/.test(n) ? 1.5 : n.includes('Red') ? 2.0 : 1.0;
      if (/Blink/.test(n)) { r.userData.blink = n.includes('Red') ? 0 : 2.1; r.userData.glowK *= 2.5; }   // 灯台: 4秒ごとに点滅（赤と白で位相をずらす）
      anim.glow.push(r);
    }
    lmCache[n] = r;
    return r;
  }
  G3.lmMat = lmMat;
  function buildLandmarks(scene) {
    for (const l of LMS) {
      const mp = LM_MAP[l.n];
      if (!mp) continue;
      const node = glbNode('landmarks', mp[0]);
      let o;
      if (node) {
        o = node.clone(true);
        o.scale.setScalar(U);
      } else {
        o = fallbackLandmark(l);
        if (!o) continue;
      }
      const y = l.t === 'castle' ? CASTLE_DECK.base : 0;
      if (l.t === 'castle') castleRamp(scene);
      o.position.set(l.x, y, l.y);
      o.rotation.y = mp[1];
      o.traverse(c => {
        if (!c.isMesh) return;
        c.castShadow = true; c.receiveShadow = true;
        c.material = Array.isArray(c.material) ? c.material.map(lmMat) : lmMat(c.material);
      });
      // 観覧車（くるりん）
      const wheel = o.getObjectByName('kururin_wheel');
      if (wheel) {
        const gons = [];
        wheel.traverse(c => { if (/^kururin_gon/.test(c.name)) gons.push(c); });
        anim.wheels.push({ wheel, gons });
      }
      // ロープウェイのゴンドラはシーン直下へ移し、城山までのケーブルに沿って動かす
      const gon = o.getObjectByName('ropeway_gondola');
      if (gon) {
        o.updateMatrixWorld(true);
        const st = new THREE.Vector3().setFromMatrixPosition(gon.matrixWorld);
        gon.parent.remove(gon);
        gon.scale.setScalar(U);
        scene.add(gon);
        const en = new THREE.Vector3(5945, heightAt(5945, 2762) + 14, 2762);
        anim.gondola = { o: gon, a: st, b: en };
        const cg = new THREE.BufferGeometry().setFromPoints([st.clone().add(new THREE.Vector3(0, 9, 2)), en.clone().add(new THREE.Vector3(0, 9, 2)),
          st.clone().add(new THREE.Vector3(0, 9, -2)), en.clone().add(new THREE.Vector3(0, 9, -2))]);
        scene.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0x2a2c30 })));
      }
      scene.add(o);
      if (node) {
        bakeOccupancy(o); placedLM.push(l);
        const bb = new THREE.Box3().setFromObject(o);
        (G3.lmBoxes || (G3.lmBoxes = [])).push([bb.min.x, bb.min.z, bb.max.x, bb.max.z]);
      }
    }
    // 手書きの矩形（LMS.solid）はモデルと合わないことがあるので、モデルから焼いた当たり判定に置き換える
    if (typeof bldGrid !== 'undefined') {
      const drop = new Set();
      for (const l of placedLM) if (l.solid) drop.add(l.solid.join(','));
      for (const [k, a] of bldGrid) bldGrid.set(k, a.filter(b => !(b.noDraw && drop.has([b.x0, b.y0, b.x1, b.y1].join(',')))));
    }
  }
  const placedLM = [];
  // 本丸の正門前の石段（坂）
  function castleRamp(scene) {
    const c = CASTLE_DECK, gb = new GB(false);
    const yTop = c.base + c.top, yBot = c.base;
    const x0 = c.x - c.rx, x1 = c.x + c.rx;
    gb.quad([[x0, yTop + 0.03, c.y1 - 1], [x0, yTop + 0.03, c.ry0], [x1, yTop + 0.03, c.ry0], [x1, yTop + 0.03, c.y1 - 1]], [[0, 0], [0, 1], [3, 1], [3, 0]]);
    gb.quad([[x0, yTop + 0.03, c.ry0], [x0, yBot + 0.03, c.ry1], [x1, yBot + 0.03, c.ry1], [x1, yTop + 0.03, c.ry0]], [[0, 0], [0, 3], [3, 3], [3, 0]]);
    for (const x of [x0, x1]) {
      gb.quad([[x, yBot - 1, c.y1], [x, yBot - 1, c.ry0], [x, yTop + 0.03, c.ry0], [x, yTop + 0.03, c.y1]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      gb.tri([[x, yBot - 1, c.ry0], [x, yBot - 1, c.ry1], [x, yTop + 0.03, c.ry0]], [[0, 0], [1, 0], [0, 1]]);
    }
    const m = gb.mesh(new THREE.MeshStandardMaterial({ map: G3.tex.stonewall || null, color: 0xb9b2a4, roughness: 0.9, side: THREE.DoubleSide }), false);
    scene.add(m);
  }
  // モデルの三角形のうち、地面から 0.4〜1.9m（体の高さ）にある部分を OCC のマスに焼く
  // ランドマークの当たり判定: 地面から 0.4〜1.9m の高さにある面を、高さで切り取ってから格子に塗る
  // （三角形を細かく点で埋めると大きな壁で遅いので、辺をなぞり、水平に近い面だけ中を塗る）
  function bakeOccupancy(o) {
    if (typeof occAdd !== 'function') return;
    o.updateMatrixWorld(true);
    const lo = 0.4 * U, hi = 1.9 * U, C2 = OCELL;
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const clip = (poly, h, above) => {
      const out = [];
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], b = poly[(i + 1) % poly.length], ia = above ? a[1] >= h : a[1] <= h, ib = above ? b[1] >= h : b[1] <= h;
        if (ia) out.push(a);
        if (ia !== ib) { const t = (h - a[1]) / (b[1] - a[1]); out.push([a[0] + (b[0] - a[0]) * t, h, a[2] + (b[2] - a[2]) * t]); }
      }
      return out;
    };
    o.traverse(m => {
      if (!m.isMesh || !m.geometry || !m.geometry.attributes.position) return;
      const pos = m.geometry.attributes.position, idx = m.geometry.index;
      const n = idx ? idx.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        for (let q = 0; q < 3; q++) P[q].fromBufferAttribute(pos, idx ? idx.getX(t + q) : t + q).applyMatrix4(m.matrixWorld);
        const cx = (P[0].x + P[1].x + P[2].x) / 3, cz = (P[0].z + P[1].z + P[2].z) / 3, g0 = heightAt(cx, cz);
        if (Math.max(P[0].y, P[1].y, P[2].y) - g0 < lo || Math.min(P[0].y, P[1].y, P[2].y) - g0 > hi) continue;
        const poly = clip(clip(P.map(v => [v.x, v.y, v.z]), g0 + lo, true), g0 + hi, false);
        if (poly.length < 2) continue;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length], L = Math.hypot(b[0] - a[0], b[2] - a[2]), st = Math.max(1, Math.ceil(L / (C2 * 0.5)));
          for (let j = 0; j <= st; j++) {
            const x = a[0] + (b[0] - a[0]) * j / st, z = a[2] + (b[2] - a[2]) * j / st;
            // 坂（石段など）の上では、その場所の地面からの高さで判定し直す
            const yy = a[1] + (b[1] - a[1]) * j / st - heightAt(x, z);
            if (yy >= lo - 0.3 && yy <= hi) occAdd(x, z);
          }
        }
        let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
        for (const v of poly) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[2]); z1 = Math.max(z1, v[2]); }
        if (x1 - x0 > C2 && z1 - z0 > C2) {
          for (let x = Math.floor(x0 / C2) * C2 + C2 / 2; x < x1; x += C2) for (let z = Math.floor(z0 / C2) * C2 + C2 / 2; z < z1; z += C2) {
            let inside = false;
            for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
              const a = poly[i], b = poly[j];
              if ((a[2] > z) !== (b[2] > z) && x < (b[0] - a[0]) * (z - a[2]) / (b[2] - a[2]) + a[0]) inside = !inside;
            }
            if (!inside) continue;
            // 面の高さ（平面の式）を地面と比べる
            const e1 = [P[1].x - P[0].x, P[1].y - P[0].y, P[1].z - P[0].z], e2 = [P[2].x - P[0].x, P[2].y - P[0].y, P[2].z - P[0].z];
            const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
            const y = Math.abs(ny) > 1e-6 ? P[0].y - (nx * (x - P[0].x) + nz * (z - P[0].z)) / ny : g0 + lo;
            const yr = y - heightAt(x, z);
            if (yr >= lo && yr <= hi) occAdd(x, z);
          }
        }
      }
    });
  }
  function fallbackLandmark(l) {
    if (!l.solid) return null;
    const s = l.solid, h = (LMH[l.t] || 14) * 1.3;
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.BoxGeometry(s[2] - s[0], h, s[3] - s[1]), new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.7 }));
    m.position.set((s[0] + s[2]) / 2 - l.x, h / 2, (s[1] + s[3]) / 2 - l.y);
    g.add(m);
    return g;
  }

  /* ---------- 毎フレーム ---------- */
  function update(dt) {
    if (G3.street) G3.street.update(dt);
    if ((treeT -= dt) <= 0) {
      treeT = 0.3;
      const c = G3.camera.position;
      for (const k of treeChunks) { const dx = k.x - c.x, dz = k.z - c.z; k.g.visible = dx * dx + dz * dz < k.far * k.far; }
    }
    for (const t of anim.water) { t.offset.x += dt * 0.004; t.offset.y += dt * 0.0025; }
    for (const w of anim.wheels) {
      w.wheel.rotation.x += dt * 0.06;
      for (const g of w.gons) g.rotation.x = -w.wheel.rotation.x;   // ゴンドラは常に吊り下がる
    }
    if (anim.gondola) {
      const t = (Math.sin(tSec * .12) + 1) / 2;
      anim.gondola.o.position.lerpVectors(anim.gondola.a, anim.gondola.b, t);
    }
    // モノレールの運搬車: 約70秒で山すそと上を往復（止まりながら）
    for (const c of anim.carts) {
      const ph = ((performance.now() / 1000 + c.ph) % 70) / 70, s2 = clamp(0.5 - 0.5 * Math.cos(ph * TAU) * 1.15, 0, 1);
      const f = s2 * (c.pts.length - 1), i = Math.min(c.pts.length - 2, Math.floor(f)), k = f - i;
      const a = c.pts[i], b = c.pts[i + 1];
      c.o.position.set(lerp(a[0], b[0], k), lerp(a[1], b[1], k) + 0.45, lerp(a[2], b[2], k));
      c.o.rotation.set(0, -Math.atan2(b[2] - a[2], b[0] - a[0]), 0);
      c.o.rotateZ(Math.atan2(b[1] - a[1], Math.hypot(b[0] - a[0], b[2] - a[2])));
      c.o.scale.setScalar(1.25);
    }
    for (const s of anim.signals) {
      const col = sigCol(s.sg.g);
      const on = { G: col === '#3ee06a', Y: col === '#ffd23c', R: col === '#ff4646' };
      for (const k in s.lamps) s.lamps[k].emissiveIntensity = on[k] ? 3.5 : 0.04;
    }
  }
  function updEnv(dt, day) {
    const night = clamp(1 - day * 1.6, 0, 1);
    for (const m of anim.winMats) m.userData.uni.uNight.value = night;
    for (const m of anim.neon) m.emissiveIntensity = night * 0.9;
    const tb = performance.now() / 1000;
    for (const m of anim.glow) m.emissiveIntensity = night * m.userData.glowK * (m.userData.blink === undefined ? 1 : ((tb + m.userData.blink) % 4 < 0.8 ? 1 : 0.04));
    for (const m of nightMats.keys()) m.emissiveIntensity = 0.05 + night * (m.name.startsWith('Lamp') ? 6 : 1.4);
    WM.lampGlow.opacity = night * 0.85;
    const wet = G3.wet;
    for (const m of anim.wet) { m.roughness = lerp(0.88, 0.32, wet); m.envMapIntensity = 1 + wet * 1.5; }
  }

  function build() {
    const scene = G3.scene, WT = G3.worldTimes = {}; let tw = performance.now();
    const lapw = k => { const t = performance.now(); WT[k] = Math.round(t - tw); tw = t; };
    buildMaterials();
    buildGround(scene); lapw('buildGround');
    buildWater(scene); lapw('buildWater');
    buildHills(scene); lapw('buildHills');
    buildBackdrop(scene); lapw('buildBackdrop');
    buildFields(scene); lapw('buildFields');
    buildCanals(scene); lapw('buildCanals');
    buildRiverside(scene); lapw('buildRiverside');
    buildRoads(scene); lapw('buildRoads');
    buildFrontage(scene); lapw('buildFrontage');
    buildRailways(scene); lapw('buildRailways');
    buildViaduct(scene); lapw('buildViaduct');
    buildBuildings(scene); lapw('buildBuildings');
    buildLandmarks(scene); lapw('buildLandmarks');
    buildTrees(scene); lapw('buildTrees');
    buildEstates(scene); lapw('buildEstates');
    buildYuzuki(scene); lapw('buildYuzuki');
    buildProps(scene); lapw('buildProps');
    if (G3.street) G3.street.build(scene); lapw('street');
  }
  return { build, update, updEnv, WM, anim, canvasTex };
})();
