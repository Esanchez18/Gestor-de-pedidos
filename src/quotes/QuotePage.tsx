import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, Box, Download, ImagePlus, Loader2, Plus, Share2, Trash2, X } from 'lucide-react';
import type { Customer, Order } from '../types';
import { supabase } from '../lib/supabase';
import { DEFAULT_BUSINESS, loadBusiness, type BusinessSettings } from './business';
import { buildQuotePdf, quoteTotals, urlToDataUrl, type QuoteData, type QuoteImage, type QuoteItem } from './pdf';
import './quotes.css';

export const CALCULATOR_DRAFT_KEY = 'piranalab-quote-draft';
export interface CalculatorDraft { client: string; product: string; unitPrice: number; shipping: number; ivaPercent: number; material: string }

const tz = 'America/Argentina/Buenos_Aires';
const todayAR = () => new Date().toLocaleDateString('en-CA', { timeZone: tz });
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ars = (v: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(v || 0);
const toNum = (v: string) => { const t = v.trim(); if (!t) return 0; if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.')) || 0; return Number(t) || 0; };
const round2 = (n: number) => Math.round(n * 100) / 100;

const COLORS: { name: string; hex: string }[] = [
  { name: 'Blanco', hex: '#f2f2ee' }, { name: 'Negro', hex: '#2a2a2e' }, { name: 'Gris', hex: '#8d939c' },
  { name: 'Rojo', hex: '#d33a2f' }, { name: 'Azul', hex: '#2f63c9' }, { name: 'Verde', hex: '#2f9a55' },
  { name: 'Amarillo', hex: '#f0c419' }, { name: 'Dorado', hex: '#c9a227' }, { name: 'Plateado', hex: '#b8bec6' },
];

type ItemDraft = { qty: string; description: string; unitPrice: string };
type ImageDraft = QuoteImage & { id: string; include: boolean };

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
}

export default function QuotePage({ orders, customers, signedImage }: { orders: Order[]; customers: Customer[]; signedImage: (path: string) => Promise<string | null> }) {
  const [params] = useSearchParams();
  const order = orders.find(o => o.id === params.get('pedido')) || null;
  const [biz, setBiz] = useState<BusinessSettings>(DEFAULT_BUSINESS);
  const [bizMissing, setBizMissing] = useState(false);

  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [clientAddress, setClientAddress] = useState('');
  const [clientCity, setClientCity] = useState('');
  const [clientCuit, setClientCuit] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([{ qty: '1', description: '', unitPrice: '' }]);
  const [shipping, setShipping] = useState('');
  const [ivaPercent, setIvaPercent] = useState('0');
  const [material, setMaterial] = useState('');
  const [colorName, setColorName] = useState('');
  const [size, setSize] = useState('');
  const [finish, setFinish] = useState('');
  const [depositPercent, setDepositPercent] = useState('50');
  const [deferred, setDeferred] = useState(false);
  const [deferredDays, setDeferredDays] = useState('45');
  const [surcharge, setSurcharge] = useState('10');
  const [validityDays, setValidityDays] = useState('15');
  const [productionTime, setProductionTime] = useState(DEFAULT_BUSINESS.productionTime);
  const [paymentMethods, setPaymentMethods] = useState(DEFAULT_BUSINESS.paymentMethods);
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState(DEFAULT_BUSINESS.terms);
  const [images, setImages] = useState<ImageDraft[]>([]);

  const [stlFile, setStlFile] = useState<File | null>(null);
  const [viewChoice, setViewChoice] = useState<boolean[]>(() => [true, true, true, true, false, true]);
  const [stlColor, setStlColor] = useState('#c9a227');
  const [rendering, setRendering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saved, setSaved] = useState<{ id: string | null; number: string } | null>(null);

  // Datos del negocio y condiciones por defecto.
  useEffect(() => {
    void loadBusiness().then(({ data, missingTable }) => {
      setBiz(data); setBizMissing(missingTable);
      setDepositPercent(String(data.depositPercent)); setValidityDays(String(data.validityDays));
      setProductionTime(data.productionTime); setPaymentMethods(data.paymentMethods); setTerms(data.terms);
    });
  }, []);

  // Precarga desde un pedido o desde la calculadora.
  useEffect(() => {
    if (order) {
      const customer = customers.find(c => c.id === order.customer_id);
      setClientName(customer?.name || order.customer_name || '');
      setClientPhone(customer?.phone || '');
      setClientAddress(order.delivery_address || '');
      setClientCity(order.delivery_locality || '');
      const ship = Number(order.shipping_cost || 0);
      const qty = Math.max(1, order.quantity || 1);
      const net = Math.max(0, Number(order.quoted_price || 0) - ship);
      setItems([{ qty: String(qty), description: [order.product_name, order.description].filter(Boolean).join(' - '), unitPrice: net ? String(round2(net / qty)).replace('.', ',') : '' }]);
      setShipping(ship ? String(ship).replace('.', ',') : '');
      setMaterial(order.materials || '');
      setColorName(order.colors || '');
      if (order.reference_image_path) {
        void signedImage(order.reference_image_path).then(async url => {
          if (!url) return;
          try { const dataUrl = await urlToDataUrl(url); setImages(list => list.some(i => i.id === 'ref') ? list : [{ id: 'ref', label: 'Imagen de referencia', dataUrl, include: true }, ...list]); } catch { /* sin imagen */ }
        });
      }
      return;
    }
    try {
      const raw = sessionStorage.getItem(CALCULATOR_DRAFT_KEY);
      if (!raw) return;
      sessionStorage.removeItem(CALCULATOR_DRAFT_KEY);
      const d = JSON.parse(raw) as CalculatorDraft;
      setClientName(d.client || '');
      setItems([{ qty: '1', description: d.product || '', unitPrice: d.unitPrice ? String(round2(d.unitPrice)).replace('.', ',') : '' }]);
      setShipping(d.shipping ? String(round2(d.shipping)).replace('.', ',') : '');
      setIvaPercent(String(d.ivaPercent || 0));
      setMaterial(d.material || '');
    } catch { /* borrador inválido */ }
  }, [order?.id]);

  const parsedItems: QuoteItem[] = items.map(i => ({ qty: Math.max(0, Math.round(toNum(i.qty))), description: i.description.trim(), unitPrice: toNum(i.unitPrice) })).filter(i => i.description || i.unitPrice);
  const installment = { enabled: deferred, days: Math.max(1, Math.round(toNum(deferredDays))), surchargePercent: toNum(surcharge) };
  const totals = useMemo(() => quoteTotals({ items: parsedItems, shipping: toNum(shipping), ivaPercent: toNum(ivaPercent), depositPercent: toNum(depositPercent), installment }), [items, shipping, ivaPercent, depositPercent, deferred, deferredDays, surcharge]);
  const validUntil = addDays(todayAR(), Math.max(0, Math.round(toNum(validityDays))));

  function updateItem(index: number, patch: Partial<ItemDraft>) { setItems(list => list.map((it, i) => i === index ? { ...it, ...patch } : it)); }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 6)) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { setError('Las fotos tienen que ser JPG, PNG o WEBP.'); continue; }
      const dataUrl = await readFileAsDataUrl(file);
      setImages(list => [...list, { id: crypto.randomUUID(), label: file.name.replace(/\.[^.]+$/, ''), dataUrl, include: true }]);
    }
  }

  async function renderViews() {
    if (!stlFile) return;
    setRendering(true); setError('');
    try {
      const { renderModel } = await import('./stlRender');
      if (!viewChoice.some(Boolean)) { setError('Elegí al menos un ángulo.'); return; }
      const result = await renderModel(stlFile, stlColor);
      const picked = result.views.filter((_, i) => viewChoice[i] ?? true);
      setImages(list => [
        ...list.filter(i => !i.id.startsWith('stl-') && !i.id.startsWith('slicer-')),
        ...picked.map((v, i) => ({ id: `stl-${i}`, label: `Vista ${v.label.toLowerCase()}`, dataUrl: v.dataUrl, include: true })),
        ...result.thumbnails.map((t, i) => ({ id: `slicer-${i}`, label: result.thumbnails.length > 1 ? `Vista previa del laminador (placa ${i + 1})` : 'Vista previa del laminador', dataUrl: t.dataUrl, include: false })),
      ]);
      const f = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 1 });
      if (!size) setSize(`${f(result.size.x)} × ${f(result.size.y)} × ${f(result.size.z)} mm`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron generar las vistas del STL.');
    } finally { setRendering(false); }
  }

  function validate() {
    if (!clientName.trim()) return 'Completá el nombre del cliente.';
    if (!parsedItems.length) return 'Agregá al menos un ítem con descripción y precio.';
    if (parsedItems.some(i => !i.qty)) return 'Cada ítem necesita una cantidad mayor a cero.';
    if (totals.total <= 0) return 'El total del presupuesto tiene que ser mayor a cero.';
    return '';
  }

  async function generate(mode: 'download' | 'share') {
    const problem = validate();
    if (problem) { setError(problem); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const draft: Omit<QuoteData, 'number'> = {
        issueDate: todayAR(), validUntil,
        client: { name: clientName.trim(), phone: clientPhone.trim(), address: clientAddress.trim(), city: clientCity.trim(), cuit: clientCuit.trim() },
        items: parsedItems, shipping: toNum(shipping), ivaPercent: toNum(ivaPercent), depositPercent: toNum(depositPercent), installment,
        specs: { material: material.trim(), color: colorName.trim(), size: size.trim(), finish: finish.trim() },
        productionTime: productionTime.trim(), paymentMethods: paymentMethods.trim(), notes: notes.trim(), terms,
        images: images.filter(i => i.include).map(({ label, dataUrl }) => ({ label, dataUrl })),
      };
      // Guarda el presupuesto para obtener un número correlativo (sin las imágenes).
      let current = saved;
      const record = { order_id: order?.id || null, customer_name: draft.client.name, total: round2(totals.total), valid_until: validUntil, data: { ...draft, images: draft.images.map(i => i.label) } };
      if (supabase && !current) {
        const { data, error } = await supabase.from('quotes').insert(record).select('id,quote_number').single();
        if (error) {
          if (!['PGRST205', '42P01'].includes(String(error.code))) throw error;
          const stamp = new Date().toLocaleString('sv-SE', { timeZone: tz }).replace(/\D/g, '').slice(2, 12);
          current = { id: null, number: `PRES-${stamp}` };
          setNotice('El presupuesto se generó, pero no se guardó en la base: falta ejecutar 008_quotes.sql. Se usó un número provisorio.');
        } else current = { id: data.id, number: data.quote_number };
        setSaved(current);
      } else if (supabase && current?.id) {
        await supabase.from('quotes').update(record).eq('id', current.id);
      }
      const number = current?.number || 'PRES-BORRADOR';
      let logo: string | null = null;
      try { logo = await urlToDataUrl(new URL('./brand/wordmark.png', document.baseURI).href); } catch { /* sin logo */ }
      const blob = await buildQuotePdf({ ...draft, number }, biz, logo);
      const fileName = `Presupuesto ${number} - ${draft.client.name}.pdf`.replace(/[\\/:*?"<>|]/g, '');
      const file = new File([blob], fileName, { type: 'application/pdf' });
      if (mode === 'share' && navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: `Presupuesto ${number}`, text: `Hola ${draft.client.name}, te paso el presupuesto ${number} de ${biz.name}.` }); }
        catch (e) { if ((e as Error).name !== 'AbortError') throw e; }
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    } catch (e) {
      const err = e as { message?: string };
      setError(err?.message || 'No se pudo generar el PDF.');
    } finally { setBusy(false); }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  return <>
    <div className="page-title">
      <div><span className="eyebrow">VENTAS</span><h1>Nuevo presupuesto</h1><p>{order ? <>Basado en el pedido <Link to={`/pedidos/${order.id}`}>{order.order_number}</Link>. Revisá los datos antes de enviarlo.</> : 'Cargá el precio que vos definiste para cada producto: no hace falta usar la calculadora. Después descargá el PDF o compartilo.'}</p></div>
    </div>
    {bizMissing && <div className="alert quote-warning"><AlertCircle size={16}/>Para guardar presupuestos numerados y tus datos del negocio, ejecutá <b>008_quotes.sql</b> en Supabase. Mientras tanto se usan los datos por defecto.</div>}
    {error && <div className="alert error quote-alert"><AlertCircle size={16}/>{error}<button className="icon-btn" onClick={() => setError('')} aria-label="Cerrar"><X size={15}/></button></div>}
    {notice && <div className="alert quote-warning"><AlertCircle size={16}/>{notice}</div>}

    <div className="quote-layout">
      <div className="quote-form">
        <section className="quote-card">
          <h2>Cliente</h2>
          {!order && customers.length > 0 && <label className="field">Elegir cliente guardado
            <select value="" onChange={e => { const c = customers.find(x => x.id === e.target.value); if (c) { setClientName(c.name); setClientPhone(c.phone || ''); } }}>
              <option value="">— Seleccionar —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>}
          <div className="field-grid">
            <label className="field">Nombre o razón social *<input value={clientName} onChange={e => setClientName(e.target.value)}/></label>
            <label className="field">Teléfono<input value={clientPhone} onChange={e => setClientPhone(e.target.value)}/></label>
            <label className="field">Dirección<input value={clientAddress} onChange={e => setClientAddress(e.target.value)}/></label>
            <label className="field">Localidad<input value={clientCity} onChange={e => setClientCity(e.target.value)}/></label>
            <label className="field">CUIT (opcional)<input value={clientCuit} onChange={e => setClientCuit(e.target.value)} placeholder="Para empresas o municipios"/></label>
          </div>
        </section>

        <section className="quote-card">
          <h2>Productos</h2>
          <div className="quote-items">
            {items.map((it, i) => <div className="quote-item" key={i}>
              <label className="field quote-qty">Cant.<input inputMode="numeric" value={it.qty} onChange={e => updateItem(i, { qty: e.target.value })}/></label>
              <label className="field quote-desc">Descripción<textarea rows={2} value={it.description} onChange={e => updateItem(i, { description: e.target.value })} placeholder="Ej.: Trofeo personalizado 15 cm, color dorado"/></label>
              <label className="field quote-price">Precio unitario<span className="input-prefix"><span>$</span><input inputMode="decimal" value={it.unitPrice} onChange={e => updateItem(i, { unitPrice: e.target.value })} placeholder="0,00"/></span></label>
              <button type="button" className="icon-btn danger-icon quote-remove" title="Quitar ítem" disabled={items.length === 1} onClick={() => setItems(list => list.filter((_, j) => j !== i))}><Trash2 size={15}/></button>
            </div>)}
          </div>
          <button type="button" className="btn secondary" onClick={() => setItems(list => [...list, { qty: '1', description: '', unitPrice: '' }])}><Plus size={15}/>Agregar ítem</button>
          <div className="field-grid quote-extra">
            <label className="field">Envío<span className="input-prefix"><span>$</span><input inputMode="decimal" value={shipping} onChange={e => setShipping(e.target.value)} placeholder="0,00"/></span></label>
            <label className="field">IVA %<input inputMode="decimal" value={ivaPercent} onChange={e => setIvaPercent(e.target.value)}/></label>
          </div>
          {order && <p className="quote-hint">El precio del pedido ya incluye IVA si lo calculaste en la calculadora. Dejá IVA en 0 para no sumarlo dos veces.</p>}
        </section>

        <section className="quote-card">
          <h2>Especificaciones</h2>
          <div className="field-grid">
            <label className="field">Material<input value={material} onChange={e => setMaterial(e.target.value)} placeholder="PLA, PETG, resina…"/></label>
            <label className="field">Color<input value={colorName} onChange={e => setColorName(e.target.value)} placeholder="Dorado"/></label>
            <label className="field">Medidas<input value={size} onChange={e => setSize(e.target.value)} placeholder="Se completa solo con el STL"/></label>
            <label className="field">Terminación<input value={finish} onChange={e => setFinish(e.target.value)} placeholder="Lijado, pintado, sin postproceso…"/></label>
          </div>
        </section>

        <section className="quote-card">
          <h2>Imágenes</h2>
          <div className="quote-stl">
            <label className="quote-file"><Box size={18}/><span>{stlFile ? stlFile.name : 'Elegir archivo STL o 3MF'}</span><input type="file" onChange={e => { const f = e.target.files?.[0] || null; if (f && !/\.(stl|3mf)$/i.test(f.name)) { setError(`«${f.name}» no es un archivo 3D. Elegí un .stl o .3mf.`); e.target.value = ''; return; } setError(''); setStlFile(f); }}/></label>
            <div className="quote-colors" role="radiogroup" aria-label="Color del modelo">
              {COLORS.map(c => <button type="button" key={c.hex} role="radio" aria-checked={stlColor === c.hex} title={c.name} className={stlColor === c.hex ? 'active' : ''} style={{ background: c.hex }} onClick={() => { setStlColor(c.hex); if (!colorName) setColorName(c.name); }}/>)}
              <label className="quote-color-custom" title="Otro color"><input type="color" value={stlColor} onChange={e => setStlColor(e.target.value)}/></label>
            </div>
            <button type="button" className="btn primary" disabled={!stlFile || rendering} onClick={() => void renderViews()}>{rendering ? <><Loader2 size={15} className="spin"/>Generando…</> : 'Generar vistas'}</button>
          </div>
          <div className="quote-angles" role="group" aria-label="Ángulos a generar"><span>Ángulos:</span>{['Perspectiva frontal', 'Perspectiva posterior', 'Frente', 'Lateral', 'Atrás', 'Superior'].map((name, i) => <label key={name}><input type="checkbox" checked={viewChoice[i]} onChange={e => setViewChoice(v => v.map((x, j) => j === i ? e.target.checked : x))}/>{name}</label>)}</div>
          <p className="quote-hint">Subí el .stl o el .3mf (Bambu Studio, OrcaSlicer, PrusaSlicer…) desde tu computadora o celular. Con un link de Drive no funciona: el navegador no puede leerlo. Si el 3MF trae la vista previa del laminador, aparece abajo para que la incluyas si querés.</p>
          <div className="quote-images">
            {images.map(img => <figure key={img.id} className={img.include ? '' : 'off'}>
              <img src={img.dataUrl} alt={img.label}/>
              <figcaption>
                <label><input type="checkbox" checked={img.include} onChange={e => setImages(list => list.map(i => i.id === img.id ? { ...i, include: e.target.checked } : i))}/>Incluir</label>
                <input className="quote-img-label" value={img.label} onChange={e => setImages(list => list.map(i => i.id === img.id ? { ...i, label: e.target.value } : i))} aria-label="Título de la imagen"/>
                <button type="button" className="icon-btn" title="Quitar" onClick={() => setImages(list => list.filter(i => i.id !== img.id))}><X size={14}/></button>
              </figcaption>
            </figure>)}
            <label className="quote-add-photo"><ImagePlus size={20}/><span>Agregar fotos</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e => { void addPhotos(e.target.files); e.target.value = ''; }}/></label>
          </div>
        </section>

        <section className="quote-card">
          <h2>Pago y condiciones</h2>
          <div className="field-grid">
            <label className="field">Seña %<input inputMode="decimal" value={depositPercent} onChange={e => setDepositPercent(e.target.value)}/></label>
            <label className="field">Validez (días)<input inputMode="numeric" value={validityDays} onChange={e => setValidityDays(e.target.value)}/></label>
          </div>
          <label className="quote-toggle"><input type="checkbox" checked={deferred} onChange={e => setDeferred(e.target.checked)}/>Ofrecer también pago diferido (para este cliente)</label>
          {deferred && <div className="field-grid">
            <label className="field">Días después de la entrega<input inputMode="numeric" value={deferredDays} onChange={e => setDeferredDays(e.target.value)}/></label>
            <label className="field">Recargo %<input inputMode="decimal" value={surcharge} onChange={e => setSurcharge(e.target.value)}/></label>
          </div>}
          <label className="field">Plazo de producción<input value={productionTime} onChange={e => setProductionTime(e.target.value)}/></label>
          <label className="field">Formas de pago<input value={paymentMethods} onChange={e => setPaymentMethods(e.target.value)}/></label>
          <label className="field">Observaciones para este cliente<textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}/></label>
          <label className="field">Condiciones (una por línea)<textarea rows={4} value={terms} onChange={e => setTerms(e.target.value)}/></label>
        </section>
      </div>

      <aside className="quote-summary">
        <span className="eyebrow">RESUMEN</span>
        <div className="quote-sum-row"><span>Subtotal</span><b>{ars(totals.subtotal)}</b></div>
        {toNum(shipping) > 0 && <div className="quote-sum-row"><span>Envío</span><b>{ars(toNum(shipping))}</b></div>}
        {toNum(ivaPercent) > 0 && <div className="quote-sum-row"><span>IVA {toNum(ivaPercent)}%</span><b>{ars(totals.iva)}</b></div>}
        <div className="quote-sum-total"><span>Total</span><strong>{ars(totals.total)}</strong></div>
        {toNum(depositPercent) > 0 && <div className="quote-sum-row"><span>Seña {toNum(depositPercent)}%</span><b>{ars(totals.deposit)}</b></div>}
        {deferred && <div className="quote-sum-row"><span>A {installment.days} días</span><b>{ars(totals.deferred)}</b></div>}
        <div className="quote-sum-row"><span>Válido hasta</span><b>{new Intl.DateTimeFormat('es-AR', { timeZone: 'UTC' }).format(new Date(`${validUntil}T12:00:00Z`))}</b></div>
        <div className="quote-sum-row"><span>Imágenes</span><b>{images.filter(i => i.include).length}</b></div>
        {saved && <div className="quote-sum-row"><span>Número</span><b>{saved.number}</b></div>}
        <button className="btn primary wide" disabled={busy} onClick={() => void generate('download')}>{busy ? <><Loader2 size={16} className="spin"/>Generando…</> : <><Download size={16}/>Descargar PDF</>}</button>
        {canShare && <button className="btn secondary wide" disabled={busy} onClick={() => void generate('share')}><Share2 size={16}/>Compartir (WhatsApp…)</button>}
        <p className="quote-hint">Tus datos del negocio se editan en <Link to="/configuracion">Configuración</Link>.</p>
      </aside>
    </div>
  </>;
}
