import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Pencil, PiggyBank, Plus, ShoppingBag, Trash2, TrendingDown, TrendingUp, Wallet, X } from 'lucide-react';
import type { Order } from '../types';
import { date, money } from '../types';
import { supabase } from '../lib/supabase';
import './finance.css';

type Kind = 'ingreso' | 'egreso';
interface Movement {
  id: string;
  kind: Kind;
  category: string;
  description: string | null;
  amount: number | string;
  quantity_kg: number | string | null;
  movement_date: string;
  created_at: string;
}

const EXPENSE_CATEGORIES = ['Inversión (equipos)', 'Filamento', 'Insumos y repuestos', 'Envíos', 'Publicidad', 'Servicios', 'Otros gastos'];
const INCOME_CATEGORIES = ['Venta sin pedido', 'Otros ingresos'];
const FILAMENT = 'Filamento';
const INVESTMENT = 'Inversión (equipos)';
const PAGE = 1000;

const tz = 'America/Argentina/Buenos_Aires';
const todayAR = () => new Date().toLocaleDateString('en-CA', { timeZone: tz });
const toLocalDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: tz });
const monthLabel = (ym: string) => {
  const label = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-15T12:00:00Z`));
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const shortMonth = (ym: string) => new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-15T12:00:00Z`)).replace('.', '');
const num = (v: number | string | null | undefined) => Number(v || 0);
// "25.000,50" o "25000,50" → 25000.5 · "25.000" → 25000 (miles) · "25.5" → 25.5
const parseAmount = (v: string) => {
  const t = v.trim();
  if (t.includes(',')) return Number(t.replace(/\./g, '').replace(',', '.'));
  if (/^\d{1,3}(\.\d{3})+$/.test(t)) return Number(t.replace(/\./g, ''));
  return Number(t);
};
const validAmount = (v: string) => /^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(v.trim());

function readable(error: unknown) {
  if (error && typeof error === 'object') {
    const e = error as { message?: string; code?: string };
    if (e.code === 'PGRST205' || e.code === '42P01') return 'Falta crear la tabla de finanzas. Ejecutá supabase/migrations/005_finances.sql en Supabase → SQL Editor.';
    if (e.message) return e.message;
  }
  return 'No se pudo comunicar con Supabase.';
}

/** Ingreso de un pedido finalizado: el precio cotizado (ya incluye envío e IVA si se cargó desde la calculadora). */
function orderIncome(o: Order) { return num(o.quoted_price); }
function orderDate(o: Order) { return toLocalDate(o.completed_at || o.updated_at); }

