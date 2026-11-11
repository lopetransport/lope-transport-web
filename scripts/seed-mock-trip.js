import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const { LOGISTICS_SUPABASE_URL: url, LOGISTICS_SUPABASE_SERVICE_KEY: key } = process.env;
if (!url || !key) throw new Error('Set LOGISTICS_SUPABASE_URL and LOGISTICS_SUPABASE_SERVICE_KEY.');
const origin = new URL(process.env.LOGISTICS_SITE_ORIGIN || 'http://localhost:3000');
const driver = process.argv[2] || null;
const waybill = 'DEMO-' + randomBytes(8).toString('hex');
const token = randomBytes(32).toString('base64url');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await db.rpc('lope_seed_mock_trip', {
  p_waybill: waybill, p_hash: createHash('sha256').update(token).digest('hex'), p_driver: driver,
});
if (error) throw new Error(error.message);
const tracking = new URL('/track/' + waybill, origin);
tracking.hash = token;
console.log('Demo tracking link (expires in two hours)', tracking.href);
console.log('Demo device ID', data.deviceId);
if (driver) console.log('Assigned driver link', new URL('/driver/pod/' + data.tripId, origin).href);

