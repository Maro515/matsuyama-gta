'use strict';
/* =========================================================
   光の円錐（夜の雨・もや）
   雨の夜は空気中の水滴で、街灯の真下へ落ちる光や車のヘッドライトの光が円錐として見える。
   晴れた夜もうっすら。円錐の板を加算で描き、根元ほど明るく・正面から見るほど濃く・地面に近いほど薄くする
   ========================================================= */
G3.beams = (function () {
  const THREE = G3.THREE, U = G3.U;
  const MAX = 240;
  const UNI = { uInt: { value: 0 } };
  const VS = `
    attribute vec4 iCol;
    varying float vT;
    varying vec3 vN;
    varying vec3 vV;
    varying vec4 vC;
    varying float vD;
    void main() {
      vT = clamp(-position.y, 0.0, 1.0);
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vN = normalize((modelMatrix * instanceMatrix * vec4(normal, 0.0)).xyz);
      vV = cameraPosition - wp.xyz;
      vD = length(vV);
      vC = iCol;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`;
  const FS = `
    uniform float uInt;
    varying float vT;
    varying vec3 vN;
    varying vec3 vV;
    varying vec4 vC;
    varying float vD;
    void main() {
      float fall = pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.06, vT);
      float facing = abs(dot(vN, vV / vD));
      float a = fall * facing * facing * vC.a * uInt * smoothstep(3.0, 14.0, vD);
      if (a < 0.002) discard;
      gl_FragColor = vec4(vC.rgb * a, 1.0);
    }`;
  let mesh = null, aCol = null;
  function build(scene) {
    const g = new THREE.ConeGeometry(1, 1, 20, 1, true);
    g.translate(0, -0.5, 0);   // 頂点（灯具）が原点、底（光の先）が y=-1
    aCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    aCol.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iCol', aCol);
    const mat = new THREE.ShaderMaterial({ uniforms: UNI, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    mesh = new THREE.InstancedMesh(g, mat, MAX);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.count = 0; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 5; mesh.name = 'light_beams';
    scene.add(mesh);
  }
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _d = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
  let near = [], popT = 0;
  function update(dt) {
    if (!mesh) return;
    const night = clamp(1 - G3.day * 1.7, 0, 1);
    const I = night * (0.1 + 0.9 * S.rainI);
    UNI.uInt.value = I;
    mesh.visible = I > 0.01;
    if (!mesh.visible) return;
    const cam = G3.camera.position;
    if ((popT -= dt) <= 0) {
      popT = 0.5;
      near = [];
      for (const l of (G3.refl && G3.refl.lamps) || []) { const dx = l[0] - cam.x, dz = l[1] - cam.z; if (dx * dx + dz * dz < 360 * 360) near.push(l); }
    }
    let n = 0;
    const put = (x, y, z, dir, len, rad, r, g, b, a) => {
      if (n >= MAX) return;
      _p.set(x, y, z); _q.setFromUnitVectors(DOWN, dir); _s.set(rad, len, rad);
      _m.compose(_p, _q, _s); mesh.setMatrixAt(n, _m);
      aCol.setXYZW(n, r, g, b, a); n++;
    };
    // 街灯: 真下へ
    for (const l of near) { const gy = heightAt(l[0], l[1]); const len = Math.max(4, l[2] - gy); put(l[0], l[2] - 0.3, l[1], DOWN, len, len * 0.55, 1.0, 0.9, 0.72, 0.36); }
    // 車のヘッドライト: 前やや下へ 14m
    const one = (c) => {
      const dx = c.x - cam.x, dz = c.y - cam.z;
      if (dx * dx + dz * dz > 260 * 260) return;
      const t = CARTYPES[c.type] || CARTYPES.sedan, ca = Math.cos(c.a), sa = Math.sin(c.a);
      const gy = heightAt(c.x, c.y), fh = t.l / 2 - 0.1, lat = Math.max(0, t.w / 2 - 0.8);
      _d.set(ca, -0.13, sa).normalize();
      for (const s of c.type === 'bike' ? [0] : [-1, 1]) put(c.x + ca * fh - sa * lat * s, gy + 1.9, c.y + sa * fh + ca * lat * s, _d, 35, 7.5, 1.0, 0.95, 0.85, 0.42);
    };
    for (const c of traffic) one(c);
    for (const c of polices) one(c);
    if (S.mode === 'car' && S.pcar) one(S.pcar);
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    aCol.needsUpdate = true;
  }
  return { build, update, stats: () => ({ n: mesh ? mesh.count : 0 }) };
})();
