# Lope Trucking Services

Corporate freight website for Lope Trucking Services, with the approved red-and-black identity and continuous trailer livery.

## Vercel setup

The deployable app is in `lope-transport-web/` inside the GitHub repository. In Vercel Project Settings → Build and Deployment, keep Root Directory set to `lope-transport-web` (matching the existing project setting).

Use the Next.js framework preset, Node.js 22.x, `npm ci` for installation, and `npm run build` for the build. Leave Output Directory at the Next.js default. The app’s vercel.json declares the framework and commands. Redeploy the latest main commit after this repair.

## Local development

From the repository root, run `cd lope-transport-web`. Use Node.js 22.13 or newer, then `npm ci`, `npm run dev`. Production: `npm run build`, `npm start`.

## Freight enquiries

Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY as server-only environment variables. Apply db/freight-enquiries.sql to the intended Supabase project. Without these settings, the form offers a prepared email to dispatch@lopetransport.co.za and never reports a false submission success. Email alerts require a separately configured database webhook or email provider.

The partner portal is https://onboarding.lopetransport.co.za. Hero imagery is a branded fleet concept. Confirm operating contacts, insurance terms and business details before commercial launch.
