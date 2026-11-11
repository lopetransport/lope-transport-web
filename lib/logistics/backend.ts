import { createClient } from '@supabase/supabase-js';

export function logisticsBackend() {
  const url = process.env.LOGISTICS_SUPABASE_URL;
  const key = process.env.LOGISTICS_SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const tripIdPattern = /^[1-9]\d{0,17}$/;
export const epodBucket = 'lope-epod';

