import { supabase } from '../lib/supabase';

export interface BusinessSettings {
  name: string;
  tagline: string;
  owner: string;
  cuit: string;
  ivaCondition: string;
  address: string;
  city: string;
  postalCode: string;
  province: string;
  whatsapp: string;
  instagram: string;
  email: string;
  website: string;
  alias: string;
  cbu: string;
  validityDays: number;
  depositPercent: number;
  productionTime: string;
  paymentMethods: string;
  terms: string;
}

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: 'Pirañalab',
  tagline: 'Impresión 3D personalizada',
  owner: '',
  cuit: '',
  ivaCondition: '',
  address: '',
  city: 'San Miguel del Monte',
  postalCode: '7220',
  province: 'Buenos Aires',
  whatsapp: '+54 9 11 6816-3058',
  instagram: '@piranalab',
  email: '',
  website: '',
  alias: 'pira.lab',
  cbu: '',
  validityDays: 15,
  depositPercent: 50,
  productionTime: 'Entre 3 y 15 días desde la seña',
  paymentMethods: 'Transferencia, efectivo o Mercado Pago',
  terms: 'Los colores pueden variar levemente según el lote de filamento.\nLas piezas impresas en 3D pueden presentar líneas de capa propias del proceso.\nEl trabajo comienza una vez recibida la seña.',
};

const KEY = 'business';

export async function loadBusiness(): Promise<{ data: BusinessSettings; missingTable: boolean }> {
  if (!supabase) return { data: DEFAULT_BUSINESS, missingTable: false };
  const { data, error } = await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle();
  if (error) return { data: DEFAULT_BUSINESS, missingTable: ['PGRST205', '42P01'].includes(String(error.code)) };
  return { data: { ...DEFAULT_BUSINESS, ...((data?.value as Partial<BusinessSettings>) || {}) }, missingTable: false };
}

export async function saveBusiness(value: BusinessSettings) {
  if (!supabase) throw new Error('Supabase no está configurado.');
  const { error } = await supabase.from('app_settings').upsert({ key: KEY, value });
  if (error) throw error;
}
