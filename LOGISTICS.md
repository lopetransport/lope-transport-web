# Lope Logistics backend

The logistics schema and private `lope-epod` bucket have been applied to the existing **Lope Transport Site** Supabase project as `lope_logistics_backend`. The migration creates the `tms` telemetry and `logistics` shipment schemas. For a fresh Supabase project, review and apply `db/logistics-tracking-proposal.sql` once. The website portal remains the driver identity provider.

## Vercel and local configuration

Set the following server-only variables in Vercel for the environments you deploy. Use the same entries in an untracked `.env.local` for local development.

```dotenv
LOGISTICS_SUPABASE_URL=https://ksdjhmzneffrothktcvb.supabase.co
LOGISTICS_SUPABASE_SERVICE_KEY=<Supabase secret key from the Lope Transport Site project>
TELEMETRY_WEBHOOK_HMAC_SECRET=<random shared secret used by the telemetry sender>
```

In Supabase, obtain the secret key under **Project Settings → API Keys**. The project’s legacy `service_role` key also works. Supply the value directly in Vercel or your local environment. Redeploy after setting the variables.

## Demo and telemetry

```sh
node --env-file=.env.local scripts/seed-mock-trip.js
node --env-file=.env.local scripts/seed-mock-trip.js <assigned-test-driver-auth-uuid>
```

Set `LOGISTICS_SITE_ORIGIN` to the Vercel preview or production site URL before running the script. The script prints a tracking link and mock device ID. Tracking grants expire after two hours. GPS fixes become stale after ten minutes. Pass the Auth UUID of a consenting test driver to create an assigned stop and receive a driver URL. Sign in through the portal before opening that URL.

Send one Traccar position per request to `POST /api/v1/telemetry/traccar`. The endpoint accepts either `{ device: { uniqueId }, position: { ... } }` or a flat position with `uniqueId`. Include numeric `latitude`, `longitude`, and `speed` in knots, a timezone-qualified `fixTime` or `deviceTime`, and `attributes.ignition` when available. Provision the device in `tms.vehicles` before sending. Set `X-Lope-Timestamp` to Unix seconds and `X-Lope-Signature` to `sha256=<hex HMAC>` over the timestamp, a dot, and the exact raw request bytes. A sender with bearer-only forwarding needs an HMAC-capable bridge. Duplicate position IDs for a device return a successful duplicate result without updating trip state again.

## Driver acceptance check

Use HTTPS so the browser can capture geolocation. Sign in as the assigned driver, open the driver URL, enter a test receiver, draw a signature, and attach up to five JPEG, PNG or WebP photos. Keep the signature and photos within 4 MB combined for Vercel's function request limit. Confirm that the submission returns HTTP 200, the proof exists in `logistics.epod_proofs`, the objects are private, and tracking shows Delivered without a GPS position. Repeat the same submission ID to verify idempotency. The upload route checks the authenticated driver-to-stop assignment before writing and uses content-derived object paths for retries. An interrupted submission may leave private objects without a proof; review those before setting a retention cleanup policy.

