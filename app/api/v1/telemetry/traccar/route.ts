import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { logisticsBackend } from '../../../../../lib/logistics/backend';

const deviceId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const position = z.object({
  id: z.union([z.number().int().positive().max(Number.MAX_SAFE_INTEGER), z.string().regex(/^\d{1,40}$/)]).optional(),
  uniqueId: deviceId.optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speed: z.number().min(0).max(400 / 1.852),
  fixTime: z.string().datetime({ offset: true }).optional(),
  deviceTime: z.string().datetime({ offset: true }).optional(),
  valid: z.boolean().optional(),
  outdated: z.boolean().optional(),
  attributes: z.object({ ignition: z.boolean().optional() }).optional(),
});
const envelope = z.union([z.object({ device: z.object({ uniqueId: deviceId }).optional(), position }), position]);

export async function POST(request: Request) {
  const db = logisticsBackend();
  const secret = process.env.TELEMETRY_WEBHOOK_HMAC_SECRET;
  if (!db || !secret) return Response.json({ error: 'Intake unavailable' }, { status: 503 });

  const timestamp = request.headers.get('x-lope-timestamp') ?? '';
  const signature = request.headers.get('x-lope-signature')?.match(/^sha256=([a-f0-9]{64})$/i)?.[1];
  const deny = () => Response.json({ error: 'Invalid signature' }, { status: 401 });
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || !signature) return deny();

  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > 65536) return Response.json({ error: 'Payload too large' }, { status: 413 });
  const expected = createHmac('sha256', secret).update(timestamp + '.').update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return deny();

  let body: unknown;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { return Response.json({ error: 'Malformed JSON' }, { status: 400 }); }
  const parsed = envelope.safeParse(body);
  if (!parsed.success) return Response.json({ error: 'Invalid Traccar position' }, { status: 422 });

  const value = parsed.data;
  const fix = 'position' in value ? value.position : value;
  const device = ('device' in value ? value.device?.uniqueId : undefined) ?? fix.uniqueId;
  const time = fix.fixTime ?? fix.deviceTime;
  if (!device || !time || !Number.isFinite(Date.parse(time)) || Date.parse(time) > Date.now() + 600_000 ||
      fix.valid === false || fix.outdated === true) {
    return Response.json({ error: 'Invalid or outdated position' }, { status: 422 });
  }

  const event = fix.id === undefined
    ? 'sha256:' + createHash('sha256').update(JSON.stringify([
      new Date(time).toISOString(), fix.latitude, fix.longitude, fix.speed, fix.attributes?.ignition ?? null,
    ])).digest('hex')
    : 'traccar:' + fix.id;
  const { data, error } = await db.rpc('lope_ingest_telemetry', {
    p_device: device, p_event: event, p_at: time, p_lat: fix.latitude, p_lng: fix.longitude,
    p_speed: fix.speed * 1.852, p_ignition: fix.attributes?.ignition ?? null, p_raw: body,
  });
  if (error) return Response.json({ error: 'Intake unavailable' }, { status: 503 });
  if (data === 'unknown_device') return Response.json({ error: 'Unknown device' }, { status: 422 });
  return Response.json({ quality: data });
}

