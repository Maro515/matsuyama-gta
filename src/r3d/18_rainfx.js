'use strict';
/* =========================================================
   雨の細部: 路面で跳ねる雨粒・水たまりの波紋・車が巻き上げる水煙
   跳ねと波紋は、世界を小さなマスに分けて「マスごとに決まった場所・周期」で GPU だけで動かす
   （カメラが動いても跳ねが一緒に滑らない）。映るのは舗装と水面だけ（14_wet の濡れマスク）。
   水煙は走る車の後輪から出る粒（CPU、専用の小さな粒子プール）
   ========================================================= */
G3.rainfx = (function () {
  const THREE = G3.THREE, U = G3.U;
  const CELL = 1.7, G = 48;   // マスの大きさ（単位）と、カメラの周り G×G マス
  const UNI = {
    uT: { value: 0 }, uCell: { value: new THREE.Vector2() }, uInt: { value: 0 }, uCamG: { value: 0 }, uLit: { value: 1 },
    uMask: { value: null }, uMaskK: { value: new THREE.Vector2(1, 1) },
  };
  const VS = `
    attribute vec2 corner;
    attribute float aIdx;
    uniform float uT, uInt, uCamG;
    uniform vec2 uCell;
    varying vec2 vUv;
    varying float vA;
    varying float vRing;
    varying vec2 vW;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      float ix = mod(aIdx, ${G}.0) - ${G / 2}.0, iz = floor(aIdx / ${G}.0) - ${G / 2}.0;
      vec2 cell = uCell + vec2(ix, iz);
      float r1 = h21(cell), r2 = h21(cell + 17.3), r3 = h21(cell + 41.9);
      float per = 0.55 + r2 * 0.5;
      float lt = uT / per + r1 * 7.0;
      float cyc = floor(lt), f = fract(lt);
      // 周期ごとにマスの中の場所を変える
      vec2 off = vec2(h21(cell + cyc * 0.37), h21(cell + cyc * 0.53 + 9.1)) * ${CELL};
      vec3 P = vec3((cell.x * ${CELL}) + off.x, uCamG + 0.16, (cell.y * ${CELL}) + off.y);
      vW = P.xz;
      bool ring = r3 < 0.28;
      vRing = ring ? 1.0 : 0.0;
      float life = ring ? 0.6 : 0.26;
      float a = f < life ? 1.0 - f / life : 0.0;
      // 雨の強さで数を間引く
      if (r3 > 0.2 + 0.8 * uInt || a <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
      vA = a;
      vUv = corner;
      if (ring) {
        float rad = (0.04 + (f / life) * 0.19) * ${U.toFixed(2)};
        P.xz += corner * rad;
      } else {
        // 跳ね: カメラへ向く小さな縦長の板（すぐ伸びて消える）
        vec3 toC = normalize(vec3(cameraPosition.x - P.x, 0.0, cameraPosition.z - P.z));
        vec3 rt = vec3(-toC.z, 0.0, toC.x);
        float hh = (0.06 + 0.16 * (f / life)) * ${U.toFixed(2)};
        P += rt * corner.x * 0.05 * ${U.toFixed(2)} + vec3(0.0, (corner.y * 0.5 + 0.5) * hh, 0.0);
      }
      gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
    }`;
  const FS = `
    uniform float uLit;
    uniform sampler2D uMask;
    uniform vec2 uMaskK;
    varying vec2 vUv;
    varying float vA;
    varying float vRing;
    varying vec2 vW;
    void main() {
      float m = texture2D(uMask, vW * uMaskK).r;
      if (m < 0.5) discard;
      float al;
      if (vRing > 0.5) {
        float r = length(vUv);
        al = smoothstep(0.72, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r)) * 0.3;
      } else {
        float x = vUv.x, y = vUv.y * 0.5 + 0.5;
        al = (1.0 - x * x) * (1.0 - y * y) * 0.6;
      }
      al *= vA;
      if (al < 0.01) discard;
      gl_FragColor = vec4(vec3(0.82, 0.86, 0.9) * uLit, al);
    }`;
  let splash = null;
  // 水煙
  const SPRAY_N = 260;
  let spray = null, sp = [];
  function build(scene) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-1, -1, 1, -1, 1, 1, -1, 1], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const idx = new Float32Array(G * G); for (let i = 0; i < idx.length; i++) idx[i] = i;
    g.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 1));
    g.instanceCount = G * G;
    const mat = new THREE.ShaderMaterial({ uniforms: UNI, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -60 });
    splash = new THREE.Mesh(g, mat);
    splash.frustumCulled = false; splash.visible = false; splash.renderOrder = 4; splash.name = 'rain_splash';
    scene.add(splash);
    // 水煙の粒
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPRAY_N * 3), 3));
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(SPRAY_N * 4), 4));
    const pm = new THREE.PointsMaterial({ size: 9, map: G3.radialTex(), vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true });
    spray = new THREE.Points(pg, pm);
    spray.frustumCulled = false; spray.visible = false; spray.name = 'rain_spray';
    scene.add(spray);
  }
  const emitFrom = (c, dt, isPlayer) => {
    const v = Math.abs(c.v || 0);
    if (v < 22) return;
    const t = CARTYPES[c.type] || CARTYPES.sedan, ca = Math.cos(c.a), sa = Math.sin(c.a);
    const rate = Math.min(40, v * 0.35) * dt * G3.wet;   // 1 秒あたりの粒の数（片輪）
    for (const s of c.type === 'bike' ? [0] : [-1, 1]) {
      let n = rate; while (n > 0) {
        if (n < 1 && Math.random() > n) break;
        n -= 1;
        if (sp.length >= SPRAY_N) sp.shift();
        const lat = (t.w / 2 - 0.9) * s, back = t.l / 2 - 1.2;
        const bx = c.x - ca * back - sa * lat, by = c.y - sa * back + ca * lat;
        const sd = Math.sign(c.v || 1);
        sp.push({ x: bx, y: by, z: heightAt(bx, by) + 0.6, vx: -ca * v * 0.18 * sd + (Math.random() - 0.5) * 6, vy: -sa * v * 0.18 * sd + (Math.random() - 0.5) * 6,
          vz: 2 + Math.random() * 3, life: 0.5 + Math.random() * 0.5, max: 1, s: isPlayer ? 1.2 : 1 });
      }
    }
  };
  function update(dt) {
    if (!splash) return;
    const wet = clamp((G3.wet - 0.15) / 0.6, 0, 1), rain = S.rainI;
    const on = rain > 0.05 || G3.wet > 0.2;
    splash.visible = rain > 0.05;
    spray.visible = on && sp.length > 0;
    if (!rain && !sp.length && !on) return;
    const cam = G3.camera.position;
    if (!UNI.uMask.value && G3.refl && G3.refl.mask) { UNI.uMask.value = G3.refl.mask(); UNI.uMaskK.value.copy(G3.refl.maskK()); }
    UNI.uT.value = (UNI.uT.value + dt) % 3000;
    UNI.uCell.value.set(Math.floor(cam.x / CELL), Math.floor(cam.z / CELL));
    UNI.uInt.value = rain;
    UNI.uCamG.value = heightAt(cam.x, cam.z);
    UNI.uLit.value = 0.35 + 0.65 * G3.day;
    // 水煙: 路面が濡れている間、走る車（近くだけ）から
    if (wet > 0) {
      for (const c of traffic) { const dx = c.x - cam.x, dz = c.y - cam.z; if (dx * dx + dz * dz < 170 * 170) emitFrom(c, dt * wet, false); }
      if (S.mode === 'car' && S.pcar) emitFrom(S.pcar, dt * wet, true);
    }
    const pa = spray.geometry.attributes.position.array, pc = spray.geometry.attributes.color.array;
    const lit = 0.45 + 0.5 * G3.day;
    let n = 0;
    for (let i = sp.length - 1; i >= 0; i--) {
      const q = sp[i];
      q.life -= dt;
      if (q.life <= 0) { sp.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      q.vx *= 1 - dt * 2.2; q.vy *= 1 - dt * 2.2; q.vz -= 4 * dt;
      pa[n * 3] = q.x; pa[n * 3 + 1] = q.z; pa[n * 3 + 2] = q.y;
      const a = q.life / q.max;
      pc[n * 4] = pc[n * 4 + 1] = lit * 0.92; pc[n * 4 + 2] = lit; pc[n * 4 + 3] = a * 0.3 * q.s;
      n++;
    }
    spray.geometry.setDrawRange(0, n);
    spray.geometry.attributes.position.needsUpdate = spray.geometry.attributes.color.needsUpdate = true;
    spray.visible = n > 0;
  }
  return { build, update, stats: () => ({ spray: sp.length }) };
})();
