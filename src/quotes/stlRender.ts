// Genera capturas de un STL en el navegador (three.js se carga solo cuando se usa).
export interface StlRenders {
  views: { label: string; dataUrl: string }[];
  size: { x: number; y: number; z: number }; // mm
}

const VIEWS: { label: string; dir: [number, number, number] }[] = [
  { label: 'Perspectiva', dir: [1.1, -1.35, 0.95] },
  { label: 'Frente', dir: [0, -1, 0] },
  { label: 'Superior', dir: [0, 0, 1] },
];

export async function renderStl(file: File, color: string, width = 900, height = 700): Promise<StlRenders> {
  const THREE = await import('three');
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');

  const buffer = await file.arrayBuffer();
  let geometry: import('three').BufferGeometry;
  try {
    geometry = new STLLoader().parse(buffer);
  } catch {
    throw new Error('No se pudo leer el archivo. Verificá que sea un .stl válido.');
  }
  if (!geometry.attributes.position || geometry.attributes.position.count === 0) throw new Error('El archivo STL está vacío.');

  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = new THREE.Vector3(); box.getSize(size);
  const center = new THREE.Vector3(); box.getCenter(center);
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere!.radius || 1;

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f4f6fa');
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.55, metalness: 0.08 });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh);

  scene.add(new THREE.HemisphereLight('#ffffff', '#b9c2d0', 1.4));
  const key = new THREE.DirectionalLight('#ffffff', 2.2); key.position.set(radius * 2, -radius * 2.5, radius * 3); scene.add(key);
  const fill = new THREE.DirectionalLight('#ffffff', 0.7); fill.position.set(-radius * 3, radius, radius); scene.add(fill);
  const rim = new THREE.DirectionalLight('#ffffff', 0.6); rim.position.set(0, radius * 3, -radius * 2); scene.add(rim);

  // Cámara ortográfica (como en un plano técnico): cada vista se encuadra según
  // lo que ocupa la pieza desde ese ángulo, con un margen del 10%.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, radius / 100, radius * 10);
  const aspect = width / height;
  const corners: import('three').Vector3[] = [];
  const half = size.clone().multiplyScalar(0.5);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(new THREE.Vector3(sx * half.x, sy * half.y, sz * half.z));

  const views = VIEWS.map(({ label, dir }) => {
    const d = new THREE.Vector3(...dir).normalize().multiplyScalar(radius * 3);
    camera.position.copy(d);
    // Vista superior: el "arriba" de la imagen es el fondo de la pieza (+Y), no Z (los STL suelen venir con Z hacia arriba).
    if (Math.abs(dir[2]) > 0.99 && !dir[0] && !dir[1]) camera.up.set(0, 1, 0); else camera.up.set(0, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    corners.forEach(c => { const p = c.clone().applyMatrix4(inv); minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    let w = (maxX - minX) * 1.1, h = (maxY - minY) * 1.1;
    if (w / h > aspect) h = w / aspect; else w = h * aspect;
    camera.left = cx - w / 2; camera.right = cx + w / 2; camera.top = cy + h / 2; camera.bottom = cy - h / 2;
    camera.updateProjectionMatrix();
    key.position.copy(d.clone().multiplyScalar(1.4).add(new THREE.Vector3(radius, 0, radius * 1.5)));
    renderer.render(scene, camera);
    return { label, dataUrl: renderer.domElement.toDataURL('image/jpeg', 0.9) };
  });

  geometry.dispose(); material.dispose(); renderer.dispose();
  renderer.forceContextLoss?.();
  return { views, size: { x: size.x, y: size.y, z: size.z } };
}
