# Lope portal email activation — Afrihost

Sender: **Lope Trucking Services <no-reply@lopetransport.co.za>**.

## What is already verified

Email sign-up is enabled in the connected Supabase project; public registration is allowed and email confirmation is required. The profile-creation and email-sync triggers are installed. The website includes client, hauler and admin dashboards. Registration stores identity/password authentication in Supabase Auth and company/contact details in the protected `profiles` table; new accounts await review. Passwords are not stored in application tables or sent by email.

## Finish the email connection in Supabase

Open [Auth email settings](https://supabase.com/dashboard/project/ksdjhmzneffrothktcvb/auth/smtp). Enable custom SMTP and use the outgoing-mail settings from the Afrihost mailbox for **no-reply@lopetransport.co.za**:

| Setting | Value |
| --- | --- |
| Sender address | no-reply@lopetransport.co.za |
| Sender name | Lope Trucking Services |
| SMTP host | The outgoing server shown in Afrihost ClientZone; normally mail.lopetransport.co.za |
| Port | 465 with SSL/TLS, as documented by Afrihost |
| Username | no-reply@lopetransport.co.za |
| Password | Enter the mailbox password directly in Supabase, never in chat, source files or Vercel public variables |

Afrihost may require its actual hosting-server name when the mail.domain hostname does not work with the certificate. Find it in ClientZone → Hosting → your domain → Account Overview. Do not disable TLS to work around a hostname/certificate problem. Confirm that the mailbox permits authenticated SMTP sending from Supabase.

Source: [Afrihost domain SMTP settings](https://help.afrihost.com/entry/how-to-set-up-your-domain-email-account-in-gmail/).

## Configure the website address

Under [Auth URL configuration](https://supabase.com/dashboard/project/ksdjhmzneffrothktcvb/auth/url-configuration), set Site URL to the ONE public address currently serving the latest production deployment. Do not use localhost or an old deployment ID. If the active address is `https://lope-transport-web-6a57-beta.vercel.app`, use that until your custom domain is serving the same site.

Add the exact production URLs `/portal/auth/callback`, `/portal/auth/callback?next=reset-password` and `/portal/auth/confirm` to the Redirect URLs list. Add equivalent URLs for any other production domain you actually use. Keep email confirmation enabled.

## Install the branded templates after deploying this update

Open [Auth email templates](https://supabase.com/dashboard/project/ksdjhmzneffrothktcvb/auth/templates).

- Confirm sign up: subject **Welcome to Lope — confirm your portal account**; paste `confirmation.html`.
- Reset password: subject **Reset your Lope portal password**; paste `recovery.html`.

The templates include the user's sign-in email, a verification/reset link and the portal link. The password remains the one the user chooses. The new `/portal/auth/confirm` route exchanges the token for a server-side session and redirects to the dashboard or password-reset screen. Unlike the existing PKCE callback, this template route does not depend on opening the email in the original registration browser. The original callback remains supported.

Docs: [Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [production SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Final delivery test — required before inviting customers

After the website update, SMTP settings and templates are saved, use a real mailbox you control to create one Client account. The owner should choose and enter their own password. Confirm that the email arrives from no-reply@lopetransport.co.za, the link opens the current site and the client dashboard loads. Check the profile under Admin → Accounts; activate it after review. Test Forgot password separately and confirm the reset email arrives. Do not mark delivery complete based only on a successful API response.

No live SMTP credential has been supplied or saved by this update. Branded templates are supplied for installation; they are not yet installed in the project's Auth settings. End-to-end email delivery remains unverified until the owner completes the SMTP connection and checks the received message.

## Sender clarification

The account owner confirmed the automated-mail mailbox is no-reply@lopetransport.co.za. The website operations/contact address remains ops@lopetransport.co.za. The Supabase dashboard masks the saved sender address and SMTP username in assistant observations, so their current values have not been independently verified. Confirm both fields match the no-reply mailbox, and that the saved password belongs to that mailbox. No SMTP credential was changed during this check.
