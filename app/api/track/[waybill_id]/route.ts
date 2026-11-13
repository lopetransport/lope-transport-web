import { createClient } from '@supabase/supabase-js';
import { hashTrackingToken, validTrackingToken } from '../../../../lib/logistics/tracking-token';

const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer' };

export async function POST(request: Request, { params }: { params: Promise<{ waybill_id: string }> }) {
  const { waybill_id } = await params;
  const token = request.headers.get('Authorization')?.match(/^Bearer (\S+)$/i)?.[1];
  const unavailable = () => Response.json({ error: 'Tracking link unavailable' }, { status: 404, headers });
  if (!token || !validTrackingToken.test(token) || !waybill_id || waybill_id.length > 128) return unavailable();

  const url = process.env.LOGISTICS_SUPABASE_URL;
  const key = process.env.LOGISTICS_SUPABASE_SERVICE_KEY;
  const offline = () => Response.json({ error: 'Tracking is temporarily unavailable' }, { status: 503, headers });
  if (!url || !key) return offline();

  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await db.rpc('lope_tracking_snapshot', {
      p_waybill: waybill_id, p_token_hash: hashTrackingToken(token),
    });
    if (error) return offline();
    return data ? Response.json(data, { headers }) : unavailable();
  } catch {
    return offline();
  }
}

