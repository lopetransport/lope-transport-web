# Lope Trucking Services

Bespoke corporate transport site built with React, TypeScript, the Next.js App Router API and the Sites Vinext runtime. Responsive layouts, accessible modal and action tabs, fleet selection, corridor map, freight enquiry API and privacy notice.

## Run
Use Node 22.13+ and `npm run install:ci`, then `npm run dev`. Production: `npm run build`.

## Dispatch integration
Apply `db/freight-enquiries.sql` in the intended Supabase project. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as server-only runtime secrets. Never expose the service key through NEXT_PUBLIC variables. The API validates submissions with Zod and writes through the Supabase REST interface. RLS prevents browser insert/read access. No Supabase account or credentials were supplied during creation, so online capture deliberately returns 503 until configured. Visitors can open a prepared email instead; no false success state is shown. Database capture does not send email notifications: configure an operational database webhook or approved email provider before promising email alerts.

## Before a public commercial launch
Confirm dispatch@lopetransport.co.za receives mail and the external hauler onboarding URL is live. Add the actual dispatch phone, business address, approved B-BBEE details and documented insurance limits when supplied. No unsupported compliance rating, insurance limit, delivery statistic or customer endorsement is displayed. Hero imagery is generated concept photography, labelled accordingly, and can be replaced with company-owned photography.

The supplied brief recommends Vercel. This review version uses private Sites hosting; the custom company domain has not been changed. A custom-domain/Vercel launch requires the relevant account and DNS access. Privacy wording should reflect the final configured retention and operational processes.

## Brand update
The homepage centres on three client paths: request a quote, talk to dispatch and become a partner. The palette is red and black. The original signature logo is bundled locally; see public/assets/LOGO-SOURCE.md for provenance.

## Branded hero
The landing page and Open Graph image use public/assets/hero-continuous.webp, a Lope Trucking Services fleet concept with the supplied signature emblem and red, black and white livery. The earlier image remains available as an unused source reference.
