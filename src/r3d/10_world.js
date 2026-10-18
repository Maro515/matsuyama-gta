'use strict';
/* =========================================================
   静的な街の構築（地形・水・丘・田畑・道路・鉄道・建物・樹木・街具）
   ========================================================= */
G3.world = (function () {
  const THREE = G3.THREE;
  const U = G3.U;
  const WM = {};      // マテリアル
  const anim = { wheels: [], gondola: null, water: [], signals: [], winMats: [], lightPools: [], neon: [], wet: [], glow: [] };

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
    for (const f of ['office', 'glass', 'mansion', 'shop', 'house', 'hotel', 'gshop', 'goffice', 'ghouse']) {
      const m = new THREE.MeshStandardMaterial({ map: G3.tex['fac_' + f], vertexColors: true, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.9 });
      const mask = G3.tex['facm_' + f];
      const ground = f[0] === 'g';
      const uni = { uMask: { value: mask }, uNight: { value: 0 }, uRatio: { value: ground ? 0.75 : 0.38 }, uEmit: { value: ground ? 0.95 : 0.62 } };
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
    ['うどん', '#e8e0c8'], ['鯛めし', '#1f5aa8'], ['じゃこ天', '#c85a1a'], ['質', '#202020'], ['焼鳥', '#a01818'], ['喫茶', '#5a3a22'], ['不動産', '#2a4a8a']];
  function signAtlas() {
    return canvasTex(64 * SIGNS.length, 256, (g) => {
      SIGNS.forEach(([t, col], i) => {
        const x = i * 64;
        g.fillStyle = col; g.fillRect(x, 0, 64, 256);
        g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 4; g.strokeRect(x + 4, 4, 56, 248);
        const light = (col === '#e8e0c8');
        g.fillStyle = light ? '#7a1a10' : '#fff';
        g.font = '900 40px "Hiragino Mincho ProN","Yu Mincho",serif'; g.textAlign = 'center';
        const ch = [...t];
        const step = Math.min(56, 230 / ch.length);
        ch.forEach((cc, k) => g.fillText(cc, x + 32, 24 + step * k + step * .72));
      });
    });
  }
  const ADS = [['伊予柑ソーダ', '#ff8a1a', '#fff'], ['坊っちゃん不動産', '#1e4f9a', '#fff'], ['マドンナ生命', '#d43a6a', '#fff'],
    ['道後ビール', '#2a2a2a', '#f2c84a'], ['しまなみ自動車', '#127a6a', '#fff'], ['ぬくい湯温泉', '#b0281e', '#fff']];
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
      // 敷地のまだら
      const r2 = mulberry32(77);
      for (let i = 0; i < 2600; i++) {
        const x = r2() * W, y = r2() * H, s = 12 + r2() * 40;
        g.fillStyle = r2() < .5 ? 'rgba(120,128,96,.25)' : 'rgba(180,176,160,.25)';
        g.fillRect(x, y, s, s * (.6 + r2()));
      }
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
      g.strokeStyle = '#7f9c5c'; g.lineWidth = 60; g.strokeRect(5490, 2585, 620, 660);
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
    // 城の堀
    const moat = [[5490, 2585], [6110, 2585], [6110, 3245], [5490, 3245], [5490, 2585]];
    ribbon(gb, moat, -13, 13, () => 0.05, 30);
    // 道後公園の堀（円）
    const ring = [];
    for (let i = 0; i <= 48; i++) { const a = i / 48 * TAU; ring.push([7430 + Math.cos(a) * 162, 2585 + Math.sin(a) * 162]); }
    ribbon(gb, ring, -10, 10, () => 0.05, 30);
    const m = gb.mesh(wm2, false);
    scene.add(m);
    // 石垣の護岸（堀の内外）
    const sw = new GB(false);
    wallStrip(sw, moat, -13, 0.05, 3.2);
    wallStrip(sw, moat, 13, 0.05, 3.2);
    scene.add(sw.mesh(WM.stone, false));
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
      mark.push([j.d - half - 1.5, j.d + half + 1.5]);
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
    const gbSide = new GB(false), gbCurb = new GB(false), gbW = new GB(false), gbY = new GB(false), gbArc = new GB(false);
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
    buildCrosswalks(scene);
    buildTramRails(scene);
    buildArcadeRoofs(scene);
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
  function buildRailways(scene) {
    const gbB = new GB(false), gbR = new GB(false);
    const sl = [];
    for (const r of RAILS) {
      const pts = r.pl.pts;
      const yb = (x, z) => heightAt(x, z) + 0.2;
      ribbon(gbB, pts, -5, 5, yb, 8);
      curbWall(gbB, pts, 5, (x, z) => heightAt(x, z), yb, 1);
      curbWall(gbB, pts, -5, (x, z) => heightAt(x, z), yb, -1);
      for (const s of [-1, 1]) {
        ribbon(gbR, pts, s * 1.34 - 0.15, s * 1.34 + 0.15, (x, z) => heightAt(x, z) + 0.72, 10);
        curbWall(gbR, pts, s * 1.34 - 0.15, (x, z) => heightAt(x, z) + 0.45, (x, z) => heightAt(x, z) + 0.72, -1);
        curbWall(gbR, pts, s * 1.34 + 0.15, (x, z) => heightAt(x, z) + 0.45, (x, z) => heightAt(x, z) + 0.72, 1);
      }
      for (let d = 0; d < r.pl.len; d += 1.6) {
        const p = plAt(r.pl, d);
        sl.push([p.x, heightAt(p.x, p.y) + 0.35, p.y, p.a]);
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

  /* ---------- 建物 ---------- */
  const FLOOR = 7, BAY = { office: 9, glass: 9, mansion: 9, shop: 7.5, house: 9, hotel: 9, gshop: 9, goffice: 9, ghouse: 9 };
  function upperTex(b) {
    if (b.kind === 'house') return 'house';
    if (b.kind === 'mansion') return 'mansion';
    if (b.kind === 'hotel') return 'hotel';
    if (b.kind === 'shop') return 'shop';
    return (b.hgt >= 5 && b.seed % 3 === 0) ? 'glass' : 'office';
  }
  function groundTex(b) {
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
    const gbRoof = new GB(true), gbPar = new GB(true), gbKaw = new GB(true), gbEq = new GB(true), gbSign = new GB(false), gbAd = new GB(false);
    const signs = [];
    for (const b of buildings) {
      if (b.noDraw) continue;
      const x0 = b.x0, z0 = b.y0, x1 = b.x1, z1 = b.y1;
      const top = b.hW, gH = Math.max(6, top - FLOOR * b.hgt);
      const tint = tintOf(b);
      const ut = upperTex(b), gt = groundTex(b);
      const faces = [
        [[x0, z0], [x1, z0]], [[x1, z0], [x1, z1]], [[x1, z1], [x0, z1]], [[x0, z1], [x0, z0]],
      ];
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
      if (b.kind === 'house') {
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
        const si = b.seed % SIGNS.length;
        const sh0 = gH + 1, sh1 = Math.min(top - 1, gH + 1 + Math.max(10, (top - gH) * 0.75));
        signs.push({ b, fs, si, sh0, sh1 });
      }
      // 屋上広告塔
      if (b.kind === 'office' && b.hgt >= 5 && b.seed % 4 === 0) adBoard(gbAd, gbEq, b, top);
      if (b.kind === 'hotel') yuSign(gbAd, gbEq, b, top);
    }
    for (const k in GBs) {
      const m = GBs[k].mesh(WM['fac_' + k], true);
      scene.add(m);
    }
    const rm = gbRoof.mesh(WM.concrete, false); rm.receiveShadow = true; scene.add(rm);
    scene.add(gbPar.mesh(WM.plaster, true), gbKaw.mesh(WM.kawara, true), gbEq.mesh(WM.metal, true));
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
  function houseRoof(gbK, gbP, b, top, tint) {
    const x0 = b.x0, z0 = b.y0, x1 = b.x1, z1 = b.y1, o = 1.2;
    const longX = (x1 - x0) >= (z1 - z0);
    const span = longX ? (z1 - z0) : (x1 - x0);
    const rh = span * 0.32;
    const rc = [C('#5a626e'), C('#71584e'), C('#4e5a66'), C('#6a6a66')][b.seed % 4].map(v => v * 1.6);
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
  function buildTrees(scene) {
    const groups = { broad_a: [], broad_b: [], pine: [], street: [], mikan: [], far: [] };
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
    for (const k in groups) {
      if (!groups[k].length) continue;
      const node = glbNode('trees', 'tree_' + k) || fallbackTree(k);
      const g = instanceNode(node, groups[k], { shadow: k !== 'far' });
      scene.add(g);
    }
    // 樹冠の下の柔らかい接地影（AOの代わり）
    const blobs = [];
    for (const k of ['broad_a', 'broad_b', 'pine', 'street', 'mikan']) for (const M of groups[k]) blobs.push([M, k === 'mikan' ? 1.6 : k === 'street' ? 3.0 : 3.8]);
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
    add('lamp', lamps, () => simpleProp(0x7a7e84, 0.15, 15));
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
    for (const m of MANHOLES) {
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
    '松山東高': ['school_a', 0], '市立小学校': ['school_b', 0],
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
      r.userData.glowK = n.includes('Light') ? 8 : n.includes('Red') ? 5 : 2.6;
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
      const y = l.t === 'castle' ? heightAt(l.x, l.y) : 0;
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
    }
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
    for (const t of anim.water) { t.offset.x += dt * 0.004; t.offset.y += dt * 0.0025; }
    for (const w of anim.wheels) {
      w.wheel.rotation.x += dt * 0.06;
      for (const g of w.gons) g.rotation.x = -w.wheel.rotation.x;   // ゴンドラは常に吊り下がる
    }
    if (anim.gondola) {
      const t = (Math.sin(tSec * .12) + 1) / 2;
      anim.gondola.o.position.lerpVectors(anim.gondola.a, anim.gondola.b, t);
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
    for (const m of anim.neon) m.emissiveIntensity = night * 1.6;
    for (const m of anim.glow) m.emissiveIntensity = night * m.userData.glowK;
    for (const m of nightMats.keys()) m.emissiveIntensity = 0.05 + night * (m.name.startsWith('Lamp') ? 6 : 1.4);
    WM.lampGlow.opacity = night * 0.85;
    const wet = G3.wet;
    for (const m of anim.wet) { m.roughness = lerp(0.88, 0.32, wet); m.envMapIntensity = 1 + wet * 1.5; }
  }

  function build() {
    const scene = G3.scene;
    buildMaterials();
    buildGround(scene);
    buildWater(scene);
    buildHills(scene);
    buildBackdrop(scene);
    buildFields(scene);
    buildRoads(scene);
    buildRailways(scene);
    buildBuildings(scene);
    buildLandmarks(scene);
    buildTrees(scene);
    buildProps(scene);
    if (G3.street) G3.street.build(scene);
  }
  return { build, update, updEnv, WM, anim, canvasTex };
})();
