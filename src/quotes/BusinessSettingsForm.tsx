import { useEffect, useState } from 'react';
import { AlertCircle, Check } from 'lucide-react';
import { DEFAULT_BUSINESS, loadBusiness, saveBusiness, type BusinessSettings } from './business';
import './quotes.css';

type TextKey = Exclude<keyof BusinessSettings, 'validityDays' | 'depositPercent'>;

const FIELDS: { key: TextKey; label: string; placeholder?: string }[] = [
  { key: 'name', label: 'Nombre comercial' },
  { key: 'tagline', label: 'Frase o rubro' },
  { key: 'owner', label: 'Titular' },
  { key: 'cuit', label: 'CUIT', placeholder: '20-12345678-9' },
  { key: 'ivaCondition', label: 'Condición frente al IVA', placeholder: 'Monotributista' },
  { key: 'address', label: 'Dirección', placeholder: 'Calle y número (opcional)' },
  { key: 'city', label: 'Localidad' },
  { key: 'postalCode', label: 'Código postal' },
  { key: 'province', label: 'Provincia' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'email', label: 'Email' },
  { key: 'website', label: 'Web' },
  { key: 'alias', label: 'Alias para transferir' },
  { key: 'cbu', label: 'CBU / CVU' },
];

export default function BusinessSettingsForm() {
  const [data, setData] = useState<BusinessSettings>(DEFAULT_BUSINESS);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { void loadBusiness().then(r => { setData(r.data); setMissing(r.missingTable); }); }, []);
  const set = <K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) => { setData(d => ({ ...d, [key]: value })); setStatus(null); };

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setStatus(null);
    try { await saveBusiness(data); setStatus({ ok: true, text: 'Datos guardados. Se usan en los próximos presupuestos.' }); }
    catch (err) {
      const code = (err as { code?: string }).code;
      setStatus({ ok: false, text: code === 'PGRST205' || code === '42P01' ? 'Falta ejecutar 008_quotes.sql en Supabase para poder guardar estos datos.' : (err as Error).message || 'No se pudo guardar.' });
    } finally { setBusy(false); }
  }

  return <form className="quote-card business-form" onSubmit={save}>
    <span className="eyebrow">PRESUPUESTOS</span>
    <h2>Datos del negocio</h2>
    <p className="quote-hint">Aparecen en el encabezado, las condiciones y el pie de cada presupuesto en PDF.</p>
    {missing && <div className="alert quote-warning"><AlertCircle size={16}/>Ejecutá 008_quotes.sql en Supabase para guardar estos datos. Mientras tanto se usan los valores por defecto.</div>}
    <div className="field-grid">
      {FIELDS.map(f => <label className="field" key={f.key}>{f.label}<input value={data[f.key]} placeholder={f.placeholder} onChange={e => set(f.key, e.target.value)}/></label>)}
      <label className="field">Validez por defecto (días)<input type="number" min={1} value={data.validityDays} onChange={e => set('validityDays', Number(e.target.value) || 0)}/></label>
      <label className="field">Seña por defecto (%)<input type="number" min={0} max={100} value={data.depositPercent} onChange={e => set('depositPercent', Number(e.target.value) || 0)}/></label>
    </div>
    <label className="field">Plazo de producción<input value={data.productionTime} onChange={e => set('productionTime', e.target.value)}/></label>
    <label className="field">Formas de pago<input value={data.paymentMethods} onChange={e => set('paymentMethods', e.target.value)}/></label>
    <label className="field">Condiciones fijas (una por línea)<textarea rows={4} value={data.terms} onChange={e => set('terms', e.target.value)}/></label>
    {status && <div className={`alert ${status.ok ? 'success' : 'error'}`}>{status.ok ? <Check size={16}/> : <AlertCircle size={16}/>}{status.text}</div>}
    <div className="modal-actions"><button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar datos'}</button></div>
  </form>;
}
