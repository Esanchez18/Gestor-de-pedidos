import type { BusinessSettings } from './business';

export interface QuoteItem { qty: number; description: string; unitPrice: number }
export interface QuoteImage { label: string; dataUrl: string }
export interface QuoteData {
  number: string;
  issueDate: string; // AAAA-MM-DD
  validUntil: string;
  client: { name: string; phone: string; address: string; city: string; cuit: string };
  items: QuoteItem[];
  shipping: number;
  ivaPercent: number;
  depositPercent: number;
  installment: { enabled: boolean; days: number; surchargePercent: number };
  specs: { material: string; color: string; size: string; finish: string };
  productionTime: string;
  paymentMethods: string;
  notes: string;
  terms: string;
  images: QuoteImage[];
}

export function quoteTotals(q: Pick<QuoteData, 'items' | 'shipping' | 'ivaPercent' | 'depositPercent' | 'installment'>) {
  const subtotal = q.items.reduce((s, i) => s + (i.qty || 0) * (i.unitPrice || 0), 0);
  const iva = (subtotal + q.shipping) * (q.ivaPercent || 0) / 100;
  const total = subtotal + q.shipping + iva;
  const deposit = total * (q.depositPercent || 0) / 100;
  const deferred = q.installment.enabled ? total * (1 + (q.installment.surchargePercent || 0) / 100) : 0;
  return { subtotal, iva, total, deposit, deferred };
}

