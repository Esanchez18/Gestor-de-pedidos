import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, GripVertical, MoveRight } from 'lucide-react';
import type { Order, Status } from '../types';
import { date, money, overdue } from '../types';
import './board.css';

const BOARD_COLUMNS: { status: Status; hint: string }[] = [
  { status: 'Pendiente', hint: 'Por empezar' },
  { status: 'En proceso', hint: 'Imprimiendo o en armado' },
  { status: 'Bloqueado', hint: 'Esperando algo para seguir' },
  { status: 'Finalizado', hint: 'Se archivan a los 7 días' },
];
const CANCELLED = { status: 'Cancelado' as Status, hint: 'No se van a hacer' };

const slug = (s: Status) => s.toLowerCase().replace(' ', '-');

// Atrasados primero, después por fecha de entrega; sin fecha al final.
function byUrgency(a: Order, b: Order) {
  const la = overdue(a) ? 0 : 1, lb = overdue(b) ? 0 : 1;
  if (la !== lb) return la - lb;
  return (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31');
}

export default function OrdersBoard({ orders, showCancelled, onMove }: {
  orders: Order[];
  showCancelled: boolean;
  onMove: (order: Order, status: Status) => Promise<boolean>;
}) {
  // Movimiento optimista: la card cambia de columna al instante y vuelve si falla.
  const [pending, setPending] = useState<Record<string, Status>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<Status | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    setPending(current => {
      const next = { ...current };
      let changed = false;
      for (const id of Object.keys(next)) {
        const order = orders.find(o => o.id === id);
        if (!order || order.status === next[id]) { delete next[id]; changed = true; }
      }
      return changed ? next : current;
    });
  }, [orders]);

  const columns = useMemo(() => showCancelled ? [...BOARD_COLUMNS, CANCELLED] : BOARD_COLUMNS, [showCancelled]);
  const grouped = useMemo(() => {
    const map = new Map<Status, Order[]>(columns.map(c => [c.status, []]));
    orders.forEach(o => map.get(pending[o.id] || o.status)?.push(o));
    map.forEach(list => list.sort(byUrgency));
    return map;
  }, [orders, pending, columns]);

  async function move(order: Order, status: Status) {
    const current = pending[order.id] || order.status;
    if (current === status) return;
    if (current === 'Cancelado' && !confirm(`¿Reactivar el pedido ${order.order_number}?`)) return;
    if (status === 'Cancelado' && !confirm(`¿Cancelar el pedido ${order.order_number}?`)) return;
    setPending(p => ({ ...p, [order.id]: status }));
    const ok = await onMove(order, status);
    if (!ok) setPending(p => { const next = { ...p }; delete next[order.id]; return next; });
  }

  function drop(status: Status) {
    const order = orders.find(o => o.id === dragId);
    setDragId(null); setOverColumn(null);
    if (order) void move(order, status);
  }

  return <div className="board" role="list" aria-label="Tablero de pedidos">
    {columns.map(({ status, hint }) => {
      const list = grouped.get(status) || [];
      const total = list.reduce((s, o) => s + Number(o.quoted_price || 0), 0);
      return <section key={status} role="listitem" aria-label={`${status}: ${list.length} pedidos`}
        className={`board-column col-${slug(status)} ${overColumn === status ? 'drag-over' : ''}`}
        onDragOver={e => { if (dragId) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (overColumn !== status) setOverColumn(status); } }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverColumn(null); }}
        onDrop={e => { e.preventDefault(); drop(status); }}>
        <header className="board-column-head">
          <div><span className="board-dot"/><h2>{status}</h2><span className="board-count">{list.length}</span></div>
          <small>{total > 0 ? money(total) : hint}</small>
        </header>
        <div className="board-cards">
          {list.map(o => {
            const late = overdue(o);
            return <article key={o.id} className={`board-card ${dragId === o.id ? 'dragging' : ''} ${pending[o.id] ? 'saving' : ''}`}
              draggable onDragStart={e => { setDragId(o.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', o.id); }}
              onDragEnd={() => { setDragId(null); setOverColumn(null); }}
              onClick={() => navigate(`/pedidos/${o.id}`)}
              onKeyDown={e => { if (e.key === 'Enter') navigate(`/pedidos/${o.id}`); }}
              tabIndex={0} aria-label={`${o.order_number}: ${o.product_name}, ${o.customer_name}`}>
              <div className="board-card-top">
                <span className="board-card-number"><GripVertical size={13} aria-hidden/>{o.order_number}</span>
                <label className="board-move" title="Mover a otra columna" onClick={e => e.stopPropagation()}>
                  <MoveRight size={14} aria-hidden/>
                  <select aria-label={`Mover ${o.order_number} a`} value={pending[o.id] || o.status} onChange={e => void move(o, e.target.value as Status)}>
                    {[...BOARD_COLUMNS, CANCELLED].map(c => <option key={c.status} value={c.status}>{c.status}</option>)}
                  </select>
                </label>
              </div>
              <h3>{o.product_name}{o.quantity > 1 && <span className="board-qty">×{o.quantity}</span>}</h3>
              <p className="board-customer">{o.customer_name}</p>
              <div className="board-card-foot">
                <span className={late ? 'board-due late' : 'board-due'}><CalendarDays size={12} aria-hidden/>{o.due_date ? date(o.due_date) : 'Sin fecha'}{late && <b>Atrasado</b>}</span>
                {Number(o.quoted_price) > 0 && <span className="board-price">{money(o.quoted_price)}</span>}
              </div>
            </article>;
          })}
          {!list.length && <div className="board-empty">{dragId ? 'Soltá acá' : 'Sin pedidos'}</div>}
        </div>
      </section>;
    })}
  </div>;
}
