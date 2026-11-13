import { validateEnquiry } from './enquiry-schema';

// Only public identifiers live here. Database secrets stay inside Supabase.
const intakeUrl = 'https://ksdjhmzneffrothktcvb.supabase.co/functions/v1/website-intake';
const publishableKey = 'sb_publishable_CAzKHX5IbwlTLm1Qkjrulg_tBMz3fUx';

export async function handleEnquiry(request: Request, kind: 'quote' | 'dispatch') {
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const origin = request.headers.get('origin');
  try {
    if (origin && new URL(origin).host !== (request.headers.get('host') || new URL(request.url).host)) return reply({ error: 'Invalid origin.' }, 403);
  } catch { return reply({ error: 'Invalid origin.' }, 403); }
  if (!request.headers.get('content-type')?.includes('application/json')) return reply({ error: 'JSON required.' }, 415);
  let input;
  try {
    const body = await request.text();
    if (body.length > 16000) return reply({ error: 'Request too large.' }, 413);
    input = JSON.parse(body);
  } catch { return reply({ error: 'Invalid request.' }, 400); }
  const parsed = validateEnquiry(kind, input);
  if (!parsed.success) return reply({ error: 'Please check your enquiry details and consent.' }, 400);
  try {
    const response = await fetch(intakeUrl, {
      method: 'POST', headers: { apikey: publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, payload: parsed.data }),
      cache: 'no-store', signal: AbortSignal.timeout(20000),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && result?.received === true && result.reference === parsed.data.submissionId) return reply({ received: true, reference: result.reference }, 201);
    if (response.status === 429) return reply({ error: 'Too many enquiries. Please call or email dispatch, or try again later.' }, 429);
    if (response.status === 400) return reply({ error: 'Please check your enquiry details and consent.' }, 400);
    return reply({ error: 'Your enquiry could not be confirmed. Please retry or use the email option below.' }, 503);
  } catch {
    return reply({ error: 'We could not confirm receipt. Please retry or use the email option below.' }, 503);
  }
}


