import { useEffect, useMemo, useState } from 'react';
import { Archive, Check, Eye, EyeOff, FileBox, ImagePlus, LoaderCircle, Pencil, Plus, Search, Tags, Trash2, Upload, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { CatalogCategory, CatalogPrivateFile, CatalogProduct, CatalogProductDraft } from './types';
import './catalog.css';

function errorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return error instanceof Error ? error.message : 'Ocurrió un error al comunicarse con Supabase.';
}

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function fileExtension(file: File, fallback: string) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension && /^[a-z0-9]{1,8}$/.test(extension) ? extension : fallback;
}

export default function CatalogPage() {
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [privateFiles, setPrivateFiles] = useState<CatalogPrivateFile[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [productEditorOpen, setProductEditorOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<CatalogProduct | null>(null);
  const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CatalogCategory | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryDescription, setCategoryDescription] = useState('');

  async function reload() {
    const client = supabase;
    if (!client) {
      setError('Supabase no está configurado.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const [categoryResult, productResult, privateResult] = await Promise.all([
      client.from('catalog_categories').select('*').order('sort_order').order('name'),
      client.from('catalog_products').select('*').order('updated_at', { ascending: false }),
      client.from('catalog_product_private_files').select('*'),
    ]);
    const firstError = categoryResult.error || productResult.error || privateResult.error;
    if (firstError) setError(`${errorMessage(firstError)}. Si es la primera vez, ejecutá la migración 003_catalog.sql en Supabase.`);
    else {
      const loadedProducts = (productResult.data || []) as CatalogProduct[];
      setCategories((categoryResult.data || []) as CatalogCategory[]);
      setProducts(loadedProducts);
      setPrivateFiles((privateResult.data || []) as CatalogPrivateFile[]);
      const imageEntries = await Promise.all(loadedProducts.filter(product => product.image_path).map(async product => {
        const { data } = await client.storage.from('catalog-images').createSignedUrl(product.image_path!, 3600);
        return data?.signedUrl ? [product.id, data.signedUrl] as const : null;
      }));
      setImageUrls(Object.fromEntries(imageEntries.filter((entry): entry is readonly [string, string] => Boolean(entry))));
    }
    setLoading(false);
  }

  useEffect(() => { void reload(); }, []);

  const productCountByCategory = useMemo(() => {
    const result = new Map<string, number>();
    products.forEach(product => result.set(product.category_id, (result.get(product.category_id) || 0) + 1));
    return result;
  }, [products]);
  const categoryById = useMemo(() => new Map(categories.map(category => [category.id, category])), [categories]);
  const privateByProduct = useMemo(() => new Map(privateFiles.map(file => [file.product_id, file])), [privateFiles]);
  const filteredProducts = useMemo(() => products.filter(product => {
    const text = `${product.title} ${product.description}`.toLocaleLowerCase();
    return (!query || text.includes(query.toLocaleLowerCase()))
      && (categoryFilter === 'all' || product.category_id === categoryFilter)
      && (statusFilter === 'all' || (statusFilter === 'published' ? product.is_published : !product.is_published));
  }), [products, query, categoryFilter, statusFilter]);

  function openNewProduct() { setEditingProduct(null); setProductEditorOpen(true); setError(''); }
  function openEditProduct(product: CatalogProduct) { setEditingProduct(product); setProductEditorOpen(true); setError(''); }
  function openNewCategory() { setEditingCategory(null); setCategoryName(''); setCategoryDescription(''); setCategoryEditorOpen(true); setError(''); }
  function openEditCategory(category: CatalogCategory) { setEditingCategory(category); setCategoryName(category.name); setCategoryDescription(category.description || ''); setCategoryEditorOpen(true); setError(''); }

  async function saveCategory(event: React.FormEvent) {
    event.preventDefault();
    const client = supabase;
    const name = categoryName.trim();
    if (!client || !name) return;
    setBusy(true); setError(''); setNotice('');
    const id = editingCategory?.id || crypto.randomUUID();
    const result = await client.from('catalog_categories').upsert({
      id, name, slug: slugify(name) || `categoria-${id.slice(0, 8)}`, description: categoryDescription.trim() || null,
      sort_order: editingCategory?.sort_order || 0,
    }).select().single();
    setBusy(false);
    if (result.error) { setError(errorMessage(result.error)); return; }
    setCategoryEditorOpen(false);
    setNotice(editingCategory ? 'Categoría actualizada.' : 'Categoría creada.');
    await reload();
  }

  async function deleteCategory(category: CatalogCategory) {
    if ((productCountByCategory.get(category.id) || 0) > 0) {
      setError('No se puede eliminar esta categoría mientras tenga productos asociados. Editá esos productos y asignales otra categoría primero.');
      return;
    }
    if (!confirm(`¿Eliminar la categoría «${category.name}»?`)) return;
    const client = supabase;
    if (!client) return;
    setBusy(true); setError(''); setNotice('');
    const result = await client.from('catalog_categories').delete().eq('id', category.id);
    setBusy(false);
    if (result.error) { setError(errorMessage(result.error)); return; }
    setNotice('Categoría eliminada.');
    await reload();
  }

  async function saveProduct(draft: CatalogProductDraft) {
    const client = supabase;
    if (!client) throw new Error('Supabase no está configurado.');
    setError(''); setNotice(''); setBusy(true);
    let uploadedImage: string | null = null;
    let uploadedStl: string | null = null;
    let productSaved = false;
    try {
      const { data: authData, error: authError } = await client.auth.getUser();
      if (authError || !authData.user) throw authError || new Error('No se pudo verificar el usuario administrador.');
      let imagePath = draft.previous_image_path;
      if (draft.image) {
        const extension = fileExtension(draft.image, 'jpg');
        uploadedImage = `${authData.user.id}/${draft.id}/${crypto.randomUUID()}.${extension}`;
        const upload = await client.storage.from('catalog-images').upload(uploadedImage, draft.image, {
          contentType: draft.image.type || 'image/jpeg', upsert: false,
        });
        if (upload.error) throw upload.error;
        imagePath = uploadedImage;
      }
      const productResult = await client.from('catalog_products').upsert({
        id: draft.id,
        title: draft.title.trim(),
        slug: `${slugify(draft.title) || 'producto'}-${draft.id.slice(0, 8)}`,
        description: draft.description.trim(),
        category_id: draft.category_id,
        image_path: imagePath,
        is_published: draft.is_published,
        published_at: draft.is_published ? (editingProduct?.published_at || new Date().toISOString()) : null,
      }).select().single();
      if (productResult.error) throw productResult.error;
      productSaved = true;

      let nextStlPath: string | null = draft.previous_stl_path;
      if (draft.stl_file) {
        const extension = fileExtension(draft.stl_file, 'stl');
        uploadedStl = `${authData.user.id}/${draft.id}/${crypto.randomUUID()}.${extension}`;
        const upload = await client.storage.from('catalog-stl').upload(uploadedStl, draft.stl_file, {
          contentType: draft.stl_file.type || 'application/octet-stream', upsert: false,
        });
        if (upload.error) throw upload.error;
        nextStlPath = uploadedStl;
        const saveFile = await client.from('catalog_product_private_files').upsert({
          product_id: draft.id, stl_url: null, stl_path: nextStlPath,
        });
        if (saveFile.error) throw saveFile.error;
      } else if (draft.clear_stl) {
        const removeFile = await client.from('catalog_product_private_files').delete().eq('product_id', draft.id);
        if (removeFile.error) throw removeFile.error;
        nextStlPath = null;
      } else if (draft.stl_url.trim()) {
        const saveFile = await client.from('catalog_product_private_files').upsert({
          product_id: draft.id, stl_url: draft.stl_url.trim(), stl_path: null,
        });
        if (saveFile.error) throw saveFile.error;
        nextStlPath = null;
      }

      if (draft.previous_image_path && imagePath !== draft.previous_image_path) {
        await client.storage.from('catalog-images').remove([draft.previous_image_path]);
      }
      if (draft.previous_stl_path && nextStlPath !== draft.previous_stl_path) {
        await client.storage.from('catalog-stl').remove([draft.previous_stl_path]);
      }
      setProductEditorOpen(false);
      setNotice(draft.is_published ? 'Producto publicado.' : 'Borrador guardado.');
      await reload();
    } catch (saveError) {
      if (uploadedImage && !productSaved) await client.storage.from('catalog-images').remove([uploadedImage]);
      if (uploadedStl) await client.storage.from('catalog-stl').remove([uploadedStl]);
      setError(errorMessage(saveError));
      throw saveError;
    } finally {
      setBusy(false);
    }
  }

  async function togglePublication(product: CatalogProduct) {
    const client = supabase;
    if (!client) return;
    if (!product.is_published && !product.image_path) {
      setError('Agregá una imagen al producto antes de publicarlo.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    const publish = !product.is_published;
    const result = await client.from('catalog_products').update({
      is_published: publish, published_at: publish ? new Date().toISOString() : null,
    }).eq('id', product.id);
    setBusy(false);
    if (result.error) { setError(errorMessage(result.error)); return; }
    setNotice(publish ? 'Producto publicado.' : 'Producto despublicado.');
    await reload();
  }

  async function openPrivateStl(product: CatalogProduct) {
    const privateFile = privateByProduct.get(product.id);
    if (!privateFile) { setError('Este producto no tiene un archivo o enlace STL guardado.'); return; }
    if (privateFile.stl_url) { window.open(privateFile.stl_url, '_blank', 'noopener,noreferrer'); return; }
    if (!privateFile.stl_path || !supabase) return;
    const { data, error: signedError } = await supabase.storage.from('catalog-stl').createSignedUrl(privateFile.stl_path, 60);
    if (signedError) { setError(errorMessage(signedError)); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  }

  async function deleteProduct(product: CatalogProduct) {
    if (!confirm(`¿Eliminar «${product.title}» y sus archivos? Esta acción no se puede deshacer.`)) return;
    const client = supabase;
    if (!client) return;
    setBusy(true); setError(''); setNotice('');
    const privateFile = privateByProduct.get(product.id);
    const result = await client.from('catalog_products').delete().eq('id', product.id);
    if (result.error) { setBusy(false); setError(errorMessage(result.error)); return; }
    const storageResults = await Promise.all([
      product.image_path ? client.storage.from('catalog-images').remove([product.image_path]) : Promise.resolve({ error: null }),
      privateFile?.stl_path ? client.storage.from('catalog-stl').remove([privateFile.stl_path]) : Promise.resolve({ error: null }),
    ]);
    const storageError = storageResults.find(storageResult => storageResult.error)?.error;
    setBusy(false);
    setNotice(storageError ? 'Producto eliminado; algún archivo quedó pendiente de limpieza en Storage.' : 'Producto eliminado.');
    await reload();
  }

  return <>
    <div className="page-title">
      <div><span className="eyebrow">TIENDA PIRAÑALAB</span><h1>Catálogo</h1><p>Administrá productos y categorías para la web pública.</p></div>
      <div className="catalog-title-actions">
        <button className="btn secondary" onClick={openNewCategory}><Tags size={16}/>Categorías</button>
        <button className="btn primary" onClick={openNewProduct} disabled={!categories.length}><Plus size={16}/>Nuevo producto</button>
      </div>
    </div>

    {error && <div className="alert error catalog-alert">{error}<button className="icon-btn" onClick={() => setError('')} aria-label="Cerrar aviso"><X size={15}/></button></div>}
    {notice && <div className="alert success catalog-alert">{notice}<button className="icon-btn" onClick={() => setNotice('')} aria-label="Cerrar aviso"><X size={15}/></button></div>}

    <section className="catalog-categories-panel">
      <div className="catalog-section-heading"><div><span className="eyebrow">ORGANIZACIÓN</span><h2>Categorías</h2></div><button className="btn tiny secondary" onClick={openNewCategory}><Plus size={14}/>Agregar</button></div>
      {categories.length ? <div className="catalog-category-list">{categories.map(category => <div className="catalog-category" key={category.id}>
        <div className="catalog-category-icon"><Tags size={16}/></div><div className="catalog-category-copy"><b>{category.name}</b><small>{productCountByCategory.get(category.id) || 0} productos · {category.slug}</small></div>
        <button className="icon-btn" title="Editar categoría" onClick={() => openEditCategory(category)}><Pencil size={15}/></button>
        <button className="icon-btn danger-icon" title="Eliminar categoría" disabled={busy} onClick={() => void deleteCategory(category)}><Trash2 size={15}/></button>
      </div>)}</div> : <p className="catalog-empty-note">Todavía no hay categorías. Creá una para empezar.</p>}
    </section>

    <div className="catalog-section-heading catalog-products-heading"><div><span className="eyebrow">INVENTARIO PÚBLICO</span><h2>Productos <span className="catalog-count">{filteredProducts.length}</span></h2></div><span className="soft-label">{products.filter(product => product.is_published).length} publicados</span></div>
    <section className="catalog-list-panel">
      <div className="catalog-toolbar">
        <label className="searchbox"><Search size={16}/><input placeholder="Buscar productos…" value={query} onChange={event => setQuery(event.target.value)}/></label>
        <label className="catalog-filter"><span>Categoría</span><select value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}><option value="all">Todas</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="catalog-filter"><span>Estado</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">Todos</option><option value="published">Publicados</option><option value="draft">Borradores</option></select></label>
      </div>
      {loading ? <div className="catalog-loading"><LoaderCircle className="catalog-spin" size={20}/>Cargando catálogo…</div>
        : filteredProducts.length ? <div className="catalog-product-grid">{filteredProducts.map(product => {
          const category = categoryById.get(product.category_id);
          const privateFile = privateByProduct.get(product.id);
          const imageUrl = imageUrls[product.id] || '';
          return <article className="catalog-product-card" key={product.id}>
            <div className="catalog-product-image">{imageUrl ? <img src={imageUrl} alt={product.title}/> : <div className="catalog-no-image"><ImagePlus size={26}/><span>Sin imagen</span></div>}
              <span className={`catalog-status ${product.is_published ? 'is-published' : 'is-draft'}`}>{product.is_published ? <><Eye size={12}/>Publicado</> : <><Archive size={12}/>Borrador</>}</span>
            </div>
            <div className="catalog-product-body"><div className="catalog-product-meta"><span>{category?.name || 'Sin categoría'}</span>{privateFile && <span className="catalog-private-tag"><FileBox size={12}/>STL privado</span>}</div><h3>{product.title}</h3><p>{product.description || 'Sin descripción.'}</p>
              <div className="catalog-card-actions"><button className="btn tiny secondary" onClick={() => openEditProduct(product)}><Pencil size={13}/>Editar</button><button className="btn tiny secondary" disabled={busy} onClick={() => void togglePublication(product)}>{product.is_published ? <><EyeOff size={13}/>Despublicar</> : <><Check size={13}/>Publicar</>}</button>{privateFile&&<button className="btn tiny secondary" onClick={() => void openPrivateStl(product)} title="Disponible solo para administración"><FileBox size={13}/>STL</button>}<button className="icon-btn danger-icon" disabled={busy} title="Eliminar producto" onClick={() => void deleteProduct(product)}><Trash2 size={15}/></button></div>
            </div>
          </article>;
        })}</div> : <div className="catalog-empty"><Archive size={25}/><b>{products.length ? 'No hay resultados' : 'El catálogo está vacío'}</b><p>{products.length ? 'Probá con otra búsqueda o filtro.' : 'Creá una categoría y agregá el primer producto.'}</p></div>}
    </section>

    {categoryEditorOpen && <CategoryDialog
      category={editingCategory} name={categoryName} description={categoryDescription} busy={busy}
      onName={setCategoryName} onDescription={setCategoryDescription} onClose={() => setCategoryEditorOpen(false)} onSubmit={saveCategory}
    />}
    {productEditorOpen && <ProductDialog
      key={editingProduct?.id || 'new'} product={editingProduct} categories={categories} privateFile={editingProduct ? privateByProduct.get(editingProduct.id) || null : null}
      busy={busy} onClose={() => setProductEditorOpen(false)} onSave={saveProduct}
    />}
  </>;
}

function CategoryDialog({ category, name, description, busy, onName, onDescription, onClose, onSubmit }: {
  category: CatalogCategory | null; name: string; description: string; busy: boolean;
  onName: (value: string) => void; onDescription: (value: string) => void; onClose: () => void; onSubmit: (event: React.FormEvent) => void;
}) {
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><form className="modal catalog-dialog" onSubmit={onSubmit}>
    <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Cerrar"><X size={17}/></button>
    <span className="eyebrow">CATÁLOGO</span><h2>{category ? 'Editar categoría' : 'Nueva categoría'}</h2><p>Las categorías con productos publicados aparecerán en la web pública.</p>
    <label className="field">Nombre *<input required maxLength={120} value={name} onChange={event => onName(event.target.value)} placeholder="Ej. Decoración"/></label>
    <label className="field">Descripción<textarea rows={3} value={description} onChange={event => onDescription(event.target.value)} placeholder="Descripción opcional"/></label>
    <div className="catalog-dialog-footer"><button type="button" className="btn secondary" onClick={onClose}>Cancelar</button><button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Guardando…' : 'Guardar categoría'}</button></div>
  </form></div>;
}

function ProductDialog({ product, categories, privateFile, busy, onClose, onSave }: {
  product: CatalogProduct | null; categories: CatalogCategory[]; privateFile: CatalogPrivateFile | null; busy: boolean;
  onClose: () => void; onSave: (draft: CatalogProductDraft) => Promise<void>;
}) {
  const [title, setTitle] = useState(product?.title || '');
  const [description, setDescription] = useState(product?.description || '');
  const [categoryId, setCategoryId] = useState(product?.category_id || categories[0]?.id || '');
  const [image, setImage] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [storedImageUrl, setStoredImageUrl] = useState('');
  const [stlUrl, setStlUrl] = useState(privateFile?.stl_url || '');
  const [stlFile, setStlFile] = useState<File | null>(null);
  const [clearStl, setClearStl] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [id] = useState(product?.id || crypto.randomUUID());

  useEffect(() => {
    if (product?.image_path && supabase) {
      supabase.storage.from('catalog-images').createSignedUrl(product.image_path, 3600).then(({ data }) => setStoredImageUrl(data?.signedUrl || ''));
    } else setStoredImageUrl('');
  }, [product?.image_path]);

  useEffect(() => {
    if (!image) { setImagePreview(''); return; }
    const preview = URL.createObjectURL(image);
    setImagePreview(preview);
    return () => URL.revokeObjectURL(preview);
  }, [image]);

  async function submit(publish: boolean) {
    setError('');
    if (!title.trim()) { setError('El título es obligatorio.'); return; }
    if (!categoryId) { setError('Elegí una categoría.'); return; }
    if (publish && !description.trim()) { setError('Completá una descripción para publicar el producto.'); return; }
    if (publish && !image && !product?.image_path) { setError('Agregá una imagen para publicar el producto.'); return; }
    if (stlUrl.trim()) {
      try { const parsed = new URL(stlUrl.trim()); if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(); }
      catch { setError('Ingresá un enlace STL válido (http o https), o adjuntá un archivo.'); return; }
    }
    if (stlUrl.trim() && stlFile) { setError('Elegí un enlace STL o un archivo, no ambos.'); return; }
    setSaving(true);
    try {
      await onSave({
        id, title, description, category_id: categoryId, is_published: publish,
        image, stl_url: stlUrl.trim(), stl_file: stlFile, clear_stl: clearStl,
        previous_image_path: product?.image_path || null, previous_stl_path: privateFile?.stl_path || null,
      });
    } catch (saveError) { setError(errorMessage(saveError)); }
    finally { setSaving(false); }
  }

  const shownImage = imagePreview || storedImageUrl;
  const stlFileName = stlFile?.name || privateFile?.stl_path?.split('/').pop() || '';
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) onClose(); }}><div className="modal catalog-dialog catalog-product-dialog">
    <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Cerrar"><X size={17}/></button>
    <span className="eyebrow">CATÁLOGO · {product ? 'EDITAR' : 'NUEVO'}</span><h2>{product?.title || 'Crear producto'}</h2><p>Los borradores solo son visibles para usuarios administradores. Para publicar, completá título, descripción, categoría e imagen.</p>
    {error && <div className="alert error">{error}</div>}
    <div className="catalog-product-form">
      <label className="field">Título *<input maxLength={180} value={title} onChange={event => setTitle(event.target.value)} placeholder="Nombre del producto"/></label>
      <label className="field">Categoría *<select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">Elegí una categoría</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      <label className="field">Descripción<textarea rows={4} value={description} onChange={event => setDescription(event.target.value)} placeholder="Detalles del producto para mostrar en la web"/></label>
      <label className="field">Imagen del producto <span className="catalog-image-upload">{shownImage ? <img src={shownImage} alt="Vista previa del producto"/> : <span className="catalog-image-placeholder"><ImagePlus size={23}/>JPG, PNG o WebP · máx. 5 MB</span>}<span className="btn tiny secondary"><Upload size={13}/>Elegir imagen<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { setError('Elegí una imagen JPG, PNG o WebP.'); return; } if (file.size > 5 * 1024 * 1024) { setError('La imagen debe pesar hasta 5 MB.'); return; } setError(''); setImage(file); }}/></span></span></label>
      <div className="catalog-private-section"><div><b>Archivo STL privado</b><small>Solo los administradores podrán acceder a este archivo o enlace.</small></div>{stlFileName && !clearStl && <span className="catalog-file-name"><FileBox size={14}/>{stlFileName}</span>}
        <label className="field">Enlace STL<input type="url" value={stlUrl} onChange={event => { setStlUrl(event.target.value); setStlFile(null); setClearStl(false); }} placeholder="https://…"/></label>
        <label className="catalog-stl-upload"><Upload size={14}/>{stlFile ? stlFile.name : 'Adjuntar archivo .STL · máx. 50 MB'}<input type="file" accept=".stl,model/stl,application/sla,application/octet-stream" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (!file.name.toLowerCase().endsWith('.stl')) { setError('El archivo debe tener extensión .stl.'); return; } if (file.size > 50 * 1024 * 1024) { setError('El archivo STL debe pesar hasta 50 MB.'); return; } setError(''); setStlFile(file); setStlUrl(''); setClearStl(false); }}/></label>
        {(privateFile?.stl_path || privateFile?.stl_url || stlFile) && !clearStl && <button type="button" className="catalog-remove-file" onClick={() => { setStlFile(null); setStlUrl(''); setClearStl(true); }}>Quitar enlace o archivo</button>}
      </div>
    </div>
    <div className="catalog-dialog-footer"><button type="button" className="btn secondary" onClick={onClose} disabled={saving || busy}>Cancelar</button><button type="button" className="btn secondary" onClick={() => void submit(false)} disabled={saving || busy}>{saving ? 'Guardando…' : 'Guardar borrador'}</button><button type="button" className="btn primary" onClick={() => void submit(true)} disabled={saving || busy}>{saving ? 'Guardando…' : product?.is_published ? 'Guardar publicado' : 'Publicar'}</button></div>
  </div></div>;
}
