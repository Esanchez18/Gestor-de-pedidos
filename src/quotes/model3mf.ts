// Lector de 3MF compatible con Bambu Studio / OrcaSlicer / PrusaSlicer / Cura.
// - Resuelve componentes que apuntan a otros archivos del paquete (extensión "production", p:path),
//   aplica las transformaciones de cada pieza y devuelve una sola malla en mm.
// - Colores: filamento asignado a cada objeto/parte, zonas pintadas (multicolor/AMS),
//   y colores estándar del 3MF (basematerials / colorgroup).
// - Extrae las vistas previas que guarda el laminador (Metadata/plate_N.png).
import type { BufferGeometry, Matrix4 as Matrix4Type } from 'three';

export interface Parsed3mf {
  geometry: BufferGeometry;
  /** true si la malla trae colores propios (atributo "color" por vértice). */
  hasColors: boolean;
  /** Colores de filamento usados en la pieza (hex), para mostrarlos en pantalla. */
  palette: string[];
  thumbnails: { name: string; dataUrl: string }[];
}

const UNIT_TO_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };
const MAX_TRIANGLES = 3_000_000;

type MeshData = {
  vertices: Float32Array;
  triangles: Uint32Array;
  paint: (string | null)[] | null;         // pintura multicolor serializada por triángulo
  triColor: (string | null)[] | null;      // color estándar 3MF por triángulo
};
type Component = { objectId: string; path: string | null; transform: Matrix4Type };
type ObjectData = { mesh?: MeshData; components: Component[] };
type ModelFile = { unit: number; objects: Map<string, ObjectData>; build: { objectId: string; path: string | null; transform: Matrix4Type }[] };

const normPath = (p: string) => p.replace(/^\/+/, '');
const attrByLocalName = (el: Element, name: string) => { for (const a of Array.from(el.attributes)) if (a.localName === name) return a.value; return null; };
const byTag = (root: Element | Document, tag: string) => Array.from(root.getElementsByTagNameNS('*', tag));
const normHex = (c: string | null | undefined) => {
  const m = (c || '').trim().match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/i);
  return m ? `#${m[1].toLowerCase()}` : null;
};

/**
 * Decodifica la pintura multicolor (formato TriangleSelector de PrusaSlicer, usado también por
 * Bambu/Orca en "paint_color" y "slic3rpe:mmu_segmentation"). Devuelve el número de filamento
 * que cubre más superficie del triángulo (0 = sin pintar, usa el filamento de la pieza).
 */
export function paintedState(serialized: string): number {
  const nibbles: number[] = [];
  for (let i = serialized.length - 1; i >= 0; i--) {
    const n = parseInt(serialized[i], 16);
    if (!Number.isNaN(n)) nibbles.push(n);
  }
  let pos = 0;
  const weights = new Map<number, number>();
  const next = () => (pos < nibbles.length ? nibbles[pos++] : 0);
  const walk = (weight: number, depth: number) => {
    if (pos >= nibbles.length || depth > 24) return;
    const code = next();
    const splitSides = code & 0b11;
    if (splitSides) {
      const children = splitSides + 1;
      for (let i = 0; i < children; i++) walk(weight / children, depth + 1);
    } else {
      let state = code >> 2;
      if (state === 3) state = next() + 3;
      weights.set(state, (weights.get(state) || 0) + weight);
    }
  };
  walk(1, 0);
  let best = 0, bestW = -1;
  weights.forEach((w, s) => { if (w > bestW) { best = s; bestW = w; } });
  return best;
}

/** Colores de filamento del proyecto (Bambu/Orca: JSON; Prusa: INI). */
function readFilamentPalette(text: (p: string) => string | null): string[] {
  const bambu = text('Metadata/project_settings.config');
  if (bambu) {
    try {
      const cfg = JSON.parse(bambu) as Record<string, unknown>;
      const list = (cfg.filament_colour || cfg.filament_color) as string[] | undefined;
      if (Array.isArray(list)) return list.map(normHex).filter(Boolean) as string[];
    } catch { /* no es JSON */ }
  }
  const prusa = text('Metadata/Slic3r_PE.config') || text('Metadata/Prusa_Slicer.config');
  if (prusa) {
    const get = (key: string) => prusa.match(new RegExp(`^;\\s*${key}\\s*=\\s*(.*)$`, 'm'))?.[1] || '';
    const extruder = get('extruder_colour').split(';').map(normHex);
    const filament = get('filament_colour').split(';').map(normHex);
    const n = Math.max(extruder.length, filament.length);
    const out: string[] = [];
    for (let i = 0; i < n; i++) { const c = extruder[i] || filament[i]; if (c) out.push(c); }
    if (out.length) return out;
  }
  return [];
}