const ars = (v: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 }).format(v || 0);
const fmtDate = (d: string) => d ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T12:00:00Z`)) : '-';

type RGB = [number, number, number];
const INK: RGB = [29, 37, 51];
const MUTED: RGB = [116, 128, 148];
const LINE: RGB = [226, 231, 238];
const SOFT: RGB = [244, 246, 250];
const ACCENT: RGB = [213, 224, 0]; // amarillo Pirañalab
const DARK: RGB = [17, 17, 17];

export async function urlToDataUrl(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('No se pudo descargar la imagen.');
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

// Achica y comprime cada imagen antes de meterla al PDF (las fotos del celular pesan varios MB).
function compactImage(dataUrl: string, maxSide: number, background: string) {
  return new Promise<{ dataUrl: string; w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = background; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), w, h });
    };
    img.onerror = () => reject(new Error('No se pudo leer una imagen.'));
    img.src = dataUrl;
  });
}

export async function buildQuotePdf(q: QuoteData, biz: BusinessSettings, logoDataUrl: string | null): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const W = 210, H = 297, M = 16, CW = W - M * 2;
  const FOOTER = 18;
  let y = M;

  const color = (c: RGB) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: RGB) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: RGB) => doc.setDrawColor(c[0], c[1], c[2]);
  const font = (style: 'normal' | 'bold', size: number, c: RGB = INK) => { doc.setFont('helvetica', style); doc.setFontSize(size); color(c); };
  const ensure = (space: number) => { if (y + space > H - FOOTER) { doc.addPage(); y = M; } };
  const totals = quoteTotals(q);

  // ── Encabezado ──────────────────────────────────────────
  const logoH = 22, logoW = 62;
  fill(DARK); doc.roundedRect(M, y, logoW, logoH, 2.5, 2.5, 'F');
  if (logoDataUrl) {
    const s = await compactImage(logoDataUrl, 900, '#111111');
    const maxW = logoW - 8, maxH = logoH - 6;
    const k = Math.min(maxW / s.w, maxH / s.h);
    doc.addImage(s.dataUrl, 'JPEG', M + (logoW - s.w * k) / 2, y + (logoH - s.h * k) / 2, s.w * k, s.h * k);
  } else {
    font('bold', 16, ACCENT); doc.text(biz.name, M + logoW / 2, y + logoH / 2 + 2, { align: 'center' });
  }

  const right = W - M;
  let hy = y + 4;
  font('bold', 13); doc.text(biz.name, right, hy, { align: 'right' }); hy += 5;
  if (biz.tagline) { font('normal', 8.5, MUTED); doc.text(biz.tagline, right, hy, { align: 'right' }); hy += 4.5; }
  const contact = [
    biz.owner && `Titular: ${biz.owner}`,
    [biz.address, [biz.postalCode && `(${biz.postalCode})`, biz.city].filter(Boolean).join(' '), biz.province].filter(Boolean).join(', '),
    biz.whatsapp && `WhatsApp ${biz.whatsapp}`,
    [biz.instagram && `Instagram ${biz.instagram}`, biz.email, biz.website].filter(Boolean).join('  ·  '),
    [biz.cuit && `CUIT ${biz.cuit}`, biz.ivaCondition].filter(Boolean).join('  ·  '),
  ].filter(Boolean) as string[];
  font('normal', 8.5);
  contact.forEach(line => { doc.text(line, right, hy, { align: 'right' }); hy += 4.2; });
  y = Math.max(y + logoH, hy) + 4;
  fill(ACCENT); doc.rect(M, y, CW, 1.2, 'F');
  y += 9;

  // ── Título y datos del presupuesto ──────────────────────
  font('bold', 22); doc.text('PRESUPUESTO', M, y + 4);
  font('normal', 9, MUTED); doc.text('Impresión 3D a medida', M, y + 10);
  const boxW = 70, boxX = right - boxW;
  fill(SOFT); doc.roundedRect(boxX, y - 4, boxW, 20, 2, 2, 'F');
  const meta: [string, string][] = [['N.º', q.number], ['Fecha', fmtDate(q.issueDate)], ['Válido hasta', fmtDate(q.validUntil)]];
  meta.forEach(([k, v], i) => {
    font('normal', 8.5, MUTED); doc.text(k, boxX + 4, y + 1.5 + i * 5.5);
    font('bold', 9); doc.text(v, boxX + boxW - 4, y + 1.5 + i * 5.5, { align: 'right' });
  });
  y += 22;

  // ── Cliente ─────────────────────────────────────────────
  const clientRows: [string, string][] = [
    ['Cliente', q.client.name || '-'],
    ['Teléfono', q.client.phone],
    ['Dirección', [q.client.address, q.client.city].filter(Boolean).join(', ')],
    ['CUIT', q.client.cuit],
  ].filter(([, v]) => v) as [string, string][];
  const clientH = 9 + Math.ceil(clientRows.length / 2) * 6;
  stroke(LINE); doc.setLineWidth(0.3); doc.roundedRect(M, y, CW, clientH, 2, 2, 'S');
  font('bold', 7.5, MUTED); doc.text('DATOS DEL CLIENTE', M + 5, y + 5.5);
  clientRows.forEach(([k, v], i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = M + 5 + col * (CW / 2);
    font('normal', 8.5, MUTED); doc.text(`${k}:`, x, y + 11 + row * 6);
    font(k === 'Cliente' ? 'bold' : 'normal', 9.5); doc.text(doc.splitTextToSize(v, CW / 2 - 30)[0], x + 18, y + 11 + row * 6);
  });
  y += clientH + 8;

  // ── Ítems ───────────────────────────────────────────────
  const cols = { qty: M + 4, desc: M + 22, unit: right - 34, sub: right - 4 };
  const headerRow = () => {
    fill(INK); doc.rect(M, y, CW, 8, 'F');
    font('bold', 8.5, [255, 255, 255]);
    doc.text('CANT.', cols.qty, y + 5.3);
    doc.text('DESCRIPCIÓN', cols.desc, y + 5.3);
    doc.text('P. UNITARIO', cols.unit, y + 5.3, { align: 'right' });
    doc.text('SUBTOTAL', cols.sub, y + 5.3, { align: 'right' });
    y += 8;
  };
  ensure(20); headerRow();
  q.items.forEach((item, i) => {
    font('normal', 9.5);
    const lines = doc.splitTextToSize(item.description || '-', cols.unit - cols.desc - 30) as string[];
    const rowH = Math.max(9, 4 + lines.length * 4.6);
    if (y + rowH > H - FOOTER) { doc.addPage(); y = M; headerRow(); }
    if (i % 2 === 1) { fill(SOFT); doc.rect(M, y, CW, rowH, 'F'); }
    font('bold', 9.5); doc.text(String(item.qty), cols.qty + 3, y + 6, { align: 'center' });
    font('normal', 9.5); doc.text(lines, cols.desc, y + 6);
    doc.text(ars(item.unitPrice), cols.unit, y + 6, { align: 'right' });
    font('bold', 9.5); doc.text(ars(item.qty * item.unitPrice), cols.sub, y + 6, { align: 'right' });
    y += rowH;
  });
  stroke(LINE); doc.line(M, y, right, y);
  y += 6;

  // ── Especificaciones (izq.) y totales (der.) ────────────
  const specs = ([['Material', q.specs.material], ['Color', q.specs.color], ['Medidas', q.specs.size], ['Terminación', q.specs.finish]] as [string, string][]).filter(([, v]) => v);
  const totalRows: [string, number][] = [['Subtotal', totals.subtotal]];
  if (q.shipping) totalRows.push(['Envío', q.shipping]);
  if (q.ivaPercent) totalRows.push([`IVA ${q.ivaPercent}%`, totals.iva]);
  const totalsH = totalRows.length * 6 + 14;
  const specsH = specs.length ? 9 + specs.length * 5.5 : 0;
  ensure(Math.max(totalsH, specsH) + 4);
  const top = y;
  if (specs.length) {
    const sw = CW - 84;
    fill(SOFT); doc.roundedRect(M, top, sw, specsH, 2, 2, 'F');
    font('bold', 7.5, MUTED); doc.text('ESPECIFICACIONES', M + 5, top + 6);
    specs.forEach(([k, v], i) => {
      font('normal', 8.5, MUTED); doc.text(`${k}:`, M + 5, top + 12 + i * 5.5);
      font('normal', 9); doc.text(doc.splitTextToSize(v, sw - 32)[0], M + 28, top + 12 + i * 5.5);
    });
  }
  const tx = right - 78;
  let ty = top + 4;
  totalRows.forEach(([k, v]) => {
    font('normal', 9.5, MUTED); doc.text(k, tx, ty);
    font('normal', 9.5); doc.text(ars(v), right - 2, ty, { align: 'right' });
    ty += 6;
  });
  fill(ACCENT); doc.roundedRect(tx - 4, ty - 2, 82, 11, 2, 2, 'F');
  font('bold', 10.5, DARK); doc.text('TOTAL', tx, ty + 5.2);
  font('bold', 13, DARK); doc.text(ars(totals.total), right - 2, ty + 5.4, { align: 'right' });
  y = Math.max(top + specsH, ty + 11) + 9;

  // ── Formas de pago ──────────────────────────────────────
  const payCards: { title: string; amount: number; note: string; highlight?: boolean }[] = [];
  payCards.push({ title: q.installment.enabled ? 'Pago a la entrega' : 'Precio final', amount: totals.total, note: q.depositPercent ? `Seña ${q.depositPercent}% para comenzar: ${ars(totals.deposit)}` : 'Pago al confirmar', highlight: true });
  if (q.installment.enabled) {
    payCards.push({ title: `Pago a ${q.installment.days} días de la entrega`, amount: totals.deferred, note: q.installment.surchargePercent ? `Incluye ${q.installment.surchargePercent}% por pago diferido` : 'Mismo precio' });
  }
  ensure(28);
  font('bold', 7.5, MUTED); doc.text('OPCIONES DE PAGO', M, y); y += 3;
  const cw = (CW - 6 * (payCards.length - 1)) / payCards.length;
  payCards.forEach((c, i) => {
    const x = M + i * (cw + 6);
    stroke(c.highlight ? INK : LINE); doc.setLineWidth(c.highlight ? 0.5 : 0.3);
    doc.roundedRect(x, y, cw, 20, 2, 2, 'S');
    font('normal', 8.5, MUTED); doc.text(c.title, x + 5, y + 6);
    font('bold', 14); doc.text(ars(c.amount), x + 5, y + 13);
    font('normal', 8, MUTED); doc.text(c.note, x + 5, y + 17.5);
  });
  doc.setLineWidth(0.3);
  y += 28;

  // ── Imágenes del producto ───────────────────────────────
  if (q.images.length) {
    const perRow = q.images.length === 1 ? 1 : 2;
    const gap = 6;
    const cellW = (CW - gap * (perRow - 1)) / perRow;
    const cellH = perRow === 1 ? 95 : 62;
    ensure(cellH + 14);
    font('bold', 7.5, MUTED); doc.text('IMÁGENES DEL PRODUCTO', M, y); y += 3;
    for (let i = 0; i < q.images.length; i++) {
      const col = i % perRow;
      if (col === 0 && i > 0) { y += cellH + 9; }
      if (col === 0) ensure(cellH + 8);
      const x = M + col * (cellW + gap);
      fill(SOFT); doc.roundedRect(x, y, cellW, cellH, 2, 2, 'F');
      const img = q.images[i];
      try {
        const s = await compactImage(img.dataUrl, 1400, '#f4f6fa');
        const k = Math.min((cellW - 4) / s.w, (cellH - 4) / s.h);
        doc.addImage(s.dataUrl, 'JPEG', x + (cellW - s.w * k) / 2, y + (cellH - s.h * k) / 2, s.w * k, s.h * k);
      } catch { /* imagen ilegible: se deja el recuadro */ }
      font('normal', 8, MUTED); doc.text(img.label, x + 2, y + cellH + 4.5);
    }
    y += cellH + 11;
  }

  // ── Condiciones ─────────────────────────────────────────
  const conditions: [string, string][] = ([
    ['Validez', `Este presupuesto es válido hasta el ${fmtDate(q.validUntil)}.`],
    ['Plazo de producción', q.productionTime],
    ['Formas de pago', q.paymentMethods],
    ['Datos para transferir', [biz.alias && `Alias: ${biz.alias}`, biz.cbu && `CBU: ${biz.cbu}`, biz.owner && `Titular: ${biz.owner}`].filter(Boolean).join('  ·  ')],
    ['Observaciones', q.notes],
  ] as [string, string][]).filter(([, v]) => v && v.trim());
  const termLines = q.terms.split('\n').map(t => t.trim()).filter(Boolean);
  ensure(20);
  font('bold', 7.5, MUTED); doc.text('CONDICIONES', M, y); y += 5;
  conditions.forEach(([k, v]) => {
    const lines = doc.splitTextToSize(v, CW - 45) as string[];
    ensure(lines.length * 4.5 + 2);
    font('bold', 9); doc.text(k, M, y);
    font('normal', 9); doc.text(lines, M + 45, y);
    y += lines.length * 4.5 + 1.5;
  });
  if (termLines.length) {
    y += 1.5;
    termLines.forEach(t => {
      const lines = doc.splitTextToSize(t, CW - 5) as string[];
      ensure(lines.length * 4.2 + 1);
      font('normal', 8.5, MUTED); doc.text('•', M + 1, y); doc.text(lines, M + 5, y);
      y += lines.length * 4.2 + 0.8;
    });
  }

  // ── Pie en todas las páginas ────────────────────────────
  const pages = doc.getNumberOfPages();
  const footer = [biz.name, biz.whatsapp && `WhatsApp ${biz.whatsapp}`, biz.instagram, [biz.city, biz.province].filter(Boolean).join(', ')].filter(Boolean).join('   ·   ');
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    fill(ACCENT); doc.rect(M, H - 13, CW, 0.6, 'F');
    font('normal', 7.5, MUTED);
    doc.text(footer, M, H - 8.5);
    doc.text(`${q.number}  ·  Página ${p} de ${pages}`, right, H - 8.5, { align: 'right' });
  }

  doc.setProperties({ title: `Presupuesto ${q.number} - ${q.client.name}`, author: biz.name, subject: 'Presupuesto de impresión 3D', creator: biz.name });
  return doc.output('blob');
}
