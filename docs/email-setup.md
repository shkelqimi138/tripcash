# TripCash Transactional Email Setup

## Production status — 2026-09-08

Completed: TripCash-domain custom SMTP, authenticated sender, SPF/DKIM/DMARC DNS,
all listed Supabase authentication templates, the transactional-email SQL migration,
the Cloudflare `SUPABASE_ANON_KEY` secret, welcome-endpoint deployment, and production
verification. Do not repeat the completed setup above unless email configuration or
templates change.

## Sender

- Use a verified TripCash sender such as `TripCash <hello@send.tripcash.de>`.
- Keep `support@tripcash.de` as the reply-to address.
- Verify SPF and DKIM for the sending subdomain and publish an appropriate DMARC
  policy for the parent domain.
- Disable provider click tracking for authentication messages so confirmation links
  are not rewritten.

## Supabase authentication mail

Configure Resend as Supabase custom SMTP under Authentication settings. Set the
sender name to `TripCash` and use the verified TripCash-domain From address.

Copy these templates into Supabase Authentication → Email Templates:

- Confirm signup — subject `{{ .Token }} is your TripCash confirmation code`; use
  `supabase/email-templates/confirmation.html`. It includes both the code in
  `123-456` format and the confirmation link.
- Reset password — subject `Reset your TripCash password`; use
  `supabase/email-templates/recovery.html`.
- Invite user — subject `You’re invited to TripCash`; use `supabase/email-templates/invite.html`.
- Magic link / OTP — subject `{{ .Token }} is your TripCash login code`; use
  `supabase/email-templates/magic-link.html`. It includes both the six-digit code
  in `123-456` format and the one-time login link.
- Change email — subject `Confirm your new TripCash email`; use `supabase/email-templates/email-change.html`.
- Reauthentication — subject `{{ .Token }} is your TripCash verification code`; use
  `supabase/email-templates/reauthentication.html`.
- Password-changed notification — use `supabase/email-templates/password-changed.html`.
- Account closure — the authenticated `/api/account-closure` route sends the
  matching `supabase/email-templates/account-closed.html` design after deletion.
- Email-changed notification — use `supabase/email-templates/email-changed.html`.
- Identity linked and unlinked notifications — use `supabase/email-templates/identity-changed.html`.

Use the same visual system for invite, magic-link, email-change, reauthentication,
and enabled security-notification templates before launch.

## Welcome message

Send `supabase/email-templates/welcome.html` only after the account email is confirmed. The
implemented `functions/api/welcome.js` sender runs server-side through Resend. The
authenticated Supabase claim functions in
`supabase/sql/migrations/transactional-email.sql` and a
Resend idempotency key prevent repeat delivery. This delivery must be idempotent.
Add `SUPABASE_ANON_KEY` as a
Cloudflare secret; never ship the Resend key in a client.

## Account closure security

Add `SUPABASE_SERVICE_ROLE_KEY` as an encrypted, server-only Cloudflare secret.
The account-closure Function uses it only after verifying the user's current
session and recent sign-in. Never place this key in web or native client code.

Enable Turnstile under Supabase Authentication bot protection and provide the
production `SUPABASE_AUTH_CAPTCHA_SECRET` when applying the managed Supabase
configuration. The test secret used by the local integration runner must never be
used in production.

## Contact form

The contact endpoint already batches two messages through Resend: the inquiry to
`support@tripcash.de` and a branded receipt to the visitor. Set
`CONTACT_FROM_EMAIL` to the verified TripCash-domain sender in the hosting
environment before deployment.

## Production verification — completed 2026-09-08

Confirmation, recovery, contact receipt, reply-to behavior, spam placement, mobile
rendering, and the one-time welcome message passed using disposable accounts. The
physical-iPhone confirmation and recovery callback results are recorded in
the private release checklist. Repeat these checks only after email, callback,
or provider
configuration changes.
