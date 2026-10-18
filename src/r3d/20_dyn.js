'use strict';
/* =========================================================
   動くもの：車・バイク・歩行者・プレイヤー・電車・船・飛行機・
   みかん・ミッションマーカー・パーティクル・スキッド痕
   ========================================================= */
G3.dyn = (function () {
  const THREE = G3.THREE;
  const U = G3.U, SW = 7, CURB = 0.38;
  let scene;
  const carObjs = new Map();      // car → THREE.Object3D
  const carPool = {};             // type → [obj]
  const pedObjs = new Map();
  const pedPool = [];
  let player, playerMixer, playerActs, playerAct = null;
  let headSpot;
  const trainObjs = [];
  let ferry, plane, mikanIM, marker, markerRing, skidMesh, partSmoke, partFire;
  const WHEEL_R = { sedan: 0.33, kei: 0.29, taxi: 0.33, truck: 0.4, sports: 0.34, bus: 0.5, bike: 0.27, police: 0.33, minivan: 0.32, keitruck: 0.28, van: 0.32 };

  /* ---------- 乗り物 ---------- */
  function fallbackCar(type) {
    const t = CARTYPES[type];
    const g = new THREE.Group();
    const paint = new THREE.MeshStandardMaterial({ name: 'Paint', color: 0xcccccc, roughness: 0.3, metalness: 0.5 });
    const L = t.l / U, Wd = t.w / U;
    const body = new THREE.Mesh(new THREE.BoxGeometry(L, 0.7, Wd), paint);
    body.position.y = 0.7;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.5, 0.55, Wd * 0.85), new THREE.MeshStandardMaterial({ color: 0x2c4353, roughness: 0.1 }));
    cab.position.set(-L * 0.05, 1.3, 0);
    g.add(body, cab);
    return g;
  }
  // 車種ごとに一度だけ部品をまとめた「ひな形」を作り、以後は複製する（形状は共有。走行中に結合処理をしない）
  const carTemplates = {};
  /* ナンバープレート（日本の様式。自家用=白地緑字、軽=黄地黒字、事業用=緑地白字、軽の事業用=黒地黄字。地名は「愛媛」）
     1枚のアトラス（スタイル4×8枚）。車ごとにどれかの1枚を貼る */
  const PLATE_STYLES = [['#f4f4ee', '#1e6a3a'], ['#f2d23a', '#1a1a1a'], ['#1e6a3a', '#f4f4ee'], ['#1a1a1a', '#f2d23a']];
  let plateTex = null;
  const plateMats = [];
  function plateAtlas() {
    if (plateTex) return plateTex;
    const CW = 256, CH = 128;
    const HIRA = 'あいうえさすせそたちつてとなにぬねのはひふほまみむめもやゆよらりるろ', BIZ = 'かきくけこを';
    const rp = mulberry32(6601);
    const cv = document.createElement('canvas'); cv.width = CW * 8; cv.height = CH * 4;
    const g = cv.getContext('2d');
    const F = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic",sans-serif';
    PLATE_STYLES.forEach(([bg, fg], si) => {
      for (let k = 0; k < 8; k++) {
        const x = k * CW, y = si * CH;
        g.fillStyle = bg; g.fillRect(x, y, CW, CH);
        g.strokeStyle = fg; g.lineWidth = 4; g.strokeRect(x + 5, y + 5, CW - 10, CH - 10);
        const cls = si === 1 || si === 3 ? ['580', '581', '583'][k % 3] : si === 2 ? ['500', '100', '200'][k % 3] : ['500', '530', '300', '501'][k % 4];
        g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'center';
        g.font = `700 30px ${F}`; g.fillText('愛媛 ' + cls, x + CW / 2, y + 30);
        const kana = (si >= 2 ? BIZ : HIRA)[(rp() * (si >= 2 ? BIZ.length : HIRA.length)) | 0];
        g.font = `700 28px ${F}`; g.fillText(kana, x + 30, y + 90);
        // 一連番号: 4桁は「12-34」、3桁以下は頭を「・」で埋める（・・42）
        const num = (rp() * 9999 + 1) | 0, s4 = String(num);
        const txt = num >= 1000 ? s4.slice(0, 2) + '-' + s4.slice(2) : s4.padStart(4, '・');
        g.font = `800 52px ${F}`; g.fillText(txt, x + CW / 2 + 26, y + 87);
      }
    });
    plateTex = new THREE.CanvasTexture(cv);
    plateTex.colorSpace = THREE.SRGBColorSpace;
    plateTex.anisotropy = 4;
    for (let si = 0; si < 4; si++) for (let k = 0; k < 8; k++) {
      const t = plateTex.clone();
      t.repeat.set(1 / 8, 1 / 4); t.offset.set(k / 8, 1 - (si + 1) / 4);
      t.needsUpdate = true;
      plateMats.push(new THREE.MeshStandardMaterial({ name: 'PlateTex', map: t, roughness: 0.45, metalness: 0.1 }));
    }
    return plateTex;
  }
  const PLATE_KIND = { kei: 1, keitruck: 3, taxi: 2, bus: 2, truck: 2 };
  // ひな形のナンバー（白い板＋緑の帯）を、外向きの面に貼る薄い板（テクスチャ付き）に置き換える
  function plateQuads(t) {
    t.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(t.matrixWorld).invert();
    const rm = [], add = [];
    t.traverse(m => {
      if (!m.isMesh) return;
      const n = (Array.isArray(m.material) ? m.material[0] : m.material).name || '';
      if (/^PlateText/.test(n)) { rm.push(m); return; }
      if (!/^Plate/.test(n)) return;
      // 前後のナンバーが1つの部品にまとまっていることがあるので、前（x>0）と後ろで分けて箱を求める
      const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), pos = m.geometry.attributes.position, v = new THREE.Vector3();
      const bbs = [new THREE.Box3(), new THREE.Box3()];
      for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(M); bbs[v.x > 0 ? 0 : 1].expandByPoint(v); }
      bbs.forEach((bb, k) => {
        if (bb.isEmpty()) return;
        const front = k === 0;
        const pg = new THREE.PlaneGeometry(bb.max.z - bb.min.z, bb.max.y - bb.min.y);
        pg.rotateY(front ? Math.PI / 2 : -Math.PI / 2);
        pg.translate(front ? bb.max.x + 0.004 : bb.min.x - 0.004, (bb.min.y + bb.max.y) / 2, (bb.min.z + bb.max.z) / 2);
        add.push(pg);
      });
      rm.push(m);
    });
    for (const m of rm) m.parent.remove(m);
    if (!add.length) return;
    const geo = add.length > 1 ? G3.T.mergeGeometries(add, false) : add[0];
    const pm = new THREE.Mesh(geo, plateMats[0] || new THREE.MeshStandardMaterial({ name: 'PlateTex', color: 0xf4f4ee }));
    pm.name = 'plate_quads';
    t.add(pm);
  }
  function carTemplate(type) {
    if (carTemplates[type]) return carTemplates[type];
    const node = G3.glbNode('vehicles', type);
    const t = node ? node.clone(true) : fallbackCar(type);
    plateAtlas();
    plateQuads(t);
    compactCar(t);
    // 窓ガラスは少し透かす（中の運転手が見える）
    t.traverse(m => { if (m.isMesh && !Array.isArray(m.material) && /^Glass/.test(m.material.name || '') && !m.material.transparent) { m.material.transparent = true; m.material.opacity = 0.62; } });
    return (carTemplates[type] = t);
  }
  /* 運転手: 歩行者の人形を座った姿勢で一度だけ固めた形（部位の色は歩行者と同じユニフォーム）。日本の車は右ハンドル */
  let drvGeo;
  function driverGeometry() {
    if (drvGeo !== undefined) return drvGeo;
    drvGeo = null;
    const src = G3.glb.human;
    if (!src || !pedGeometry(src)) return null;
    const o = makeHuman(false);
    let body = null;
    o.traverse(c => { if (c.isSkinnedMesh) body = c; });
    const act = o.userData.acts.sit;
    if (!body || !act) { scene.remove(o); return null; }
    act.play(); o.userData.mixer.update(0.4);
    o.position.set(0, 0, 0); o.rotation.set(0, 0, 0); o.scale.setScalar(1);
    o.updateMatrixWorld(true);
    const g = pedGeo.clone(), pos = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      body.applyBoneTransform(i, v);
      v.applyMatrix4(body.matrixWorld);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    g.deleteAttribute('skinIndex'); g.deleteAttribute('skinWeight');
    g.computeVertexNormals(); g.computeBoundingSphere();
    // 頭の中心（肌の頂点のうち上の方）
    let top = -1e9; for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
    const part = g.attributes.part, h = new THREE.Vector3(); let n = 0;
    for (let i = 0; i < pos.count; i++) if (part.getX(i) === 3 && pos.getY(i) > top - 0.26) { h.x += pos.getX(i); h.y += pos.getY(i); h.z += pos.getZ(i); n++; }
    if (n) h.multiplyScalar(1 / n);
    g.userData.head = h;
    scene.remove(o);
    act.stop();
    return (drvGeo = g);
  }
  // 運転席の頭の位置（車のモデル座標 m）: 前ガラスの下端から少し後ろ・窓の高さの中ほど・右側
  const carSeat = {};
  function seatOf(type) {
    if (carSeat[type] !== undefined) return carSeat[type];
    const node = G3.glbNode('vehicles', type);
    if (!node || type === 'bike') return (carSeat[type] = null);
    node.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), gb = new THREE.Box3();
    node.traverse(c => { if (c.isMesh && /^Glass/.test(c.material.name)) { const b = new THREE.Box3().setFromObject(c); b.applyMatrix4(inv); gb.union(b); } });
    if (gb.isEmpty()) return (carSeat[type] = null);
    const x = Math.max(gb.min.x + 0.3, gb.max.x - 1.15), y = type === 'bus' ? 2.1 : gb.min.y + (gb.max.y - gb.min.y) * 0.5, z = gb.max.z * 0.42;
    return (carSeat[type] = new THREE.Vector3(x, y, z));
  }
  const DRV_SHIRT = ['#e8e8e4', '#3a4a6a', '#2a2c30', '#7a8a9a', '#c8b8a0', '#5a6a4a', '#d8d4c8', '#344050'];
  function makeCar(type) {
    const o = carTemplate(type).clone(true);
    o.scale.setScalar(U);
    const ud = o.userData = { type, wheels: [], paint: [], tail: [], head: [], siren: [], andon: [], rider: null, pitch: 0, roll: 0, prevV: 0, prevA: 0, spin: 0 };
    o.traverse(c => {
      if (c.isMesh) {
        c.castShadow = !/^wheel_/.test(c.parent && c.parent.name);   // ホイールの影は車体の影に含まれるので省く
        c.receiveShadow = true;
        if (c.name === 'car_lights') { c.material = lightMat(c.material.userData.emC); ud.lightI = c.material.userData.I; return; }
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        const nm = mats.map(m => {
          const n = m.name || '';
          if (/^(Paint|TailLight|HeadLight|Siren|Andon)/.test(n)) {
            const cl = m.clone();
            if (n.startsWith('Paint')) ud.paint.push(cl);
            else if (n.startsWith('TailLight')) ud.tail.push(cl);
            else if (n.startsWith('HeadLight')) ud.head.push(cl);
            else if (n.startsWith('Siren')) ud.siren.push(cl);
            else if (n.startsWith('Andon')) ud.andon.push(cl);
            return cl;
          }
          return m;
        });
        c.material = Array.isArray(c.material) ? nm : nm[0];
      }
      if (/^wheel_/.test(c.name)) ud.wheels.push({ o: c, front: /F/.test(c.name.slice(6)) });
      if (c.name === 'plate_quads' && plateMats.length) { c.material = plateMats[(PLATE_KIND[type] || 0) * 8 + ((Math.random() * 8) | 0)]; ud.plate = c; }
    });
    // 車体下の接地影
    {
      const t = CARTYPES[type];
      const bg = new THREE.PlaneGeometry(t.l / U + 0.5, t.w / U + 0.35);
      bg.rotateX(-Math.PI / 2);
      if (!G3._carBlobMat) G3._carBlobMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: G3.radialTex(), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -65 });
      const blob = new THREE.Mesh(bg, G3._carBlobMat);
      blob.position.y = 0.03;
      blob.renderOrder = 1;
      o.add(blob);
    }
    const seat = seatOf(type), dg = seat && driverGeometry();
    if (dg) {
      const dm = new THREE.Mesh(dg, pedMaterial());
      dm.position.copy(seat).sub(dg.userData.head);
      dm.castShadow = false; dm.receiveShadow = false; dm.visible = false;
      const cols = dm.material.userData.cols, sk = ['#e8c8a0', '#f0d4b0', '#d8b088', '#c89870'];
      cols[0].set(DRV_SHIRT[(Math.random() * DRV_SHIRT.length) | 0]); cols[1].set('#2e3440'); cols[2].set('#2a2522');
      cols[3].set(sk[(Math.random() * 4) | 0]); cols[4].set('#151515'); cols[5].set(['#2c2620', '#141414', '#4a3826', '#6e6258'][(Math.random() * 4) | 0]);
      if (type === 'taxi' || type === 'bus' || type === 'police') cols[0].set(type === 'police' ? '#2c3e66' : type === 'bus' ? '#4a5a78' : '#f0f0ec');   // 制服
      o.add(dm);
      ud.driver = dm;
    }
    if (type === 'bike') {
      // 乗り手（座り姿勢）
      ud.rider = makeHuman(true);
      ud.rider.position.set(-0.42, 0.02, 0);
      ud.rider.scale.setScalar(1 / U * U);   // モデル空間（m）のまま
      o.add(ud.rider);
    }
    scene.add(o);
    return o;
  }
  // 単色の部品（黒・クロム・タイヤ・ホイール等）を車体／各ホイールごとに頂点カラーの1枚へまとめる（金属っぽさ・粗さは頂点ごと）。
  // 灯火（ヘッド・テール・ウインカー）も1枚にまとめ、光の強さは車ごとのユニフォームで変える。塗装（クリアコート）・ガラスは別のまま
  let carMixMat = null;
  function mixMat() {
    if (carMixMat) return carMixMat;
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1 });
    m.name = 'CarMix';
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 mr;\nvarying vec2 vMR;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMR = mr;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vMR;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vMR.y;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vMR.x;');
    };
    m.customProgramCacheKey = () => 'car-mix-1';
    return (carMixMat = m);
  }
  const LIGHT_KINDS = ['HeadLight', 'TailLight', 'Amber'];
  // 車ごとの灯火マテリアル（I = ヘッド・テール・ウインカーの発光の強さ）
  function lightMat(emC) {
    const I = new THREE.Vector3(0.2, 0.05, 1);
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.15, metalness: 0.1 });
    m.name = 'CarLights';
    m.onBeforeCompile = sh => {
      sh.uniforms.uEmC = { value: emC }; sh.uniforms.uEmI = { value: I };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float lt;\nvarying float vLt;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLt = lt;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uEmC[3];\nuniform vec3 uEmI;\nvarying float vLt;')
        .replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vLt < 0.5 ? uEmC[0] * uEmI.x : vLt < 1.5 ? uEmC[1] * uEmI.y : uEmC[2] * uEmI.z;');
    };
    m.customProgramCacheKey = () => 'car-lights-1';
    m.userData.I = I; m.userData.emC = emC;
    return m;
  }
  function compactCar(o) {
    o.updateMatrixWorld(true);
    const special = m => !m || /^(Paint|Glass|HeadLight|TailLight|Amber|Siren|Andon|Window)/.test(m.name || '') || m.transparent || m.map ||
      (m.emissive && m.emissive.getHex() !== 0);
    // 部品を host（車体かホイール）の座標へ移し、色と（金属・粗さ）を頂点に焼く
    const bake = (m, host, extra) => {
      const inv = new THREE.Matrix4().copy(host.matrixWorld).invert();
      let g = m.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      if (g.index) g = g.toNonIndexed();
      for (const k2 of Object.keys(g.attributes)) if (k2 !== 'position' && k2 !== 'normal') g.deleteAttribute(k2);
      const c = m.material.color || new THREE.Color(1, 1, 1), n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      for (const [nm, sz, val] of extra) {
        const a = new Float32Array(n * sz);
        for (let i = 0; i < n; i++) for (let k = 0; k < sz; k++) a[i * sz + k] = val[k];
        g.setAttribute(nm, new THREE.BufferAttribute(a, sz));
      }
      return g;
    };
    const hosts = new Map();
    const list = [];
    o.traverse(m => { if (m.isMesh && !m.isSkinnedMesh && !Array.isArray(m.material) && !special(m.material)) list.push(m); });
    for (const m of list) {
      let host = m.parent;
      for (let p = m.parent; p && p !== o; p = p.parent) if (/^wheel_/.test(p.name)) { host = p; break; }
      if (!host || host === m) host = o;
      const mt = m.material, met = (mt.metalness || 0) > 0.5 ? Math.max(0.8, mt.metalness) : Math.min(0.05, mt.metalness || 0);
      if (!hosts.has(host)) hosts.set(host, []);
      hosts.get(host).push(bake(m, host, [['mr', 2, [met, mt.roughness == null ? 0.6 : mt.roughness]]]));
      m.parent.remove(m);
    }
    for (const [host, gs] of hosts) {
      const geo = G3.T.mergeGeometries(gs, false);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, mixMat());
      mesh.castShadow = true; mesh.receiveShadow = true;
      host.add(mesh);
    }
    // 灯火を1枚に
    const lights = [], emC = [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)];
    o.traverse(m => {
      if (!m.isMesh || Array.isArray(m.material)) return;
      const k = LIGHT_KINDS.findIndex(nm => (m.material.name || '').startsWith(nm));
      if (k >= 0) lights.push([m, k]);
    });
    if (lights.length) {
      const gs = lights.map(([m, k]) => { if (m.material.emissive) emC[k].copy(m.material.emissive); return bake(m, o, [['lt', 1, [k]]]); });
      for (const [m] of lights) m.parent.remove(m);
      const geo = G3.T.mergeGeometries(gs, false);
      if (geo) {
        const mesh = new THREE.Mesh(geo, lightMat(emC));
        mesh.name = 'car_lights'; mesh.userData.emC = emC;
        o.add(mesh);
      }
    }
  }
  function acquireCar(car, police) {
    const type = police ? 'police' : car.type;
    let o = carObjs.get(car);
    if (o && o.userData.type === type) return o;
    const pool = carPool[type] || (carPool[type] = []);
    o = pool.pop() || makeCar(type);
    o.visible = true;
    o.userData.color = null;
    carObjs.set(car, o);
    return o;
  }
  function releaseCar(car, o) {
    o.visible = false;
    restoreCar(o);
    carObjs.delete(car);
    (carPool[o.userData.type] || (carPool[o.userData.type] = [])).push(o);
  }
  function groundY(x, y) {
    const h = heightAt(x, y);
    return h;
  }
  function placeCar(car, police, dt, isPlayer) {
    const o = acquireCar(car, police);
    const ud = o.userData;
    if (ud.color !== car.color && !police) {
      for (const m of ud.paint) m.color.set(car.color);
      ud.color = car.color;
    }
    const y = groundY(car.x, car.y) + 0.06;
    // 加速・旋回による車体の傾き（ピッチ・ロール）
    const acc = (car.v - ud.prevV) / Math.max(dt, 1e-3);
    let da = car.a - ud.prevA; if (da > Math.PI) da -= TAU; if (da < -Math.PI) da += TAU;
    const yawRate = da / Math.max(dt, 1e-3);
    ud.prevV = car.v; ud.prevA = car.a;
    const k = 1 - Math.exp(-dt * 6);
    ud.pitch += (clamp(-acc * 0.00012, -0.035, 0.035) - ud.pitch) * k;
    ud.roll += (clamp(yawRate * Math.abs(car.v) * 0.00004, -0.05, 0.05) - ud.roll) * k;
    o.position.set(car.x, y, car.y);
    o.rotation.set(0, 0, 0);
    o.rotateY(-car.a);
    o.rotateZ(ud.pitch);
    o.rotateX(ud.roll);
    // ホイール回転・前輪の操舵
    const r = WHEEL_R[ud.type] || 0.33;
    ud.spin -= car.v * VK * dt / (r * U);
    const steer = isPlayer ? clamp(-(inputVec().x) * 0.45, -0.45, 0.45) : clamp(-yawRate * 0.25, -0.4, 0.4);
    // 遠くの車はホイールとナンバーを省く（画面上で数画素。描画回数を減らす）
    const cdx = car.x - G3.camera.position.x, cdz = car.y - G3.camera.position.z, far = cdx * cdx + cdz * cdz > 450 * 450 && !isPlayer;
    if (ud.far !== far) { ud.far = far; for (const w of ud.wheels) w.o.visible = !far; if (ud.plate) ud.plate.visible = !far; }
    // 運転手は走っている車（通行車・パトカー・自分の車）にだけ。遠くは省く
    if (ud.driver) {
      const drive = (isPlayer || police || !!car.road) && cdx * cdx + cdz * cdz < 320 * 320;
      ud.driver.visible = drive;
      if (drive && isPlayer && !ud.pDressed) { const c = ud.driver.material.userData.cols; c[0].set('#2e6e46'); c[1].set('#33404e'); ud.pDressed = true; }
      else if (!isPlayer && ud.pDressed) { const c = ud.driver.material.userData.cols; c[0].set(DRV_SHIRT[(Math.random() * DRV_SHIRT.length) | 0]); c[1].set('#2e3440'); ud.pDressed = false; }
    }
    if (!far) for (const w of ud.wheels) {
      w.o.rotation.set(0, w.front ? steer : 0, ud.spin, 'YXZ');
      w.o.rotation.order = 'YXZ';
    }
    // ライト
    const night = 1 - G3.day;
    const brake = !!car.brakeL;
    if (ud.lightI) ud.lightI.set(ud.headBroken ? 0 : night * 6 + 0.2, brake ? 6 : night * 1.6 + 0.05, 1);
    for (const m of ud.tail) m.emissiveIntensity = brake ? 6 : night * 1.6 + 0.05;
    for (const m of ud.head) m.emissiveIntensity = ud.headBroken ? 0 : night * 6 + 0.2;
    // 夜は路面にヘッドライトの光を落とす（プレイヤー車はスポットライトがあるので除く）
    if (!isPlayer && night > 0.15 && !ud.headBroken) {
      if (!ud.beam) {
        if (!G3._beamMat) G3._beamMat = new THREE.MeshBasicMaterial({ map: G3.radialTex(), color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -85 });
        const t = CARTYPES[ud.type] || CARTYPES.sedan;
        const g = new THREE.PlaneGeometry(9 / U * 1.6, t.w / U * 1.9);
        g.rotateX(-Math.PI / 2);
        ud.beam = new THREE.Mesh(g, G3._beamMat);
        ud.beam.position.set(t.l / U * 0.5 + 9 / U * 0.8, 0.05, 0);
        ud.beam.renderOrder = 2;
        o.add(ud.beam);
      }
      ud.beam.visible = true;
      G3._beamMat.opacity = night * 0.5;
    } else if (ud.beam) ud.beam.visible = false;
    for (const m of ud.andon) m.emissiveIntensity = night * 2.5 + 0.3;
    if (ud.siren.length) {
      const fl = Math.floor(tSec * 6) % 2;
      ud.siren.forEach((m, i) => m.emissiveIntensity = (S.stars > 0 || police) && ((i % 2) === fl) ? 9 : 0.1);
    }
    if (ud.rider) {
      ud.rider.visible = true;
      tickHuman(ud.rider, 'sit', 1, dt);
    }
    return o;
  }

  /* ---------- 車のへこみ・ガラスのひび（その車だけ形状を複製して変形） ---------- */
  const _inv = new THREE.Matrix4(), _rel = new THREE.Matrix4(), _relInv = new THREE.Matrix4(), _v3 = new THREE.Vector3();
  let crackMat = null;
  function dent(car, wx, wy, power) {
    const o = carObjs.get(car);
    if (!o) return;
    const ud = o.userData;
    if (ud.lastDent && tSec - ud.lastDent < 0.35) return;
    ud.lastDent = tSec;
    const dx = wx - car.x, dy = wy - car.y;
    const lx = (dx * Math.cos(car.a) + dy * Math.sin(car.a)) / U;
    const lz = (-dx * Math.sin(car.a) + dy * Math.cos(car.a)) / U;
    const depth = Math.min(0.24, power / 1300), R = 0.85 + Math.min(0.6, power / 450);
    o.updateMatrixWorld(true);
    _inv.copy(o.matrixWorld).invert();
    if (!ud.dentOrig) ud.dentOrig = new Map();
    o.traverse(m => {
      if (!m.isMesh || m.isSkinnedMesh) return;
      for (let p = m; p && p !== o; p = p.parent) if (/^wheel_/.test(p.name)) return;
      if (m.material && m.material.transparent) return;
      if (!ud.dentOrig.has(m)) { ud.dentOrig.set(m, m.geometry); m.geometry = m.geometry.clone(); }
      const pos = m.geometry.attributes.position;
      _rel.multiplyMatrices(_inv, m.matrixWorld);
      _relInv.copy(_rel).invert();
      let changed = false;
      for (let i = 0; i < pos.count; i++) {
        _v3.fromBufferAttribute(pos, i).applyMatrix4(_rel);
        const ex = _v3.x - lx, ez = _v3.z - lz, ey = _v3.y - 0.65;
        const dist = Math.sqrt(ex * ex + ez * ez + ey * ey * 0.6);
        if (dist > R) continue;
        const f = 1 - dist / R, k = depth * f * f;
        const cl = Math.hypot(_v3.x, _v3.z) || 1;
        _v3.x -= _v3.x / cl * k; _v3.z -= _v3.z / cl * k; _v3.y -= k * 0.3;
        _v3.applyMatrix4(_relInv);
        pos.setXYZ(i, _v3.x, _v3.y, _v3.z);
        changed = true;
      }
      if (changed) { pos.needsUpdate = true; m.geometry.computeVertexNormals(); m.geometry.computeBoundingSphere(); }
    });
    // 強い衝突: ガラスにひび、前からならヘッドライトが割れる
    if (power > 170) {
      if (!crackMat) crackMat = new THREE.MeshStandardMaterial({ color: 0xaab6bc, roughness: 0.55, metalness: 0.2, transparent: true, opacity: 0.85 });
      if (!ud.crackOrig) ud.crackOrig = new Map();
      o.traverse(m => {
        if (!m.isMesh) return;
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        if (!mats.some(x => x && /^Glass/.test(x.name))) return;
        if (!ud.crackOrig.has(m)) ud.crackOrig.set(m, m.material);
        m.material = Array.isArray(m.material) ? mats.map(x => /^Glass/.test(x.name) ? crackMat : x) : crackMat;
      });
      if (lx > 0.8) ud.headBroken = true;
    }
  }
  function restoreCar(o) {
    const ud = o.userData;
    if (ud.dentOrig) { for (const [m, g] of ud.dentOrig) { m.geometry.dispose(); m.geometry = g; } ud.dentOrig = null; }
    if (ud.crackOrig) { for (const [m, mt] of ud.crackOrig) m.material = mt; ud.crackOrig = null; }
    ud.headBroken = false;
  }

  /* ---------- 人物 ---------- */
  const SHIRTS = ['#d9d4c8', '#c8b8d8', '#a8c8b8', '#d8a8a8', '#b8c8e0', '#e8d8b0', '#98a8b8', '#d0d4d8', '#c05848', '#3d4f6a', '#556b3e', '#efefea'];
  function fallbackHuman() {
    const g = new THREE.Group();
    const mk = (geo, col, y, nm) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ name: nm, color: col, roughness: 0.8 })); m.position.y = y; g.add(m); return m; };
    mk(new THREE.CapsuleGeometry(0.17, 0.55, 4, 8), 0x3c4250, 0.55, 'Pants');
    mk(new THREE.CapsuleGeometry(0.2, 0.35, 4, 8), 0xd9d4c8, 1.2, 'Shirt');
    mk(new THREE.SphereGeometry(0.12, 12, 8), 0xe8c8a0, 1.62, 'Skin');
    return g;
  }
  // 歩行者は 6 部位（服・ズボン・靴・肌・目・髪）を1つのスキンメッシュにまとめて1回で描く（部位の色はユニフォーム）。
  // 6 部位は同じ骨格・同じバインド行列を共有している（human.glb の Body の各プリミティブ）
  const PED_PARTS = ['Shirt', 'Pants', 'Shoes', 'Skin', 'Eye', 'Hair'];
  let pedGeo;
  function pedGeometry(src) {
    if (pedGeo !== undefined) return pedGeo;
    const gs = [];
    src.scene.traverse(c => {
      const k = c.isSkinnedMesh ? PED_PARTS.indexOf(c.material.name) : -1;
      if (k < 0) return;
      const g = c.geometry.clone();
      g.setAttribute('part', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(k), 1));
      gs[k] = g;
    });
    pedGeo = gs.filter(Boolean).length === PED_PARTS.length ? G3.T.mergeGeometries(gs, false) : null;
    if (pedGeo) { pedGeo.computeBoundingSphere(); pedGeo.boundingSphere.radius *= 1.6; }   // 歩く・走る・倒れる姿勢の分だけ大きめに
    return pedGeo;
  }
  function pedMaterial() {
    const cols = PED_PARTS.map(() => new THREE.Color(1, 1, 1));
    const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    m.name = 'PedMerged';
    m.onBeforeCompile = sh => {
      sh.uniforms.uPart = { value: cols };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float part;\nvarying float vPart;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPart = part;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uPart[6];\nvarying float vPart;')
        .replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'int pedPart = int(vPart + 0.5);\nvec4 diffuseColor = vec4( uPart[pedPart], opacity );')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = pedPart == 4 ? 0.2 : pedPart == 2 ? 0.5 : pedPart == 5 ? 0.55 : pedPart == 3 ? 0.6 : 0.85;');
    };
    m.customProgramCacheKey = () => 'ped-merged-1';
    m.userData.cols = cols;
    return m;
  }
  function makeHuman(isRider, isPlayer) {
    const src = G3.glb.human;
    let o;
    if (src) o = G3.T.SkeletonUtils.clone(src.scene);
    else o = fallbackHuman();
    const ud = o.userData = { mats: {}, mixer: null, acts: {}, cur: null };
    const merged = src && !isRider && !isPlayer && pedGeometry(src);
    if (merged) {
      let body = null;
      const rm = [];
      o.traverse(c => { if (c.isSkinnedMesh) { if (!body && PED_PARTS.includes(c.material.name)) body = c; else rm.push(c); } });
      for (const c of rm) c.parent.remove(c);
      body.geometry = merged;
      body.material = pedMaterial();
      body.boundingSphere = merged.boundingSphere.clone();   // 画面外の人は描かない
      body.castShadow = true; body.receiveShadow = true;
      ud.pedCols = body.material.userData.cols;
    } else o.traverse(c => {
      if (c.isMesh || c.isSkinnedMesh) {
        c.castShadow = true; c.receiveShadow = true;
        c.frustumCulled = false;
        const m = c.material.clone();
        c.material = m;
        ud.mats[m.name] = m;
      }
      if (c.name === 'Cap') c.visible = !!isPlayer;
    });
    if (src && src.animations.length) {
      ud.mixer = new THREE.AnimationMixer(o);
      for (const clip of src.animations) ud.acts[clip.name] = ud.mixer.clipAction(clip);
    }
    if (!isRider) { o.scale.setScalar(U); scene.add(o); }
    if (!isRider && !isPlayer) {
      // 雨の日に差す傘（体に付けておき、雨の時だけ見せる）
      // 傘の布と柄は1枚に（柄は頂点カラーで暗く）
      if (!G3._umbMats) G3._umbMats = ['#2a3e8a', '#c8302a', '#f2f2ee', '#3a8a5a', '#151619', '#e8a020'].map(c => new THREE.MeshStandardMaterial({ color: c, vertexColors: true, roughness: 0.5, side: THREE.DoubleSide, transparent: c === '#f2f2ee', opacity: c === '#f2f2ee' ? 0.6 : 1 }));
      if (!G3._umbGeo) {
        const cone = new THREE.ConeGeometry(0.56, 0.26, 10, 1, true); cone.translate(0.1, 2.02, 0.04);
        const stick = new THREE.CylinderGeometry(0.012, 0.012, 0.75, 5); stick.translate(0.1, 1.6, 0.04);
        for (const [g, v] of [[cone, 1], [stick, 0.12]]) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(v), 3));
        G3._umbGeo = G3.T.mergeGeometries([cone, stick], false);
      }
      const u = new THREE.Mesh(G3._umbGeo, G3._umbMats[(Math.random() * G3._umbMats.length) | 0]);
      u.castShadow = true; u.visible = false;
      o.add(u);
      o.userData.umb = u;
    }
    return o;
  }
  function dressHuman(o, p) {
    const pc = o.userData.pedCols;
    if (pc) {
      pc[0].set(p.c); pc[1].set(p.pc || '#3c4250'); pc[2].set('#2a2522'); pc[3].set(p.sk || '#e8c8a0'); pc[4].set('#151515'); pc[5].set(p.hc || '#2c2620');
      return;
    }
    const m = o.userData.mats;
    if (m.Shirt) m.Shirt.color.set(p.c);
    if (m.Pants) m.Pants.color.set(p.pc || '#3c4250');
    if (m.Hair) m.Hair.color.set(p.hc || '#2c2620');
    if (m.Skin) m.Skin.color.set(p.sk || '#e8c8a0');
  }
  function tickHuman(o, act, speed, dt) {
    const ud = o.userData;
    if (!ud.mixer) {
      // フォールバック：上下の揺れのみ
      return;
    }
    const a = ud.acts[act] || ud.acts.walk;
    if (ud.cur !== a) {
      a.reset().play();
      if (ud.cur) a.crossFadeFrom(ud.cur, 0.25, false);
      ud.cur = a;
    }
    a.timeScale = speed;
    ud.mixer.update(dt);
  }
  function onSidewalkY(x, y) {
    const h = heightAt(x, y);
    const ri = roadInfo(x, y);
    if (ri && ri.road.kind !== 'arcade' && ri.road.kind !== 'lane' && ri.d > ri.road.w / 2 - 0.2 &&
      ri.d < ri.road.w / 2 + (typeof INFILL_BLVD !== 'undefined' && INFILL_BLVD.has(ri.road.n) && INFILL_AREA(x, y) ? INFILL_FRONT + 0.3 : SW + 0.2)) return h + CURB;
    if (ri && ri.road.kind === 'arcade' && ri.d < ri.road.w / 2) return h + 0.12;
    return h + (ri && ri.d < ri.road.w / 2 ? 0.05 : 0);
  }
  G3.onSidewalkY = onSidewalkY;
  function placePed(p, dt) {
    let o = pedObjs.get(p);
    if (!o) {
      o = pedPool.pop() || makeHuman(false);
      o.visible = true;
      dressHuman(o, p);
      pedObjs.set(p, o);
    }
    o.position.set(p.x, p.y3 != null ? p.y3 : onSidewalkY(p.x, p.y), p.y);
    o.rotation.set(0, -p.a, 0);
    if (o.userData.umb) o.userData.umb.visible = S.rainI > 0.3 && !(p.down > 0) && p.flee <= 0 && p.pose !== 'sit';
    if (p.static) {
      tickHuman(o, p.pose === 'sit' ? 'sit' : 'idle', p.pose === 'sit' ? 1 : 0.6 + (p.t % 1) * 0.4, dt);
    } else if (p.wait) {
      tickHuman(o, 'idle', 0.8, dt);
    } else if (p.down > 0) {
      o.rotation.set(0, -p.a, Math.PI / 2 * 0.98);
      o.position.y += 0.35;
      tickHuman(o, 'idle', 0.2, dt);
    } else if (p.flee > 0) tickHuman(o, 'run', 1.1, dt);
    else tickHuman(o, 'walk', clamp(p.sp * PK / 4.0, 0.7, 1.4), dt);
  }

  /* ---------- 電車 ---------- */
  const TRAIN_NODE = { botchan: ['botchan_loco', 'botchan_coach'], tram: ['tram', 'tram'], iyotetsu: ['iyotetsu', 'iyotetsu'], jr: ['jr', 'jr'] };
  const TRAIN_GAP = { botchan: 21, tram: 32, iyotetsu: 48, jr: 50 };
  function fallbackTrain(type, ci) {
    const g = new THREE.Group();
    const col = type === 'jr' ? 0xeceef0 : type === 'botchan' ? (ci ? 0x5a4632 : 0x22221f) : 0xe8862c;
    const len = (TRAIN_GAP[type] - 1.5) / U;
    const m = new THREE.Mesh(new THREE.BoxGeometry(len, 3.2, 2.6), new THREE.MeshStandardMaterial({ color: col, roughness: 0.5 }));
    m.position.y = 1.9;
    g.add(m);
    return g;
  }
  function buildTrains() {
    for (const tr of TRAINS) {
      const cars = [];
      for (let ci = 0; ci < tr.cars; ci++) {
        const nm = TRAIN_NODE[tr.type][ci === 0 ? 0 : 1];
        const node = G3.glbNode('trains', nm);
        const o = node ? node.clone(true) : fallbackTrain(tr.type, ci);
        o.scale.setScalar(U);
        o.traverse(c => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });
        const lights = [];
        o.traverse(c => { if (c.isMesh && c.material && /^(HeadLight|Window)/.test(c.material.name)) { c.material = c.material.clone(); lights.push(c.material); } });
        o.userData.lights = lights;
        scene.add(o);
        cars.push(o);
      }
      trainObjs.push({ tr, cars });
    }
  }
  function updTrains3() {
    const night = 1 - G3.day;
    for (const { tr, cars } of trainObjs) {
      const gap = TRAIN_GAP[tr.type];
      cars.forEach((o, ci) => {
        let d = tr.d - ci * gap * tr.dir;
        if (tr.loop) d = ((d % tr.pl.len) + tr.pl.len) % tr.pl.len;
        else d = clamp(d, 0, tr.pl.len);
        const p = plAt(tr.pl, d);
        const q = plAt(tr.pl, clamp(d + 2, 0, tr.pl.len));
        const a = Math.atan2(q.y - p.y, q.x - p.x) + (tr.dir < 0 ? Math.PI : 0);
        const lift = railLift(tr.pl, d);
        o.position.set(p.x, heightAt(p.x, p.y) + lift + (tr.type === 'jr' || tr.type === 'iyotetsu' ? 0.72 : 0.09), p.y);
        // 高架へのこう配では車体を傾ける（向いている方へ上り = 機首上げ）
        const sgn = tr.dir < 0 ? -1 : 1, pit = lift || railLift(tr.pl, d + 6) ? Math.atan2(railLift(tr.pl, d + 6 * sgn) - railLift(tr.pl, d - 6 * sgn), 12) : 0;
        o.rotation.order = 'YZX';
        o.rotation.set(0, -a, pit);
        for (const m of o.userData.lights) m.emissiveIntensity = m.name.startsWith('Head') ? night * 5 + 0.2 : night * 1.4;
      });
    }
  }

  /* ---------- みかん・マーカー・パーティクル・スキッド ---------- */
  function buildMikans() {
    const node = G3.glbNode('misc', 'mikan');
    let geo, mat;
    if (node) {
      node.traverse(c => { if (c.isMesh && !geo) { geo = c.geometry; mat = c.material; } });
    }
    if (!geo) {
      geo = new THREE.SphereGeometry(0.42, 18, 12);
      mat = new THREE.MeshStandardMaterial({ color: 0xff8a1a, roughness: 0.45, emissive: 0xff6a00, emissiveIntensity: 0.25 });
    }
    mat = mat.clone(); mat.emissive = new THREE.Color(0xff7a10); mat.emissiveIntensity = 0.35;
    mikanIM = new THREE.InstancedMesh(geo, mat, MIKANS.length);
    mikanIM.castShadow = true;
    mikanIM.frustumCulled = false;
    scene.add(mikanIM);
  }
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
  function updMikans() {
    MIKANS.forEach((m, i) => {
      if (m.got) { _m4.makeScale(0, 0, 0); mikanIM.setMatrixAt(i, _m4); return; }
      const y = onSidewalkY(m.x, m.y) + 3.2 + Math.sin(tSec * 2.2 + m.id) * 0.5;
      _q.setFromEuler(_e.set(0.3, tSec * 1.6 + m.id, 0));
      _m4.compose(_v.set(m.x, y, m.y), _q, _s.setScalar(U * 1.6));
      mikanIM.setMatrixAt(i, _m4);
    });
    mikanIM.instanceMatrix.needsUpdate = true;
  }
  function buildMarker() {
    // GTA風の光の柱
    const tex = G3.world.canvasTex(4, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.65, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,.9)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, false);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffd34d, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    marker = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 34, 32, 1, true), mat);
    marker.renderOrder = 5;
    scene.add(marker);
    const rm = new THREE.MeshBasicMaterial({ map: G3.radialTex(), color: 0xffd34d, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -90 });
    markerRing = new THREE.Mesh(new THREE.PlaneGeometry(26, 26), rm);
    markerRing.rotation.x = -Math.PI / 2;
    scene.add(markerRing);
  }
  function updMarker() {
    const mp = missionMarkerPos();
    marker.visible = markerRing.visible = !!mp;
    if (!mp) return;
    const col = S.active ? 0x50d2ff : 0xffd34d;
    marker.material.color.setHex(col); markerRing.material.color.setHex(col);
    const y = onSidewalkY(mp[0], mp[1]);
    marker.position.set(mp[0], y + 17, mp[1]);
    const s = 1 + Math.sin(tSec * 3) * 0.06;
    marker.scale.set(s, 1, s);
    markerRing.position.set(mp[0], y + 0.1, mp[1]);
    markerRing.scale.setScalar(1 + Math.sin(tSec * 3) * 0.1);
  }
  function buildParticles() {
    const mk = (blend) => {
      const n = 320;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4), 4));
      const m = new THREE.PointsMaterial({ size: 3, map: G3.radialTex(), vertexColors: true, transparent: true, depthWrite: false, blending: blend, sizeAttenuation: true });
      const p = new THREE.Points(g, m);
      p.frustumCulled = false;
      scene.add(p);
      return p;
    };
    partSmoke = mk(THREE.NormalBlending);
    partFire = mk(THREE.AdditiveBlending);
  }
  function updParticles() {
    const sm = partSmoke.geometry, fi = partFire.geometry;
    const sp = sm.attributes.position.array, sc = sm.attributes.color.array;
    const fp = fi.attributes.position.array, fc = fi.attributes.color.array;
    let ns = 0, nf = 0;
    for (const p of parts) {
      const a = clamp(p.life / p.max, 0, 1);
      const h = heightAt(p.x, p.y) + (p.h || 2);
      if (p.type === 'smoke' || p.type === 'steam') {
        if (ns >= 320) continue;
        sp[ns * 3] = p.x; sp[ns * 3 + 1] = h; sp[ns * 3 + 2] = p.y;
        const c = p.type === 'steam' ? 0.95 : 0.32;
        sc[ns * 4] = c; sc[ns * 4 + 1] = c; sc[ns * 4 + 2] = c * 1.02; sc[ns * 4 + 3] = a * (p.type === 'steam' ? 0.45 : 0.6);
        ns++;
      } else {
        if (nf >= 320) continue;
        fp[nf * 3] = p.x; fp[nf * 3 + 1] = h; fp[nf * 3 + 2] = p.y;
        const boom = p.type === 'boom';
        fc[nf * 4] = 1; fc[nf * 4 + 1] = boom ? 0.55 : 0.85; fc[nf * 4 + 2] = boom ? 0.15 : 0.4; fc[nf * 4 + 3] = a;
        nf++;
      }
    }
    sm.setDrawRange(0, ns); fi.setDrawRange(0, nf);
    sm.attributes.position.needsUpdate = sm.attributes.color.needsUpdate = true;
    fi.attributes.position.needsUpdate = fi.attributes.color.needsUpdate = true;
    partSmoke.material.size = 9; partFire.material.size = 5;
  }
  function buildSkids() {
    const n = 300;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 4 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 4 * 4), 4));
    const idx = [];
    for (let i = 0; i < n; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3);
    g.setIndex(idx);
    skidMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0x15171a, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -70 }));
    skidMesh.frustumCulled = false;
    scene.add(skidMesh);
  }
  function updSkids() {
    const g = skidMesh.geometry;
    const P = g.attributes.position.array, Cc = g.attributes.color.array;
    let n = 0;
    for (const s of SKIDS) {
      if (n >= 300) break;
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, L = hyp(dx, dy) || 1;
      const nx = -dy / L * 0.55, ny = dx / L * 0.55;
      const y = heightAt(s.x1, s.y1) + 0.09;
      const pts = [[s.x1 - nx, s.y1 - ny], [s.x1 + nx, s.y1 + ny], [s.x2 + nx, s.y2 + ny], [s.x2 - nx, s.y2 - ny]];
      const a = clamp(s.ttl / 7, 0, 1) * 0.55;
      pts.forEach((p, k) => {
        P[(n * 4 + k) * 3] = p[0]; P[(n * 4 + k) * 3 + 1] = y; P[(n * 4 + k) * 3 + 2] = p[1];
        Cc[(n * 4 + k) * 4] = 1; Cc[(n * 4 + k) * 4 + 1] = 1; Cc[(n * 4 + k) * 4 + 2] = 1; Cc[(n * 4 + k) * 4 + 3] = a;
      });
      n++;
    }
    g.setDrawRange(0, n * 6);
    g.attributes.position.needsUpdate = g.attributes.color.needsUpdate = true;
  }

  /* ---------- 船・飛行機 ---------- */
  function buildFerryPlane() {
    const fn = G3.glbNode('misc', 'ferry');
    ferry = fn ? fn.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(40, 8, 10), new THREE.MeshStandardMaterial({ color: 0xf2f2ee }));
    ferry.scale.setScalar(fn ? U * 0.55 : 1);
    ferry.traverse(c => { if (c.isMesh) c.castShadow = true; });
    scene.add(ferry);
    const pn = G3.glbNode('misc', 'plane');
    plane = pn ? pn.clone(true) : new THREE.Mesh(new THREE.BoxGeometry(60, 6, 8), new THREE.MeshStandardMaterial({ color: 0xf4f5f6 }));
    plane.scale.setScalar(pn ? U * 0.62 : 1);
    plane.traverse(c => { if (c.isMesh) c.castShadow = true; });
    scene.add(plane);
  }
  function updFerryPlane() {
    const fx = lerp(FERRY.ax, FERRY.bx, FERRY.t), fz = lerp(FERRY.ay, FERRY.by, FERRY.t);
    const fa = Math.atan2(FERRY.by - FERRY.ay, FERRY.bx - FERRY.ax) + (FERRY.dir < 0 ? Math.PI : 0);
    ferry.position.set(fx, -0.8 + Math.sin(tSec * 0.8) * 0.15, fz);
    ferry.rotation.set(Math.sin(tSec * 0.6) * 0.01, -fa, Math.sin(tSec * 0.9) * 0.015);
    const P = PLANE;
    plane.visible = P.st !== 0;
    if (P.st === 0) return;
    let x = P.x, z = P.y, a = P.a, alt = P.alt;
    if (P.st === 2) { x = 1005; z = 4785; a = Math.atan2(-475, -215); alt = 0; }
    plane.position.set(x, alt * 120 + 0.2, z);
    plane.rotation.set(0, -a, clamp(alt * 0.12, 0, 0.12));
  }

  /* ---------- プレイヤー ---------- */
  function updPlayer3(dt) {
    const inCar = S.mode === 'car';
    if (inCar && S.pcar.type !== 'bike') {
      player.visible = false;
    } else if (inCar) {
      player.visible = false;  // バイクは車両側の乗り手が表示
      const ro = carObjs.get(S.pcar);
      if (ro && ro.userData.rider) dressRiderAsPlayer(ro.userData.rider);
    } else {
      player.visible = true;
      player.position.set(S.px, onSidewalkY(S.px, S.py), S.py);
      player.rotation.set(0, -S.pa, 0);
      if (S.knock > 0) player.rotation.z = Math.PI / 2 * 0.9;
      const run = k.sprint;
      tickHuman(player, S.moving ? (run ? 'run' : 'walk') : 'idle', S.moving ? (run ? 1.15 : 1.25) : 1, dt);
    }
    // 夜のヘッドライト（スポットライト）
    if (inCar && G3.day < 0.6) {
      const c = S.pcar;
      const y = heightAt(c.x, c.y) + 2.2;
      headSpot.position.set(c.x + Math.cos(c.a) * 5, y, c.y + Math.sin(c.a) * 5);
      headSpot.target.position.set(c.x + Math.cos(c.a) * 60, y - 3, c.y + Math.sin(c.a) * 60);
      headSpot.intensity = (1 - G3.day) * 1400;
    } else headSpot.intensity = 0;   // 消す時も visible は変えない（ライト数が変わると全マテリアルのシェーダーが作り直しになる）
  }
  function dressRiderAsPlayer(r) {
    const m = r.userData.mats;
    if (m.Shirt) m.Shirt.color.set('#2e6e46');
    r.traverse(c => { if (c.name === 'Cap') c.visible = true; });
  }

  /* ---------- 構築・更新 ---------- */
  function build() {
    scene = G3.scene;
    player = makeHuman(false, true);
    dressHuman(player, { c: '#2e6e46', pc: '#33404e', hc: '#2c2620', sk: '#e8c8a0' });
    for (let i = 0; i < 98; i++) { const o = makeHuman(false); o.visible = false; pedPool.push(o); }   // 歩く人 70＋立ち止まる人 24 ＋予備
    // 車も先に作って置いておく（走行中に初めて出てくる車種で引っかからないように）
    const need = {};
    for (const c of parked) need[c.type] = (need[c.type] || 0) + 1;
    for (const t of Object.keys(CARTYPES)) {
      const n = (need[t] || 0) + (t === 'police' ? 6 : t === 'bus' ? 4 : 11);   // 通行車 64 台ぶんの予備
      const pool = carPool[t] || (carPool[t] = []);
      for (let i = 0; i < n; i++) { const o = makeCar(t); o.visible = false; pool.push(o); }
    }
    headSpot = new THREE.SpotLight(0xfff1d0, 0, 190, 0.5, 0.6, 1.2);
    headSpot.castShadow = false;
    scene.add(headSpot, headSpot.target);
    // 後から初めて使うマテリアル（夜の路面のヘッドライト光・割れたガラス）も先に作り、起動時の下準備でシェーダーを作っておく
    if (!G3._beamMat) G3._beamMat = new THREE.MeshBasicMaterial({ map: G3.radialTex(), color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -85 });
    if (!crackMat) crackMat = new THREE.MeshStandardMaterial({ color: 0xaab6bc, roughness: 0.55, metalness: 0.2, transparent: true, opacity: 0.85 });
    for (const m of [G3._beamMat, crackMat]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m); d.visible = false; d.position.set(0, -50, 0); scene.add(d); }
    buildTrains();
    buildMikans();
    buildMarker();
    buildParticles();
    buildSkids();
    buildFerryPlane();
  }
  const seen = new Set();
  function update(dt) {
    seen.clear();
    // 遠くの駐車車両・通行車は描かない（描画回数の節約）
    const cpx = G3.camera.position.x, cpz = G3.camera.position.z;
    const nearCam = (c, r) => { const dx = c.x - cpx, dz = c.y - cpz; return dx * dx + dz * dz < r * r || c === S.pcar; };
    for (const c of parked) { if (!nearCam(c, 650)) continue; placeCar(c, false, dt); seen.add(c); }
    for (const c of traffic) { if (!nearCam(c, 1000)) continue; placeCar(c, false, dt); seen.add(c); }
    for (const c of polices) { placeCar(c, true, dt); seen.add(c); }
    if (S.mode === 'car' && S.pcar) { placeCar(S.pcar, false, dt, true); seen.add(S.pcar); }
    for (const [car, o] of carObjs) if (!seen.has(car)) releaseCar(car, o);
    // 歩行者
    const pseen = new Set();
    for (const p of peds) { placePed(p, dt); pseen.add(p); }
    for (const [p, o] of pedObjs) if (!pseen.has(p)) { o.visible = false; pedObjs.delete(p); pedPool.push(o); }
    updPlayer3(dt);
    updTrains3();
    updMikans();
    updMarker();
    updParticles();
    updSkids();
    updFerryPlane();
  }
  return { build, update, dent, pools: () => Object.fromEntries(Object.entries(carPool).map(([k, v]) => [k, v.length])) };
})();