export default function FinancePage({ orders }: { orders: Order[] }) {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('all');
  const [editing, setEditing] = useState<Movement | null | false>(false);

  async function reload() {
    if (!supabase) return;
    setLoading(true);
    try {
      const rows: Movement[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('finance_movements').select('*')
          .order('movement_date', { ascending: false }).order('created_at', { ascending: false }).range(from, from + PAGE - 1);
        if (error) throw error;
        rows.push(...((data || []) as Movement[]));
        if (!data || data.length < PAGE) break;
      }
      setMovements(rows);
      setError('');
    } catch (e) { setError(readable(e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  const finished = useMemo(() => orders.filter(o => o.status === 'Finalizado'), [orders]);
  const finishedWithoutPrice = finished.filter(o => !num(o.quoted_price));

  // Totales históricos: la recuperación de la inversión siempre se mide desde el inicio.
  const all = useMemo(() => {
    const sales = finished.reduce((s, o) => s + orderIncome(o), 0);
    const otherIncome = movements.filter(m => m.kind === 'ingreso').reduce((s, m) => s + num(m.amount), 0);
    const expenses = movements.filter(m => m.kind === 'egreso').reduce((s, m) => s + num(m.amount), 0);
    const income = sales + otherIncome;
    return { sales, otherIncome, expenses, income, balance: income - expenses };
  }, [finished, movements]);

  // Resumen por mes, del más reciente al más antiguo, con el resultado acumulado.
  const months = useMemo(() => {
    const map = new Map<string, { sales: number; orders: number; otherIncome: number; expenses: number }>();
    const row = (ym: string) => { if (!map.has(ym)) map.set(ym, { sales: 0, orders: 0, otherIncome: 0, expenses: 0 }); return map.get(ym)!; };
    finished.forEach(o => { const r = row(orderDate(o).slice(0, 7)); r.sales += orderIncome(o); r.orders += 1; });
    movements.forEach(m => { const r = row(m.movement_date.slice(0, 7)); if (m.kind === 'ingreso') r.otherIncome += num(m.amount); else r.expenses += num(m.amount); });
    const sorted = [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
    let cumulative = 0;
    const withCumulative = sorted.map(([ym, r]) => { const net = r.sales + r.otherIncome - r.expenses; cumulative += net; return { ym, ...r, net, cumulative }; });
    return withCumulative.reverse();
  }, [finished, movements]);

  // Estimación de cuánto falta según el promedio de los últimos 3 meses con actividad.
  const remaining = Math.max(0, -all.balance);
  const recentNet = months.slice(0, 3);
  const avgNet = recentNet.length ? recentNet.reduce((s, m) => s + m.net, 0) / recentNet.length : 0;
  const monthsToRecover = remaining > 0 && avgNet > 0 ? Math.ceil(remaining / avgNet) : null;
  const recoveredPct = all.expenses > 0 ? (all.income / all.expenses) * 100 : 0;

  const inPeriod = (d: string) => period === 'all' || d.startsWith(period);
  const periodMovements = movements.filter(m => inPeriod(m.movement_date));
  const periodOrders = finished.filter(o => inPeriod(orderDate(o))).sort((a, b) => orderDate(b).localeCompare(orderDate(a)));
  const p = {
    sales: periodOrders.reduce((s, o) => s + orderIncome(o), 0),
    otherIncome: periodMovements.filter(m => m.kind === 'ingreso').reduce((s, m) => s + num(m.amount), 0),
    expenses: periodMovements.filter(m => m.kind === 'egreso').reduce((s, m) => s + num(m.amount), 0),
  };
  const periodIncome = p.sales + p.otherIncome;

  const byCategory = useMemo(() => {
    const map = new Map<string, { amount: number; kg: number }>();
    periodMovements.filter(m => m.kind === 'egreso').forEach(m => {
      const r = map.get(m.category) || { amount: 0, kg: 0 };
      r.amount += num(m.amount); r.kg += num(m.quantity_kg);
      map.set(m.category, r);
    });
    return [...map.entries()].sort((a, b) => b[1].amount - a[1].amount);
  }, [periodMovements]);
  const filament = byCategory.find(([c]) => c === FILAMENT)?.[1];

  async function remove(m: Movement) {
    if (!supabase || !confirm(`¿Eliminar el ${m.kind} «${m.description || m.category}» de ${money(m.amount)}?`)) return;
    const { error } = await supabase.from('finance_movements').delete().eq('id', m.id);
    if (error) { setError(readable(error)); return; }
    await reload();
  }

  const periodName = period === 'all' ? 'todo el período' : monthLabel(period);

  return <>
    <div className="page-title">
      <div><span className="eyebrow">ADMINISTRACIÓN</span><h1>Finanzas</h1><p>Ingresos, egresos y recuperación de lo invertido. Los pedidos finalizados se suman solos como ingresos, también los archivados.</p></div>
      <button className="btn primary" onClick={() => setEditing(null)}><Plus size={17}/>Registrar movimiento</button>
    </div>

    {error && <div className="alert error finance-alert"><AlertCircle size={16}/>{error}</div>}

    <section className="finance-recovery" aria-label="Recuperación de lo invertido">
      <div className="finance-recovery-head">
        <div>
          <span className="eyebrow">RECUPERACIÓN DE LO INVERTIDO · DESDE EL INICIO</span>
          <h2>{all.expenses === 0 ? 'Todavía no registraste gastos'
            : remaining > 0 ? <>Te faltan <b>{money(remaining)}</b> para recuperar lo gastado</>
            : <>Recuperaste todo y ganaste <b>{money(all.balance)}</b></>}</h2>
          <p>
            Ingresos {money(all.income)} de {money(all.expenses)} gastados
            {remaining > 0 && monthsToRecover !== null && <> · al ritmo de los últimos meses, en unos <b>{monthsToRecover} {monthsToRecover === 1 ? 'mes' : 'meses'}</b></>}
            {remaining > 0 && monthsToRecover === null && all.expenses > 0 && <> · en los últimos meses los gastos superaron a los ingresos</>}
          </p>
        </div>
        <strong className="finance-recovery-pct">{all.expenses > 0 ? `${Math.round(recoveredPct)}%` : '—'}</strong>
      </div>
      <div className="finance-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(recoveredPct))} aria-label="Porcentaje recuperado">
        <span style={{ width: `${Math.min(100, recoveredPct)}%` }}/>
      </div>
    </section>

    <div className="finance-toolbar">
      <label className="finance-period">Período
        <select value={period} onChange={e => setPeriod(e.target.value)}>
          <option value="all">Todo el tiempo</option>
          {months.map(m => <option key={m.ym} value={m.ym}>{monthLabel(m.ym)}</option>)}
        </select>
      </label>
    </div>

    <div className="metric-grid">
      <FinanceTile icon={<ShoppingBag/>} color="green" label="Vendido en pedidos" value={money(p.sales)} note={`${periodOrders.length} pedidos finalizados · ${periodName}`}/>
      <FinanceTile icon={<TrendingUp/>} color="blue" label="Ingresos totales" value={money(periodIncome)} note={p.otherIncome ? `Incluye ${money(p.otherIncome)} de otros ingresos` : 'Pedidos + otros ingresos'}/>
      <FinanceTile icon={<TrendingDown/>} color="red" label="Egresos" value={money(p.expenses)} note={filament ? `${money(filament.amount)} en filamento${filament.kg ? ` · ${filament.kg.toLocaleString('es-AR')} kg` : ''}` : 'Sin gastos de filamento'}/>
      <FinanceTile icon={<PiggyBank/>} color="violet" label="Resultado" value={`${periodIncome - p.expenses < 0 ? '−' : ''}${money(Math.abs(periodIncome - p.expenses))}`} note={periodIncome - p.expenses < 0 ? 'Gastaste más de lo que ingresó' : 'Ingresos menos egresos'}/>
    </div>

    {finishedWithoutPrice.length > 0 && <div className="alert finance-warning"><AlertCircle size={16}/>
      {finishedWithoutPrice.length === 1 ? 'Hay 1 pedido finalizado' : `Hay ${finishedWithoutPrice.length} pedidos finalizados`} sin precio cotizado, no suman ingresos:
      {' '}{finishedWithoutPrice.slice(0, 5).map((o, i) => <span key={o.id}>{i > 0 && ', '}<Link to={`/pedidos/${o.id}/editar`}>{o.order_number}</Link></span>)}{finishedWithoutPrice.length > 5 && '…'}
    </div>}

    <div className="finance-columns">
      <section className="finance-panel">
        <div className="finance-panel-head"><div><span className="eyebrow">EN QUÉ SE GASTÓ</span><h2>Egresos por categoría</h2></div><span className="soft-label">{periodName}</span></div>
        {byCategory.length ? <ul className="finance-breakdown">
          {byCategory.map(([category, r]) => {
            const share = p.expenses ? (r.amount / p.expenses) * 100 : 0;
            return <li key={category}>
              <div><span>{category}{r.kg > 0 && <small> · {r.kg.toLocaleString('es-AR')} kg · {money(r.amount / r.kg)}/kg</small>}</span><b>{money(r.amount)}</b></div>
              <div className="finance-bar" title={`${Math.round(share)}% de los egresos`}><span style={{ width: `${share}%` }}/></div>
            </li>;
          })}
        </ul> : <p className="finance-empty">No hay egresos en este período. Registrá la compra de la impresora, filamentos e insumos para medir la recuperación.</p>}
      </section>

      <section className="finance-panel">
        <div className="finance-panel-head"><div><span className="eyebrow">MES A MES</span><h2>Resultado mensual</h2></div></div>
        {months.length ? <div className="table-scroll"><table className="finance-table">
          <thead><tr><th>Mes</th><th className="num">Ingresos</th><th className="num">Egresos</th><th className="num">Resultado</th><th className="num">Acumulado</th></tr></thead>
          <tbody>{months.map(m => <tr key={m.ym} className={m.ym === period ? 'selected' : ''}>
            <td className="finance-month">{shortMonth(m.ym)}<small>{m.orders} {m.orders === 1 ? 'pedido' : 'pedidos'}</small></td>
            <td className="num">{money(m.sales + m.otherIncome)}</td>
            <td className="num">{money(m.expenses)}</td>
            <td className={`num ${m.net < 0 ? 'neg' : 'pos'}`}>{m.net < 0 ? '−' : '+'}{money(Math.abs(m.net))}</td>
            <td className={`num ${m.cumulative < 0 ? 'neg' : 'pos'}`}>{m.cumulative < 0 ? '−' : ''}{money(Math.abs(m.cumulative))}</td>
          </tr>)}</tbody>
        </table></div> : <p className="finance-empty">Todavía no hay movimientos ni pedidos finalizados.</p>}
      </section>
    </div>

    <section className="table-card finance-list">
      <div className="table-toolbar"><div><span className="eyebrow">REGISTRO</span><h2 className="finance-h2">Movimientos · {periodName}</h2></div><span className="soft-label">{periodMovements.length + periodOrders.length} registros</span></div>
      {loading ? <p className="finance-empty">Cargando…</p> : (periodMovements.length || periodOrders.length) ? <div className="table-scroll"><table>
        <thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Detalle</th><th className="num">Monto</th><th/></tr></thead>
        <tbody>{[
          ...periodMovements.map(m => ({ key: m.id, d: m.movement_date, node: <tr key={m.id}>
            <td>{date(m.movement_date)}</td>
            <td><span className={`finance-kind ${m.kind}`}>{m.kind === 'ingreso' ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}{m.kind === 'ingreso' ? 'Ingreso' : 'Egreso'}</span></td>
            <td>{m.category}{m.quantity_kg ? ` · ${num(m.quantity_kg).toLocaleString('es-AR')} kg` : ''}</td>
            <td>{m.description || '—'}</td>
            <td className={`num ${m.kind === 'egreso' ? 'neg' : 'pos'}`}>{m.kind === 'egreso' ? '−' : '+'}{money(m.amount)}</td>
            <td className="finance-actions"><button className="icon-btn" title="Editar" onClick={() => setEditing(m)}><Pencil size={14}/></button><button className="icon-btn danger-icon" title="Eliminar" onClick={() => void remove(m)}><Trash2 size={14}/></button></td>
          </tr> })),
          ...periodOrders.map(o => ({ key: o.id, d: orderDate(o), node: <tr key={o.id}>
            <td>{date(orderDate(o))}</td>
            <td><span className="finance-kind ingreso"><TrendingUp size={12}/>Ingreso</span></td>
            <td>Pedido finalizado</td>
            <td><Link to={`/pedidos/${o.id}`}>{o.order_number}</Link> · {o.product_name} · {o.customer_name}</td>
            <td className="num pos">+{money(orderIncome(o))}</td>
            <td/>
          </tr> })),
        ].sort((a, b) => b.d.localeCompare(a.d)).map(r => r.node)}</tbody>
      </table></div> : <p className="finance-empty">No hay movimientos en este período.</p>}
    </section>

    {editing !== false && <MovementForm movement={editing} onClose={() => setEditing(false)} onSaved={async () => { setEditing(false); await reload(); }}/>}
  </>;
}

function FinanceTile({ icon, color, label, value, note }: { icon: React.ReactNode; color: string; label: string; value: string; note: string }) {
  return <div className="metric-card finance-tile"><div className={`metric-icon ${color}`}>{icon}</div><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small></div>;
}

function MovementForm({ movement, onClose, onSaved }: { movement: Movement | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [kind, setKind] = useState<Kind>(movement?.kind || 'egreso');
  const [category, setCategory] = useState(movement?.category || FILAMENT);
  const [amount, setAmount] = useState(movement ? String(num(movement.amount)).replace('.', ',') : '');
  const [kg, setKg] = useState(movement?.quantity_kg ? String(num(movement.quantity_kg)).replace('.', ',') : '');
  const [day, setDay] = useState(movement?.movement_date || todayAR());
  const [description, setDescription] = useState(movement?.description || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const categories = kind === 'egreso' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;

  function changeKind(next: Kind) {
    setKind(next);
    setCategory(next === 'egreso' ? FILAMENT : INCOME_CATEGORIES[0]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (!validAmount(amount) || parseAmount(amount) <= 0) { setError('Ingresá un monto válido mayor a cero (por ejemplo 25000 o 25.000,50).'); return; }
    const kgValue = kg.trim() ? Number(kg.trim().replace(',', '.')) : null;
    if (kgValue !== null && !(kgValue > 0)) { setError('Ingresá una cantidad de kilos válida.'); return; }
    if (!day) { setError('Elegí una fecha.'); return; }
    setBusy(true); setError('');
    const fields = {
      kind, category, amount: parseAmount(amount), movement_date: day,
      quantity_kg: category === FILAMENT ? kgValue : null,
      description: description.trim() || null,
    };
    const result = movement
      ? await supabase.from('finance_movements').update(fields).eq('id', movement.id)
      : await supabase.from('finance_movements').insert(fields);
    setBusy(false);
    if (result.error) { setError(readable(result.error)); return; }
    await onSaved();
  }

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <form className="modal" onSubmit={save}>
      <button type="button" className="icon-btn modal-close" onClick={onClose} aria-label="Cerrar"><X/></button>
      <span className="eyebrow">FINANZAS</span><h2>{movement ? 'Editar movimiento' : 'Registrar movimiento'}</h2>
      {error && <div className="alert error">{error}</div>}
      <div className="finance-kind-toggle" role="radiogroup" aria-label="Tipo de movimiento">
        <button type="button" role="radio" aria-checked={kind === 'egreso'} className={kind === 'egreso' ? 'active egreso' : ''} onClick={() => changeKind('egreso')}><TrendingDown size={15}/>Egreso</button>
        <button type="button" role="radio" aria-checked={kind === 'ingreso'} className={kind === 'ingreso' ? 'active ingreso' : ''} onClick={() => changeKind('ingreso')}><TrendingUp size={15}/>Ingreso</button>
      </div>
      {kind === 'ingreso' && <p className="finance-hint"><Wallet size={13}/>Los pedidos finalizados ya se suman solos. Usá esto solo para ingresos que no pasaron por un pedido.</p>}
      <label className="field">Categoría
        <select value={category} onChange={e => setCategory(e.target.value)}>
          {categories.map(c => <option key={c}>{c}</option>)}
          {!categories.includes(category) && <option>{category}</option>}
        </select>
      </label>
      {category === INVESTMENT && <p className="finance-hint">Impresoras, herramientas y equipos: lo que querés recuperar con las ventas.</p>}
      <div className="field-grid">
        <label className="field">Monto *<span className="input-prefix"><span>$</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0,00" required/></span></label>
        <label className="field">Fecha *<input type="date" value={day} max={todayAR()} onChange={e => setDay(e.target.value)} required/></label>
      </div>
      {category === FILAMENT && <label className="field">Kilos comprados (opcional)<input inputMode="decimal" value={kg} onChange={e => setKg(e.target.value)} placeholder="Ej.: 1 o 2,5"/></label>}
      <label className="field">Detalle<input value={description} onChange={e => setDescription(e.target.value)} placeholder={category === FILAMENT ? 'Ej.: PLA negro x2, Grilon3' : 'Ej.: Ender 3 V3'} maxLength={200}/></label>
      <div className="modal-actions">
        <button type="button" className="btn secondary" onClick={onClose}>Cancelar</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </form>
  </div>;
}
