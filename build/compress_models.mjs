// 3D モデル（assets/glb/*.glb）の頂点を量子化して小さくする（Blender で書き出した後に実行）。
//   位置: 部品ごとの範囲で 16bit 整数（戻すための中心と幅を primitive の extras.dq に記録）
//   法線: 8bit 整数（meshopt の八面体フィルタ）
//   UV:   部品ごとの範囲で 16bit 整数（戻すための原点と幅を extras.dqTEXCOORD_0 / _1 に記録）
//   量子化の前に同じ中身のデータを1つにまとめ、頂点・三角形の並びを圧縮しやすい順に並べ替えて meshopt で圧縮
// 一般の量子化ツールと違い、ノードの変換は変えない。読み込み直後に 00_core の dequantize() が
// 元の float と同じ座標へ戻すので、描画コードは量子化を意識しなくてよい。
// 使い方: cd build && node compress_models.mjs   （量子化済みのファイルは飛ばす）
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { reorder, dedup } from '@gltf-transform/functions';
import { PropertyType } from '@gltf-transform/core';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'assets', 'glb');
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

for (const f of fs.readdirSync(DIR).filter(n => n.endsWith('.glb')).sort()) {
  const file = path.join(DIR, f);
  const before = fs.statSync(file).size;
  const doc = await io.read(file);
  const root = doc.getRoot();
  const asset = root.getAsset();
  if (asset.extras && asset.extras.mgQuant) { console.log(f, '量子化済み'); continue; }
  // 先に、元の float のまま完全に同じデータ（アクセサ）だけまとめる（材質やメッシュは名前で使うのでまとめない）。
  // 量子化の後にまとめると、大きさの違う部品が同じ整数データになって戻し方が食い違う
  await doc.transform(dedup({ propertyTypes: [PropertyType.ACCESSOR] }));
  const posDone = new Map(), norDone = new Set(), uvDone = new Map();
  let nPos = 0, nNor = 0;
  for (const mesh of root.listMeshes()) for (const prim of mesh.listPrimitives()) {
    if (prim.listTargets().length) continue;   // モーフのある部品は対象外
    const pos = prim.getAttribute('POSITION');
    // 同じ位置データを使う2つ目以降の部品にも、戻し方（dq）を記録する
    if (pos && (posDone.has(pos) || pos.getComponentType() === 5126)) {
      if (!posDone.has(pos)) {
        const a = pos.getArray(), n = a.length / 3, mn = [1e30, 1e30, 1e30], mx = [-1e30, -1e30, -1e30];
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { const v = a[i * 3 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
        const c = [0, 1, 2].map(k => (mn[k] + mx[k]) / 2), h = [0, 1, 2].map(k => Math.max((mx[k] - mn[k]) / 2, 1e-6));
        const q = new Int16Array(n * 3);
        for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) q[i * 3 + k] = Math.max(-32767, Math.min(32767, Math.round((a[i * 3 + k] - c[k]) / h[k] * 32767)));
        pos.setArray(q).setNormalized(true);
        posDone.set(pos, [...c, ...h]);
        nPos++;
      }
      prim.setExtras({ ...prim.getExtras(), dq: posDone.get(pos) });
    }
    for (const sem of ['TEXCOORD_0', 'TEXCOORD_1']) {
      const uv = prim.getAttribute(sem);
      if (!uv || uv.getComponentType() !== 5126) { if (uv && uvDone.has(uv)) prim.setExtras({ ...prim.getExtras(), ['dq' + sem]: uvDone.get(uv) }); continue; }
      if (!uvDone.has(uv)) {
        const a = uv.getArray(), n = a.length / 2, mn = [1e30, 1e30], mx = [-1e30, -1e30];
        for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) { const v = a[i * 2 + k]; if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v; }
        const sc = [0, 1].map(k => Math.max(mx[k] - mn[k], 1e-6));
        const q = new Uint16Array(n * 2);
        for (let i = 0; i < n; i++) for (let k = 0; k < 2; k++) q[i * 2 + k] = Math.round((a[i * 2 + k] - mn[k]) / sc[k] * 65535);
        uv.setArray(q).setNormalized(true);
        uvDone.set(uv, [mn[0], mn[1], sc[0], sc[1]]);
      }
      prim.setExtras({ ...prim.getExtras(), ['dq' + sem]: uvDone.get(uv) });
    }
    const nor = prim.getAttribute('NORMAL');
    if (nor && nor.getComponentType() === 5126 && !norDone.has(nor)) {
      const a = nor.getArray(), q = new Int8Array(a.length);
      for (let i = 0; i < a.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(a[i] * 127)));
      nor.setArray(q).setNormalized(true);
      norDone.add(nor); nNor++;
    }
  }
  // 頂点と三角形の並びを圧縮しやすい順に並べ替える（形・ノードは変わらない）
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  asset.extras = { ...(asset.extras || {}), mgQuant: 1 };
  doc.createExtension(EXTMeshoptCompression).setRequired(true)
    .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.FILTER });
  await io.write(file, doc);
  const after = fs.statSync(file).size;
  console.log(f, Math.round(before / 1024), 'KB →', Math.round(after / 1024), 'KB', `（位置 ${nPos}・法線 ${nNor} 本を量子化）`);
}
