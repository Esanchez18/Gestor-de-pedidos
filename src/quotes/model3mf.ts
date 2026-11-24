// Lector de 3MF compatible con Bambu Studio / OrcaSlicer / PrusaSlicer / Cura.
// Resuelve componentes que apuntan a otros archivos del paquete (extensión "production",
// p:path), aplica las transformaciones de cada pieza y devuelve una sola malla en mm.
// También extrae las vistas previas que guarda el laminador (Metadata/*.png).
import type { BufferGeometry, Matrix4 as Matrix4Type } from 'three';

export interface Parsed3mf { geometry: BufferGeometry; thumbnails: { name: string; dataUrl: string }[] }

const UNIT_TO_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const MAX_TRIANGLES = 3_000_000;

type MeshData = { vertices: Float32Array; triangles: Uint32Array };
type Component = { objectId: string; path: string | null; transform: Matrix4Type };
type ObjectData = { mesh?: MeshData; components: Component[] };
type ModelFile = { unit: number; objects: Map<string, ObjectData>; build: { objectId: string; path: string | null; transform: Matrix4Type }[] };

const normPath = (p: string) => p.replace(/^\/+/, '');
const attrByLocalName = (el: Element, name: string) => { for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value; return null; };
const byTag = (root: Element | Document, tag: string) => Array.from(root.getElementsByTagNameNS('*', tag));

