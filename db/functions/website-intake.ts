import { validateEnquiry } from './schema.ts';

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  // Public website intake: validate the project's publishable key ourselves.
  // This key identifies the project; it never grants database read/write access.
  const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') || '{}');
  const key = request.headers.get('apikey');
  if (!key || !Object.values(keys).includes(key)) return json({ error: 'Invalid API key.' }, 401);
  if (!request.headers.get('content-type')?.includes('application/json')) return json({ error: 'JSON required.' }, 415);
  let input;
  try {
    const body = await request.text();
    if (body.length > 16000) return json({ error: 'Request too large.' }, 413);
    input = JSON.parse(body);
  } catch { return json({ error: 'Invalid request.' }, 400); }
  const kind = input?.kind;
  if (kind !== 'quote' && kind !== 'dispatch') return json({ error: 'Invalid enquiry type.' }, 400);
  const result = validateEnquiry(kind, input.payload);
  if (!result.success) return json({ error: 'Please check your enquiry details and consent.' }, 400);
  const { submissionId, consent: _consent, website: _website, ...payload } = result.data;
  const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
  const secret = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!secret || !url) return json({ error: 'Enquiry capture is unavailable. Please contact dispatch.' }, 503);
  const headers: Record<string, string> = { apikey: secret, 'Content-Type': 'application/json' };
  if (!secret.startsWith('sb_secret_')) headers.Authorization = 'Bearer ' + secret;
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const [emailHash, ipHash] = await Promise.all([hash(payload.email), hash(ip)]);
    const response = await fetch(url + '/rest/v1/rpc/capture_website_enquiry', {
      method: 'POST', headers, signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ p_kind: kind, p_payload: payload, p_id: submissionId, p_email_hash: emailHash, p_ip_hash: ipHash }),
    });
    if (!response.ok) {
      const failure = await response.json().catch(() => ({}));
      if (failure.message === 'submission_limit') return json({ error: 'Too many enquiries. Please call or email dispatch, or try again later.' }, 429);
      console.error('Website intake failed', { status: response.status, code: failure.code });
      return json({ error: 'Your enquiry could not be confirmed. Please retry or contact dispatch.' }, 503);
    }
    const reference = await response.json();
    if (reference !== submissionId) throw new Error('Invalid receipt');
    return json({ received: true, reference }, 201);
  } catch {
    return json({ error: 'Your enquiry could not be confirmed. Please retry or contact dispatch.' }, 503);
  }
});

