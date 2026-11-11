import { createHash } from 'node:crypto';
import { z } from 'zod';
import { serverSupabase } from '../../../../../lib/supabase-server';
import { epodBucket, logisticsBackend, tripIdPattern } from '../../../../../lib/logistics/backend';

const detailsSchema = z.object({
  submissionId: z.string().uuid(),
  receiverName: z.string().trim().min(1).max(150),
  capturedAt: z.string().datetime(),
  position: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracy: z.number().min(0),
    capturedAt: z.string().datetime(),
  }),
  damage: z.boolean(),
  notes: z.string().max(2000),
});

const reply = (body: object, status: number) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

async function readImage(file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size < 12) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png'
    : bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex')) ? 'jpg'
    : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  return ext ? { bytes, ext } : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ trip_id: string }> }) {
  const { trip_id } = await params;
  if (!tripIdPattern.test(trip_id)) return reply({ error: 'Delivery stop unavailable.' }, 404);
  if (request.headers.get('sec-fetch-site') === 'cross-site') return reply({ error: 'Invalid origin.' }, 403);
  const auth = await serverSupabase();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return reply({ error: 'Sign in to submit delivery evidence.' }, 401);

  const db = logisticsBackend();
  const unavailable = () => reply({ error: 'Delivery service temporarily unavailable.' }, 503);
  if (!db) return unavailable();
  const { data: stop, error: stopError } = await db.rpc('lope_driver_stop', {
    p_trip: trip_id, p_driver: user.id,
  });
  if (stopError) return unavailable();
  if (!stop) return reply({ error: 'Delivery stop unavailable.' }, 404);
  if (Number(request.headers.get('content-length')) > 4_250_000) return reply({ error: 'Attachments exceed the upload limit.' }, 413);

  let body: FormData;
  let details: z.infer<typeof detailsSchema>;
  try {
    body = await request.formData();
    details = detailsSchema.parse(JSON.parse(String(body.get('details'))));
  } catch {
    return reply({ error: 'Invalid delivery details.' }, 400);
  }

  const signature = body.get('signature');
  const photos = body.getAll('photos');
  if (!(signature instanceof File) || !photos.length || photos.length > 5 || photos.some(file => !(file instanceof File))) {
    return reply({ error: 'Include one PNG signature and one to five photos.' }, 422);
  }
  const files = [signature, ...photos] as File[];
  if (files.reduce((total, file) => total + file.size, 0) > 4_000_000) {
    return reply({ error: 'Attachments must total 4 MB or less.' }, 413);
  }
  const images = await Promise.all(files.map(readImage));
  if (images[0]?.ext !== 'png' || images.some(image => !image)) {
    return reply({ error: 'Use a PNG signature and JPEG, PNG or WebP photos.' }, 422);
  }

  const bucket = db.storage.from(epodBucket);
  const keys: string[] = [];
  for (const [index, image] of images.entries()) {
    if (!image) return reply({ error: 'Invalid attachment.' }, 422);
    const hash = createHash('sha256').update(image.bytes).digest('hex');
    const path = stop + '/' + details.submissionId + '/' + index + '-' + hash + '.' + image.ext;
    const { error } = await bucket.upload(path, image.bytes, {
      contentType: 'image/' + (image.ext === 'jpg' ? 'jpeg' : image.ext), upsert: false,
    });
    if (error) {
      const existing = await bucket.info(path);
      if (existing.error || !existing.data) return unavailable();
    }
    keys.push(path);
  }

  const { data, error } = await db.rpc('lope_save_epod', {
    p_trip: trip_id, p_driver: user.id, p_submission: details.submissionId,
    p_receiver: details.receiverName, p_at: details.capturedAt, p_location: details.position,
    p_damage: details.damage, p_notes: details.notes, p_signature: keys[0], p_photos: keys.slice(1),
  });
  if (error) return unavailable();
  if (data === 'forbidden') return reply({ error: 'Delivery stop unavailable.' }, 404);
  if (data === 'conflict') return reply({ error: 'This stop already has a delivery proof.' }, 409);
  if (data !== 'saved') return unavailable();
  return reply({ submissionId: details.submissionId, status: 'received' }, 200);
}