export async function parse3mf(buffer: ArrayBuffer): Promise<Parsed3mf> {
  const THREE = await import('three');
  const fflate = await import('three/examples/jsm/libs/fflate.module.js');

  let zip: Record<string, Uint8Array>;
  try { zip = fflate.unzipSync(new Uint8Array(buffer)); }
  catch { throw new Error('No se pudo abrir el archivo. Verificá que sea un .3mf válido.'); }
  const files = new Map(Object.entries(zip).map(([k, v]) => [normPath(k), v]));
  const text = (path: string) => { const f = files.get(normPath(path)); return f ? fflate.strFromU8(f) : null; };

  // Archivo principal según _rels/.rels (por defecto 3D/3dmodel.model).
  let root = '3D/3dmodel.model';
  const rels = text('_rels/.rels');
  if (rels) {
    const doc = new DOMParser().parseFromString(rels, 'application/xml');
    const rel = byTag(doc, 'Relationship').find(r => (r.getAttribute('Type') || '').endsWith('/3dmodel'));
    if (rel?.getAttribute('Target')) root = normPath(rel.getAttribute('Target')!);
  }
  if (!files.has(root)) {
    const any = [...files.keys()].find(k => /^3D\/.*\.model$/i.test(k));
    if (!any) throw new Error('El 3MF no tiene ningún modelo 3D adentro.');
    root = any;
  }

  const parseTransform = (value: string | null) => {
    const m = new THREE.Matrix4();
    if (!value) return m;
    const t = value.trim().split(/\s+/).map(Number);
    if (t.length !== 12 || t.some(n => !Number.isFinite(n))) return m;
    // 3MF: matriz 4x3 por filas, aplicada como [x y z 1] · M
    m.set(t[0], t[3], t[6], t[9], t[1], t[4], t[7], t[10], t[2], t[5], t[8], t[11], 0, 0, 0, 1);
    return m;
  };

  const models = new Map<string, ModelFile>();
  const loadModel = (path: string): ModelFile => {
    const key = normPath(path);
    const cached = models.get(key);
    if (cached) return cached;
    const xml = text(key);
    if (!xml) throw new Error(`Falta la pieza ${key} dentro del 3MF.`);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El 3MF tiene un modelo dañado.');
    const modelEl = doc.documentElement;
    const unit = UNIT_TO_MM[modelEl.getAttribute('unit') || 'millimeter'] ?? 1;
    const objects = new Map<string, ObjectData>();
    for (const obj of byTag(doc, 'object')) {
      const id = obj.getAttribute('id');
      if (!id) continue;
      const data: ObjectData = { components: [] };
      const meshEl = byTag(obj, 'mesh')[0];
      if (meshEl) {
        const vs = byTag(meshEl, 'vertex');
        const vertices = new Float32Array(vs.length * 3);
        vs.forEach((v, i) => { vertices[i * 3] = Number(v.getAttribute('x')); vertices[i * 3 + 1] = Number(v.getAttribute('y')); vertices[i * 3 + 2] = Number(v.getAttribute('z')); });
        const ts = byTag(meshEl, 'triangle');
        const triangles = new Uint32Array(ts.length * 3);
        ts.forEach((t, i) => { triangles[i * 3] = Number(t.getAttribute('v1')); triangles[i * 3 + 1] = Number(t.getAttribute('v2')); triangles[i * 3 + 2] = Number(t.getAttribute('v3')); });
        data.mesh = { vertices, triangles };
      }
      for (const c of byTag(obj, 'component')) {
        const objectId = c.getAttribute('objectid');
        if (objectId) data.components.push({ objectId, path: attrByLocalName(c, 'path'), transform: parseTransform(c.getAttribute('transform')) });
      }
      objects.set(id, data);
    }
    const build = byTag(doc, 'item').map(item => ({ objectId: item.getAttribute('objectid') || '', path: attrByLocalName(item, 'path'), transform: parseTransform(item.getAttribute('transform')) })).filter(i => i.objectId);
    const model = { unit, objects, build };
    models.set(key, model);
    return model;
  };

  const chunks: Float32Array[] = [];
  let triangleCount = 0;
  const v = new THREE.Vector3();
  const emit = (path: string, objectId: string, matrix: Matrix4Type, depth: number) => {
    if (depth > 16) return; // protección contra referencias circulares
    const model = loadModel(path);
    const obj = model.objects.get(objectId);
    if (!obj) return;
    if (obj.mesh) {
      const { vertices, triangles } = obj.mesh;
      triangleCount += triangles.length / 3;
      if (triangleCount > MAX_TRIANGLES) throw new Error('El modelo es demasiado grande para generar vistas en el navegador.');
      const out = new Float32Array(triangles.length * 3);
      for (let i = 0; i < triangles.length; i++) {
        const k = triangles[i] * 3;
        v.set(vertices[k] * model.unit, vertices[k + 1] * model.unit, vertices[k + 2] * model.unit).applyMatrix4(matrix);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      chunks.push(out);
    }
    for (const c of obj.components) {
      const childMatrix = matrix.clone().multiply(c.transform.clone().setPosition(new THREE.Vector3().setFromMatrixPosition(c.transform).multiplyScalar(model.unit)));
      emit(c.path ? normPath(c.path) : path, c.objectId, childMatrix, depth + 1);
    }
  };

  const rootModel = loadModel(root);
  const items = rootModel.build.length ? rootModel.build : [...rootModel.objects.keys()].map(objectId => ({ objectId, path: null, transform: new THREE.Matrix4() }));
  for (const item of items) {
    const m = item.transform.clone().setPosition(new THREE.Vector3().setFromMatrixPosition(item.transform).multiplyScalar(rootModel.unit));
    emit(item.path ? normPath(item.path) : root, item.objectId, m, 0);
  }
  if (!chunks.length) throw new Error('El 3MF no tiene piezas para mostrar.');

  const positions = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
  let offset = 0;
  for (const c of chunks) { positions.set(c, offset); offset += c.length; }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  // Vistas previas del laminador (Bambu/Orca: Metadata/plate_1.png; estándar: Metadata/thumbnail.png).
  const thumbnails: Parsed3mf['thumbnails'] = [];
  for (const [name, data] of files) {
    if (!/^Metadata\/(plate_\d+|thumbnail)\.png$/i.test(name)) continue;
    let binary = '';
    for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    thumbnails.push({ name, dataUrl: `data:image/png;base64,${btoa(binary)}` });
  }
  thumbnails.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { geometry, thumbnails: thumbnails.slice(0, 4) };
}
