export type Status = 'Pendiente' | 'En proceso' | 'Finalizado' | 'Cancelado';
export type CustomerType = 'Particular' | 'Empresa' | 'Comercio' | 'Evento';
export interface Customer { id:string; name:string; type:CustomerType; phone:string|null; notes:string|null; created_at:string }
export interface Order { id:string; order_number:string; customer_id:string; customer_name:string; product_name:string; description:string|null; quantity:number; reference_image_path:string|null; stl_url:string|null; quoted_price:number|string|null; shipping_cost:number|string|null; delivery_address:string|null; delivery_locality:string|null; due_date:string|null; status:Status; production_notes:string|null; materials:string|null; colors:string|null; completed_at:string|null; created_at:string; updated_at:string }
export interface Activity { id:string; order_id:string; event_type:string; description:string; created_at:string; user_id:string|null }
export const statusList:Status[]=['Pendiente','En proceso','Finalizado','Cancelado'];
export const money=(v:number|string|null|undefined)=>new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:2}).format(Number(v||0));
export const date=(v:string|null|undefined)=>v?new Intl.DateTimeFormat('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}).format(new Date(`${v.slice(0,10)}T12:00:00`)):'—';
export const overdue=(o:Order)=>!!o.due_date&&o.due_date<new Date().toLocaleDateString('en-CA',{timeZone:'America/Argentina/Buenos_Aires'})&&!['Finalizado','Cancelado'].includes(o.status);
