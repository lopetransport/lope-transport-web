import { createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const { LOGISTICS_SUPABASE_URL: url, LOGISTICS_SUPABASE_SERVICE_KEY: key } = process.env;
if (!url || !key) throw new Error('Set LOGISTICS_SUPABASE_URL and LOGISTICS_SUPABASE_SERVICE_KEY.');
const origin = new URL(process.env.LOGISTICS_SITE_ORIGIN || 'http://localhost:3000');
const driverArgument = process.argv[2]?.trim();
const waybill = 'DEMO-' + randomBytes(8).toString('hex');
const token = randomBytes(32).toString('base64url');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const driver = driverArgument ? await resolveDriver(driverArgument) : null;
const { data, error } = await db.rpc('lope_seed_mock_trip', {
  p_waybill: waybill, p_hash: createHash('sha256').update(token).digest('hex'), p_driver: driver?.id ?? null,
});
if (error) throw new Error(error.message);
const tracking = new URL('/track/' + waybill, origin);
tracking.hash = token;
console.log('Demo tracking link (expires in two hours)', tracking.href);
console.log('Demo device ID', data.deviceId);
if (driver) console.log('Assigned driver link', new URL('/driver/pod/' + data.tripId, origin).href);

async function resolveDriver(argument) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const digest = createHash('sha256').update('lope-logistics/mock-driver/' + argument).digest('hex');
  const id = uuid.test(argument)
    ? argument.toLowerCase()
    : [digest.slice(0, 8), digest.slice(8, 12), '8' + digest.slice(13, 16),
      '8' + digest.slice(17, 20), digest.slice(20, 32)].join('-');

  const admin = db.auth.admin;
  const existing = await admin.getUserById(id);
  if (existing.data?.user) return existing.data.user;
  if (existing.error && existing.error.code !== 'user_not_found' && existing.error.status !== 404) {
    throw new Error('Could not look up the driver: ' + existing.error.message);
  }

  const email = 'mock-driver-' + id + '@lopetransport.example';
  const password = randomBytes(24).toString('base64url') + 'Aa1!';
  const created = await admin.createUser({
    id,
    email,
    password,
    email_confirm: true,
    user_metadata: {
      account_type: 'hauler',
      company_name: 'Lope Logistics Demo',
      contact_person: 'Mock Driver',
    },
  });
  if (created.error) {
    // Another run may have created the same deterministic account in the meantime.
    const retry = await admin.getUserById(id);
    if (retry.data?.user) return retry.data.user;
    throw new Error('Could not create the mock driver: ' + created.error.message);
  }
  if (created.data.user?.id !== id) throw new Error('Supabase did not return the requested mock driver ID.');
  console.log('New mock driver email', email);
  console.log('New mock driver password (shown once)', password);
  return created.data.user;
}