type ExtruderConfig = {
  object: Map<string, number>;                                   // id de objeto → filamento
  part: Map<string, Map<string, number>>;                         // objeto → (id de parte → filamento)
  volumes: Map<string, { first: number; last: number; extruder: number }[]>; // Prusa: rangos de triángulos
};

/** Filamento asignado a cada objeto/parte (Bambu/Orca: model_settings.config; Prusa: Slic3r_PE_model.config). */
function readExtruders(text: (p: string) => string | null): ExtruderConfig {
  const cfg: ExtruderConfig = { object: new Map(), part: new Map(), volumes: new Map() };
  const xml = text('Metadata/model_settings.config') || text('Metadata/Slic3r_PE_model.config') || text('Metadata/Prusa_Slicer_model.config');
  if (!xml) return cfg;
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) return cfg;
  const extruderOf = (el: Element) => {
    const meta = Array.from(el.children).find(c => c.tagName === 'metadata' && c.getAttribute('key') === 'extruder');
    const n = Number(meta?.getAttribute('value'));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  for (const obj of Array.from(doc.getElementsByTagName('object'))) {
    const id = obj.getAttribute('id');
    if (!id) continue;
    const e = extruderOf(obj);
    if (e) cfg.object.set(id, e);
    const parts = new Map<string, number>();
    for (const part of Array.from(obj.getElementsByTagName('part'))) {
      const pe = extruderOf(part);
      if (part.getAttribute('id') && pe) parts.set(part.getAttribute('id')!, pe);
    }
    if (parts.size) cfg.part.set(id, parts);
    const vols: { first: number; last: number; extruder: number }[] = [];
    for (const vol of Array.from(obj.getElementsByTagName('volume'))) {
      const ve = extruderOf(vol);
      const first = Number(vol.getAttribute('firstid')), last = Number(vol.getAttribute('lastid'));
      if (ve && Number.isFinite(first) && Number.isFinite(last)) vols.push({ first, last, extruder: ve });
    }
    if (vols.length) cfg.volumes.set(id, vols);
  }
  return cfg;
}

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

  const palette = readFilamentPalette(text);
  const extruders = readExtruders(text);

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

    // Colores estándar del 3MF: <basematerials> (displaycolor) y <colorgroup> (color).
    const colorResources = new Map<string, string[]>();
    for (const bm of byTag(doc, 'basematerials')) {
      const id = bm.getAttribute('id');
      if (id) colorResources.set(id, byTag(bm, 'base').map(b => normHex(b.getAttribute('displaycolor')) || '#cccccc'));
    }
    for (const cg of byTag(doc, 'colorgroup')) {
      const id = cg.getAttribute('id');
      if (id) colorResources.set(id, byTag(cg, 'color').map(c => normHex(c.getAttribute('color')) || '#cccccc'));
    }

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
        const objPid = obj.getAttribute('pid');
        const objPindex = Number(obj.getAttribute('pindex') || 0);
        let paint: (string | null)[] | null = null;
        let triColor: (string | null)[] | null = null;
        ts.forEach((t, i) => {
          triangles[i * 3] = Number(t.getAttribute('v1')); triangles[i * 3 + 1] = Number(t.getAttribute('v2')); triangles[i * 3 + 2] = Number(t.getAttribute('v3'));
          const p = t.getAttribute('paint_color') || attrByLocalName(t, 'mmu_segmentation');
          if (p) { paint ??= new Array(ts.length).fill(null); paint[i] = p; }
          const pid = t.getAttribute('pid') || objPid;
          if (pid && colorResources.has(pid)) {
            const p1 = t.getAttribute('p1');
            const c = colorResources.get(pid)![p1 !== null ? Number(p1) : objPindex];
            if (c) { triColor ??= new Array(ts.length).fill(null); triColor[i] = c; }
          }
        });
        data.mesh = { vertices, triangles, paint, triColor };
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

  const posChunks: Float32Array[] = [];
  const colorChunks: Float32Array[] = [];
  let anyColor = false;
  const usedColors = new Set<string>();
  let triangleCount = 0;
  const v = new THREE.Vector3();
  const tmpColor = new THREE.Color();
  const DEFAULT = '#cccccc';

  // rootId: objeto de la placa (para buscar su filamento); inherited: filamento heredado de la parte.
  const emit = (path: string, objectId: string, matrix: Matrix4Type, depth: number, rootId: string, inherited: number) => {
    if (depth > 16) return; // protección contra referencias circulares
    const model = loadModel(path);
    const obj = model.objects.get(objectId);
    if (!obj) return;
    if (obj.mesh) {
      const { vertices, triangles, paint, triColor } = obj.mesh;
      const triCount = triangles.length / 3;
      triangleCount += triCount;
      if (triangleCount > MAX_TRIANGLES) throw new Error('El modelo es demasiado grande para generar vistas en el navegador.');
      const out = new Float32Array(triangles.length * 3);
      const colors = new Float32Array(triangles.length * 3);
      const partExtruder = extruders.part.get(rootId)?.get(objectId) || inherited || extruders.object.get(rootId) || extruders.object.get(objectId) || 0;
      const volumes = extruders.volumes.get(objectId) || extruders.volumes.get(rootId);
      for (let t = 0; t < triCount; t++) {
        // Color del triángulo: pintura > color 3MF > filamento de la parte/volumen > filamento 1.
        let hex: string | null = null;
        const painted = paint?.[t] ? paintedState(paint[t]!) : 0;
        if (painted > 0 && palette.length) hex = palette[painted - 1] || palette[0];
        if (!hex && triColor?.[t]) hex = triColor[t];
        if (!hex && palette.length) {
          let ext = partExtruder;
          if (volumes) { const vol = volumes.find(x => t >= x.first && t <= x.last); if (vol) ext = vol.extruder; }
          hex = palette[(ext || 1) - 1] || palette[0];
        }
        if (hex) { anyColor = true; usedColors.add(hex); }
        tmpColor.set(hex || DEFAULT);
        for (let k = 0; k < 3; k++) {
          const vi = triangles[t * 3 + k] * 3;
          v.set(vertices[vi] * model.unit, vertices[vi + 1] * model.unit, vertices[vi + 2] * model.unit).applyMatrix4(matrix);
          const o = (t * 3 + k) * 3;
          out[o] = v.x; out[o + 1] = v.y; out[o + 2] = v.z;
          colors[o] = tmpColor.r; colors[o + 1] = tmpColor.g; colors[o + 2] = tmpColor.b;
        }
      }
      posChunks.push(out); colorChunks.push(colors);
    }
    for (const c of obj.components) {
      const childMatrix = matrix.clone().multiply(c.transform.clone().setPosition(new THREE.Vector3().setFromMatrixPosition(c.transform).multiplyScalar(model.unit)));
      const partExt = extruders.part.get(rootId)?.get(c.objectId) || inherited;
      emit(c.path ? normPath(c.path) : path, c.objectId, childMatrix, depth + 1, rootId, partExt);
    }
  };

  const rootModel = loadModel(root);
  const items = rootModel.build.length ? rootModel.build : [...rootModel.objects.keys()].map(objectId => ({ objectId, path: null, transform: new THREE.Matrix4() }));
  for (const item of items) {
    const m = item.transform.clone().setPosition(new THREE.Vector3().setFromMatrixPosition(item.transform).multiplyScalar(rootModel.unit));
    emit(item.path ? normPath(item.path) : root, item.objectId, m, 0, item.objectId, 0);
  }
  if (!posChunks.length) throw new Error('El 3MF no tiene piezas para mostrar.');

  const join = (chunks: Float32Array[]) => {
    const all = new Float32Array(chunks.reduce((s, c) => s + c.length, 0));
    let offset = 0;
    for (const c of chunks) { all.set(c, offset); offset += c.length; }
    return all;
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(join(posChunks), 3));
  if (anyColor) geometry.setAttribute('color', new THREE.BufferAttribute(join(colorChunks), 3));

  // Vistas previas del laminador (Bambu/Orca: Metadata/plate_1.png; estándar: Metadata/thumbnail.png).
  const thumbnails: Parsed3mf['thumbnails'] = [];
  for (const [name, data] of files) {
    if (!/^Metadata\/(plate_\d+|thumbnail)\.png$/i.test(name)) continue;
    let binary = '';
    for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    thumbnails.push({ name, dataUrl: `data:image/png;base64,${btoa(binary)}` });
  }
  thumbnails.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { geometry, hasColors: anyColor, palette: [...usedColors], thumbnails: thumbnails.slice(0, 4) };
}
