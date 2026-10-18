'use strict';
/* =========================================================
   R3: three.js(WebGL) による3D描画。アセットはBlenderで制作。
   座標: three.x = ゲームx, three.z = ゲームy, three.y = 高さ（すべてゲーム単位 1u=0.4m）
   Blender(m) のモデルは G3.U=2.5 倍して配置する。
   ========================================================= */
const G3 = {};
const R3 = { ok: false, state: 'idle' };
(function () {
  const T = window.T3;
  let readyRes;
  const readyP = new Promise(r => readyRes = r);
  R3.whenReady = () => readyP;
  R3.render = () => {};
  // タイトル画面の背景（Blender/Cyclesでレンダリングしたキービジュアル）
  {
    const url = (window.ASSET_DATA && window.ASSET_DATA['tex/title.jpg']) || ((window.ASSET_BASE || 'assets/') + 'tex/title.jpg');
    const ti = document.getElementById('title');
    if (ti) ti.style.background = 'linear-gradient(180deg,rgba(6,12,20,.62) 0%,rgba(6,12,20,.30) 42%,rgba(6,12,20,.86) 100%),url(' + url + ') center 65%/cover no-repeat,#15242f';
  }
  if (!T) { R3.state = 'failed'; readyRes(); return; }
  const THREE = T.THREE;
  G3.THREE = THREE; G3.T = T;
  G3.U = 2.5;
  const isTouch = ('ontouchstart' in window);
  const Q = G3.Q = {
    pr: isTouch ? 1.5 : 2, shadow: isTouch ? 2048 : 4096, shadowR: isTouch ? 150 : 230,
    trees: isTouch ? 0.55 : 1, bloom: true,
  };
  const glCv = document.getElementById('gl');

  /* ---------- アセット読み込み ---------- */
  const assetURL = p => (window.ASSET_DATA && window.ASSET_DATA[p]) || ((window.ASSET_BASE || 'assets/') + p);
  G3.assetURL = assetURL;
  const TEX_LIST = {
    // 名前: [ファイル, sRGBか]
    asphalt: ['tex/asphalt.jpg', 1], sidewalk: ['tex/sidewalk.jpg', 1], 
    grass: ['tex/grass.jpg', 1], soil: ['tex/soil.jpg', 1], paddy: ['tex/paddy.jpg', 1], sand: ['tex/sand.jpg', 1],
    concrete: ['tex/concrete.jpg', 1], gravel: ['tex/gravel.jpg', 1], kawara: ['tex/kawara.jpg', 1],
    stonewall: ['tex/stonewall.jpg', 1], plaster: ['tex/plaster.jpg', 1], water_n: ['tex/water_n.jpg', 0],
    detail: ['tex/detail.jpg', 0],
  };
  for (const f of ['office', 'glass', 'mansion', 'shop', 'house', 'hotel', 'gshop', 'goffice', 'ghouse', 'machiya', 'gmachiya', 'warehouse', 'gwarehouse', 'danchi']) {
    TEX_LIST['fac_' + f] = ['tex/fac_' + f + '.jpg', 1];
    TEX_LIST['facm_' + f] = ['tex/fac_' + f + '_m.png', 0];
  }
  const GLB_LIST = ['vehicles', 'human', 'trains', 'trees', 'props', 'street', 'landmarks', 'misc'];
  G3.tex = {}; G3.glb = {};

  function setLoad(frac, txt) {
    const bar = document.getElementById('loadbar');
    if (bar) bar.style.display = 'block';
    const f = document.getElementById('loadfill');
    if (f) f.style.width = Math.round(frac * 100) + '%';
    const t = document.getElementById('loadtxt');
    if (t && txt) t.textContent = txt;
  }
  G3.setLoad = setLoad;

  async function loadAssets() {
    const texLoader = new THREE.TextureLoader();
    const gl = new T.GLTFLoader();
    if (T.MeshoptDecoder) gl.setMeshoptDecoder(T.MeshoptDecoder);
    const keys = Object.keys(TEX_LIST);
    const total = keys.length + GLB_LIST.length;
    let done = 0;
    const tick = txt => setLoad(0.75 * (++done) / total, txt);
    const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    await Promise.all(keys.map(async k => {
      const [file, srgb] = TEX_LIST[k];
      try {
        const t = await texLoader.loadAsync(assetURL(file));
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        G3.tex[k] = t;
      } catch (e) { console.warn('tex missing', file); }
      tick('テクスチャ読み込み中…');
    }));
    for (const n of GLB_LIST) {
      try {
        G3.glb[n] = await gl.loadAsync(assetURL('glb/' + n + '.glb'));
      } catch (e) { console.warn('glb missing', n); G3.glb[n] = null; }
      tick('3Dモデル読み込み中…（' + n + '）');
    }
  }

  /* ---------- レンダラー ---------- */
  let renderer, scene, camera, composer, bloomPass, sky, sun, hemi, pmrem, skyScene, skyEnv, stars, rain, aoPass = null, gradePass = null;
  G3.sunDir = new THREE.Vector3(0, 1, 0);

  function initGL() {
    try {
      renderer = new THREE.WebGLRenderer({ canvas: glCv, antialias: true, powerPreference: 'high-performance' });
    } catch (e) { console.warn('WebGL unavailable', e); return false; }
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Q.pr));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.8, 22000);
    G3.renderer = renderer; G3.scene = scene; G3.camera = camera;

    // 空
    // 空（three.js Sky）。HDR出力が明るすぎるのでゲインを掛ける
    const tameSky = sk => {
      sk.material.uniforms.uSkyGain = { value: 0.42 };
      sk.material.fragmentShader = sk.material.fragmentShader
        .replace('uniform float time;', 'uniform float time;\nuniform float uSkyGain;')
        .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * uSkyGain, 1.0 );');
      sk.material.needsUpdate = true;
      return sk;
    };
    sky = tameSky(new T.Sky());
    sky.scale.setScalar(40000);
    scene.add(sky);
    skyScene = new THREE.Scene();
    G3.skyEnvSky = tameSky(new T.Sky());
    G3.skyEnvSky.scale.setScalar(1000);
    skyScene.add(G3.skyEnvSky);
    pmrem = new THREE.PMREMGenerator(renderer);

    // 光
    hemi = new THREE.HemisphereLight(0xbcd6f0, 0x6b5e4b, 1.0);
    scene.add(hemi);
    sun = new THREE.DirectionalLight(0xffffff, 3.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(Q.shadow, Q.shadow);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -Q.shadowR; sc.right = sc.top = Q.shadowR;
    sc.near = 10; sc.far = 3000;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.5;
    scene.add(sun); scene.add(sun.target);
    G3.sun = sun; G3.hemi = hemi;

    scene.fog = new THREE.Fog(0xc9d8e6, 900, 5200);

    // 星
    {
      const n = 1600, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const u = Math.random() * 2 - 1, a = Math.random() * TAU;
        const r = Math.sqrt(1 - u * u);
        pos[i * 3] = r * Math.cos(a) * 9000;
        pos[i * 3 + 1] = Math.abs(u) * 9000 + 300;
        pos[i * 3 + 2] = r * Math.sin(a) * 9000;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
      stars.renderOrder = -1;
      scene.add(stars);
    }
    // 雨
    {
      const n = 2200, pos = new Float32Array(n * 6);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      rain = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xc8d6e8, transparent: true, opacity: 0, depthWrite: false }));
      rain.frustumCulled = false;
      rain.userData.drops = Array.from({ length: n }, () => ({ x: (Math.random() - .5) * 220, y: Math.random() * 120, z: (Math.random() - .5) * 220, v: 160 + Math.random() * 60 }));
      scene.add(rain);
    }

    // ポストプロセス
    // ポストエフェクト経由でもMSAAが効くよう、マルチサンプルのレンダーターゲットを使う
    const rt = new THREE.WebGLRenderTarget(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio(),
      { type: THREE.HalfFloatType, samples: isTouch ? 2 : 4 });
    composer = new T.EffectComposer(renderer, rt);
    // 環境遮蔽（建物の足元・隅・軒下の陰影）。デスクトップのみ。シーンの描画も兼ねる
    if (!isTouch && T.N8AOPass) {
      const pw = innerWidth * renderer.getPixelRatio(), ph = innerHeight * renderer.getPixelRatio();
      aoPass = new T.N8AOPass(scene, camera, pw, ph);
      aoPass.autoDetectTransparency = false;
      aoPass.configuration.transparencyAware = false;
      aoPass.beautyRenderTarget.samples = 4;     // MSAA を維持
      Object.assign(aoPass.configuration, { aoRadius: 7, distanceFalloff: 2.0, intensity: 2.4, halfRes: true, depthAwareUpsampling: true,
        gammaCorrection: false, aoSamples: 12, denoiseSamples: 6, denoiseRadius: 10 });
      aoPass.configuration.color = new THREE.Color(0x0a0c12);
      composer.addPass(aoPass);
    } else composer.addPass(new T.RenderPass(scene, camera));
    bloomPass = new T.UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.35, 0.55, 0.88);
    composer.addPass(bloomPass);
    composer.addPass(new T.OutputPass());
    // 色調補正（彩度・コントラスト・明部を暖色/暗部を寒色に・ごく弱いフィルムグレイン）
    if (T.ShaderPass) {
      gradePass = new T.ShaderPass({
        uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uSat: { value: 1.1 }, uContrast: { value: 1.06 }, uWarm: { value: 1 }, uGrain: { value: 0.012 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uSat, uContrast, uWarm, uGrain; varying vec2 vUv;
          void main(){
            vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;
            float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(l), col, uSat);
            col = (col - 0.5) * uContrast + 0.5;
            col += (vec3(0.028, 0.012, -0.022) * smoothstep(0.5, 1.0, l) + vec3(-0.012, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.4, l))) * uWarm;
            float n = fract(sin(dot(vUv * vec2(12.9898, 78.233) + uTime, vec2(1.0))) * 43758.5453);
            col += (n - 0.5) * uGrain;
            gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
          }`,
      });
      composer.addPass(gradePass);
    }

    addEventListener('resize', onResize);
    initOrbit();
    return true;
  }

  function onResize() {
    if (!renderer) return;
    renderer.setSize(innerWidth, innerHeight, false);
    composer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }

  /* ---------- 環境（時刻・天候） ---------- */
  const COL = (h) => new THREE.Color(h);
  const C_DAY_SKY = COL(0xbcd6f0), C_NIGHT_SKY = COL(0x52628e), C_DAY_GND = COL(0x6b5e4b), C_NIGHT_GND = COL(0x2c2824);
  const C_FOG_DAY = COL(0xc6d6e4), C_FOG_DUSK = COL(0xe2b58f), C_FOG_NIGHT = COL(0x162036), C_FOG_RAIN = COL(0x7c8590);
  const C_SUN_HI = COL(0xfff4e2), C_SUN_LO = COL(0xffa060), C_MOON = COL(0x9db4ff);
  const tmpC = new THREE.Color();
  let envT = 0, envSunY = 9;
  G3.day = 1; G3.wet = 0;
  const DAYLEN = 960;

  function updEnv(dt) {
    const ph = (S.time / DAYLEN) % 1;   // 1日 = 16分
    NIGHT = Math.pow(.5 - .5 * Math.cos(ph * TAU), 1.4) * .58;
    const th = ph * TAU;
    const sy = Math.cos(th) * 0.9 - 0.05;
    const sh = Math.sqrt(Math.max(0, 1 - sy * sy));
    const sd = G3.sunDir.set(-Math.sin(th) * sh, sy, Math.cos(th) * sh).normalize();
    const day = G3.day = clamp((sy + 0.1) / 0.38, 0, 1);
    const dusk = clamp(1 - Math.abs(sy - 0.04) / 0.2, 0, 1);
    const cloud = S.cloudI, wet = S.rainI;
    G3.wet = lerp(G3.wet, wet, Math.min(1, dt * 0.2));

    // 空シェーダー
    const u = sky.material.uniforms;
    u.sunPosition.value.copy(sd);
    u.turbidity.value = 2.4 + 7 * cloud;
    u.rayleigh.value = 1.1 + 1.6 * dusk;
    u.mieCoefficient.value = 0.004 + 0.01 * cloud;
    u.mieDirectionalG.value = 0.8;
    u.cloudCoverage.value = 0.32 + 0.55 * cloud;
    u.cloudDensity.value = 0.45 + 0.45 * cloud;
    u.time.value += dt;
    // 太陽／月
    const target = sun.target.position;
    target.set(S.px, heightAt(S.px, S.py), S.py);
    if (day > 0.001) {
      sun.position.copy(target).addScaledVector(sd, 1600);
      tmpC.copy(C_SUN_LO).lerp(C_SUN_HI, clamp(sy / 0.35, 0, 1));
      sun.color.copy(tmpC);
      sun.intensity = 3.3 * day * (1 - 0.7 * cloud);
    } else {
      const md = new THREE.Vector3(sd.x * -0.6, Math.max(0.45, -sd.y), sd.z * -0.6).normalize();
      sun.position.copy(target).addScaledVector(md, 1600);
      sun.color.copy(C_MOON);
      sun.intensity = 0.32 * (1 - 0.8 * cloud);
    }
    // シャドウマップのテクセルにスナップ（揺らぎ防止）
    const tx = 2 * Q.shadowR / Q.shadow;
    sun.position.x = Math.round(sun.position.x / tx) * tx; sun.target.position.x = Math.round(target.x / tx) * tx;
    sun.position.z = Math.round(sun.position.z / tx) * tx; sun.target.position.z = Math.round(target.z / tx) * tx;
    hemi.color.copy(C_NIGHT_SKY).lerp(C_DAY_SKY, day);
    hemi.groundColor.copy(C_NIGHT_GND).lerp(C_DAY_GND, day);
    hemi.intensity = (0.42 + 0.8 * day) * (1 + 0.35 * cloud * day) + S.flash * 6;   // 夜も月明かりと街明かりで真っ暗にしない
    // 霧
    const fog = scene.fog;
    fog.color.copy(C_FOG_NIGHT).lerp(C_FOG_DAY, day);
    fog.color.lerp(C_FOG_DUSK, dusk * 0.55 * day);
    fog.color.lerp(C_FOG_RAIN, wet * 0.7 * Math.max(0.25, day));
    fog.near = lerp(900, 160, wet);
    fog.far = lerp(5400, 1700, wet) * (day > 0.05 ? 1 : 0.85);
    // 露出・ブルーム
    renderer.toneMappingExposure = 0.9 + 0.5 * (1 - day);
    // 昼は空全体が閾値を超えるのでブルームを切り、夕方〜夜だけ発光体を滲ませる
    bloomPass.enabled = day < 0.9;
    if (gradePass) {
      const u2 = gradePass.uniforms;
      u2.uTime.value = (u2.uTime.value + dt) % 100;
      u2.uSat.value = lerp(1.04, 1.12, day) * (1 - 0.18 * wet);
      u2.uWarm.value = (0.4 + 0.8 * dusk + 0.4 * day) * (1 - 0.6 * wet);
    }
    if (aoPass) { const ai = +(lerp(0.7, 2.4, day) * (1 - 0.3 * cloud)).toFixed(2); if (ai !== aoPass.configuration.intensity) aoPass.configuration.intensity = ai; }
    bloomPass.strength = 0.32 * (1 - day);
    bloomPass.threshold = lerp(1.15, 3.0, day);
    bloomPass.radius = 0.22;
    stars.material.opacity = clamp((0.1 - sy) / 0.25, 0, 1) * (1 - cloud);
    // 反射用の環境マップ（太陽が動いたら作り直す）
    envT -= dt;
    if (envT <= 0 && (Math.abs(sy - envSunY) > 0.025 || !skyEnv)) {
      envT = 1.5; envSunY = sy;
      const eu = G3.skyEnvSky.material.uniforms;
      for (const k of ['sunPosition', 'turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG', 'cloudCoverage', 'cloudDensity'])
        eu[k].value = u[k].value.clone ? u[k].value.clone() : u[k].value;
      eu.showSunDisc.value = 0;
      if (skyEnv) skyEnv.dispose();
      skyEnv = pmrem.fromScene(skyScene, 0, 1, 4000);
      scene.environment = skyEnv.texture;
      scene.environmentIntensity = 0.08 + 0.72 * day;
    }
    // 雨
    rain.material.opacity = S.rainI * 0.55;
    if (S.rainI > 0.02) {
      const pos = rain.geometry.attributes.position.array;
      const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
      const dr = rain.userData.drops;
      for (let i = 0; i < dr.length; i++) {
        const d = dr[i];
        d.y -= d.v * dt;
        if (d.y < -40) { d.y = 80 + Math.random() * 40; d.x = (Math.random() - .5) * 220; d.z = (Math.random() - .5) * 220; }
        const k = i * 6;
        pos[k] = cx + d.x; pos[k + 1] = cy + d.y; pos[k + 2] = cz + d.z;
        pos[k + 3] = cx + d.x - 0.8; pos[k + 4] = cy + d.y - 4.5; pos[k + 5] = cz + d.z;
      }
      rain.geometry.attributes.position.needsUpdate = true;
      rain.visible = true;
    } else rain.visible = false;
    if (G3.world && G3.world.updEnv) G3.world.updEnv(dt, day);
  }

  /* ---------- カメラ ---------- */
  const cam = { init: false, x: 0, y: 0, z: 0, lx: 0, ly: 0, lz: 0, orbit: 0, orbitHold: 0, fov: 58 };
  G3.cam = cam;
  function initOrbit() {
    let drag = false, lx = 0;
    const ov = document.getElementById('cv');
    ov.addEventListener('mousedown', e => { drag = true; lx = e.clientX; });
    addEventListener('mouseup', () => { drag = false; cam.orbitHold = 2.2; });
    addEventListener('mousemove', e => {
      if (!drag || !R3.ok) return;
      cam.orbit += (e.clientX - lx) * 0.0032;
      lx = e.clientX; cam.orbitHold = 2.2;
    });
  }
  function blockedCam(x, y) {
    if (x < 0 || y < 0 || x > W || y > H) return false;
    gridNear(bldGrid, x, y, _camQ);
    for (const b of _camQ) if (x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2) return true;
    return false;
  }
  const _camQ = [];
  function updCamera(dt) {
    const inCar = S.mode === 'car';
    const pc = S.pcar;
    const v = inCar ? Math.abs(pc.v) : 0;
    const gx = inCar ? pc.x : S.px, gy = inCar ? pc.y : S.py;
    const ph = heightAt(gx, gy);
    if (cam.orbitHold > 0) cam.orbitHold -= dt; else cam.orbit *= Math.exp(-dt * 0.9);
    const yaw = S.tpsYaw + cam.orbit;
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    let dist, hgt, lead, lookH;
    if (S.view === 'top') {
      dist = 60 + v * 0.22; hgt = 190 + v * 0.42; lead = 10 + v * 0.18; lookH = 0;
    } else if (inCar) {
      const big = pc.type === 'bus' ? 2.1 : pc.type === 'truck' ? 1.55 : pc.type === 'bike' ? 0.75 : 1;
      dist = 18 * big + v * 0.022; hgt = 6.2 * Math.sqrt(big) + v * 0.004; lead = 14 + v * 0.05; lookH = 3.0 * Math.sqrt(big);
    } else {
      dist = 13; hgt = 6.4; lead = 6; lookH = 3.8;
    }
    // 建物で遮られたらカメラを寄せる
    if (S.view !== 'top') {
      for (let t = 0.25; t <= 1.0001; t += 0.125) {
        const x = gx - fx * dist * t, y = gy - fz * dist * t;
        if (blockedCam(x, y)) { dist = Math.max(inCar ? 9 : 4, dist * (t - 0.14)); break; }
      }
    }
    const tx = gx - fx * dist, tz = gy - fz * dist;
    const ty = Math.max(ph + hgt, heightAt(tx, tz) + 2.5);
    const lx = gx + fx * lead, lz = gy + fz * lead, ly = ph + lookH;
    const k = cam.init ? 1 - Math.exp(-dt * (S.view === 'top' ? 3.5 : 5)) : 1;
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k; cam.z += (tz - cam.z) * k;
    cam.lx += (lx - cam.lx) * k; cam.ly += (ly - cam.ly) * k; cam.lz += (lz - cam.lz) * k;
    cam.init = true;
    const sh = S.shake * 0.12;
    camera.position.set(cam.x + (Math.random() - .5) * sh, cam.y + (Math.random() - .5) * sh, cam.z + (Math.random() - .5) * sh);
    camera.lookAt(cam.lx, cam.ly, cam.lz);
    const fovT = (S.view === 'top' ? 50 : 58) + v * 0.035;
    cam.fov += (fovT - cam.fov) * Math.min(1, dt * 3);
    if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    S.camRot = -(yaw + Math.PI / 2);   // ミニマップの回転と連動
  }

  /* ---------- 画面上オーバーレイ（2Dキャンバス） ---------- */
  const _v = new THREE.Vector3();
  function toScreen(x, h, y) {
    _v.set(x, h, y).project(camera);
    if (_v.z > 1) return null;
    return [(_v.x * .5 + .5) * cw, (-_v.y * .5 + .5) * ch, _v.z];
  }
  G3.toScreen = toScreen;
  function overlay() {
    const c = ctx;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cw, ch);
    // 歩行者のセリフ
    c.textAlign = 'center';
    for (const p of peds) {
      if (!p.say) continue;
      const d = hyp(p.x - camera.position.x, p.y - camera.position.z);
      if (d > 140) continue;
      const s = toScreen(p.x, heightAt(p.x, p.y) + 6.2, p.y);
      if (!s) continue;
      const fs = clamp(15 - d * 0.04, 10, 15);
      c.font = '700 ' + fs + 'px sans-serif';
      const w = c.measureText(p.say.txt).width + 14;
      c.fillStyle = 'rgba(255,255,255,.92)';
      c.beginPath(); c.roundRect(s[0] - w / 2, s[1] - fs - 8, w, fs + 10, 7); c.fill();
      c.beginPath(); c.moveTo(s[0] - 5, s[1] + 2); c.lineTo(s[0] + 5, s[1] + 2); c.lineTo(s[0], s[1] + 8); c.fill();
      c.fillStyle = '#1d2530'; c.fillText(p.say.txt, s[0], s[1] - 3);
    }
    // 目的地の方向・距離
    const mp = missionMarkerPos();
    if (mp) {
      const dist = Math.round(hyp(mp[0] - S.px, mp[1] - S.py) * 0.4);
      const s = toScreen(mp[0], heightAt(mp[0], mp[1]) + 30, mp[1]);
      const on = s && s[0] > 30 && s[0] < cw - 30 && s[1] > 60 && s[1] < ch - 30;
      if (on) {
        c.font = '800 13px sans-serif';
        c.fillStyle = S.active ? '#7fe0ff' : '#ffd34d';
        c.strokeStyle = 'rgba(0,0,0,.7)'; c.lineWidth = 3;
        c.strokeText(dist + 'm', s[0], s[1]); c.fillText(dist + 'm', s[0], s[1]);
      } else {
        const dx = mp[0] - S.px, dy = mp[1] - S.py;
        const yaw = S.tpsYaw + cam.orbit;
        const fwd = dx * Math.cos(yaw) + dy * Math.sin(yaw), lat = -dx * Math.sin(yaw) + dy * Math.cos(yaw);
        const a2 = Math.atan2(lat, fwd);
        const ex = cw / 2 + Math.sin(a2) * Math.min(cw * .38, 240), ey = ch * .46 - Math.cos(a2) * Math.min(ch * .3, 150);
        c.save(); c.translate(ex, ey); c.rotate(a2 - Math.PI / 2);
        c.fillStyle = S.active ? 'rgba(80,210,255,.92)' : 'rgba(255,211,77,.92)';
        c.beginPath(); c.moveTo(16, 0); c.lineTo(-9, -10); c.lineTo(-4, 0); c.lineTo(-9, 10); c.closePath(); c.fill();
        c.strokeStyle = 'rgba(0,0,0,.6)'; c.lineWidth = 1.5; c.stroke();
        c.restore();
        c.font = '800 12px sans-serif'; c.fillStyle = '#fff';
        c.fillText(dist + 'm', ex, ey + 24);
      }
    }
    if (S.flash > 0) { c.fillStyle = 'rgba(255,255,255,' + (S.flash * 0.55) + ')'; c.fillRect(0, 0, cw, ch); }
    if (S.dmgFlash > 0) { c.fillStyle = 'rgba(200,30,30,' + (S.dmgFlash * .3) + ')'; c.fillRect(0, 0, cw, ch); }
    if (!vigCv || vigCv.width !== cw) buildVig();
    if (vigCv.width > 0) c.drawImage(vigCv, 0, 0, cw, ch);
  }

  /* ---------- メイン ---------- */
  let lastFrame = 0;
  R3.render = function (dt, dtr) {
    if (!R3.ok) return;
    updEnv(dt);
    if (G3.dyn) G3.dyn.update(dt);
    updCamera(dtr || dt);
    if (G3.world && G3.world.update) G3.world.update(dt);
    composer.render();
    overlay();
    renderMinimap();
  };
  R3.camera = () => camera;

  async function boot() {
    R3.state = 'loading';
    if (!initGL()) { R3.state = 'failed'; readyRes(); return; }
    try {
      setLoad(0.02, 'アセット読み込み中…');
      await loadAssets();
      setLoad(0.8, '松山の街を組み立て中…');
      await new Promise(r => setTimeout(r, 30));
      G3.world.build();
      setLoad(0.93, '人と車を配置中…');
      await new Promise(r => setTimeout(r, 30));
      G3.dyn.build();
      updEnv(0.016);
      updCamera(1);
      renderer.compile(scene, camera);
      R3.ok = true; R3.state = 'ready';
      document.body.classList.add('webgl');
      setLoad(1, '準備完了');
      const btn = document.getElementById('btnStart');
      if (btn && !btn.disabled) btn.textContent = '松山へ GO！';
    } catch (e) {
      console.error('R3 build failed', e);
      R3.state = 'failed';
      setLoad(1, '3D描画を初期化できませんでした（簡易表示で起動します）');
    }
    readyRes();
  }
  R3.boot = boot;
  R3.ctx = () => ({ renderer, scene, camera, composer });
  setTimeout(boot, 50);
})();

/* 地形の高さ（丘）。2D側のHILLSと同じ楕円で、城山は頂部を平らにする。 */
const HILLS3 = HILLS.map(h => Object.assign({}, h, {
  H: h.castle ? 72 : Math.min(260, Math.max(28, Math.min(h.rx, h.ry) * 0.42)),
}));
/* 松山城の本丸: 石垣の上の平らな曲輪（歩ける面）と、正門前の登り坂。モデル(landmarks.py castle)の寸法に合わせる */
const CASTLE_DECK = (() => {
  const l = LMS.find(q => q.t === 'castle'), U = 2.5;
  return { x: l.x, y: l.y, x0: l.x - 71, x1: l.x + 71, y0: l.y + 2.5 - 53.5, y1: l.y + 2.5 + 53.5,
    top: 1.25 * U, rx: 13, ry0: l.y + 2.5 + 53.5 + 5, ry1: l.y + 2.5 + 53.5 + 22, base: 72 };
})();
function hillProfile(h, x, y) {
  const dx = (x - h.x) / h.rx, dy = (y - h.y) / h.ry;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r >= 1) return 0;
  if (h.castle) {
    let v = h.H;
    if (r >= 0.34) { const t = (r - 0.34) / 0.66; v = h.H * (0.5 + 0.5 * Math.cos(t * Math.PI)); }
    // 本丸の周り（石垣の外 20 単位）までは山頂と同じ高さに均す
    const c = CASTLE_DECK;
    const ox = Math.max(0, c.x0 - 20 - x, x - c.x1 - 20), oy = Math.max(0, c.y0 - 20 - y, y - c.y1 - 26);
    const dd = Math.hypot(ox, oy);
    const flat = dd < 60 ? h.H * (0.5 + 0.5 * Math.cos(dd / 60 * Math.PI)) : 0;
    return Math.max(v, flat);
  }
  return h.H * Math.pow(0.5 + 0.5 * Math.cos(r * Math.PI), 1.15);
}
function heightAt(x, y) {
  let m = 0;
  for (const h of HILLS3) {
    if (Math.abs(x - h.x) > h.rx || Math.abs(y - h.y) > h.ry) continue;
    const v = hillProfile(h, x, y);
    if (v > m) m = v;
  }
  const c = CASTLE_DECK;
  if (x > c.x0 && x < c.x1 && y > c.y0 && y < c.y1) return c.base + c.top;
  if (Math.abs(x - c.x) < c.rx && y >= c.y1 && y < c.ry1) return y < c.ry0 ? c.base + c.top : Math.max(m, c.base + c.top * (1 - (y - c.ry0) / (c.ry1 - c.ry0)));
  return m;
}
