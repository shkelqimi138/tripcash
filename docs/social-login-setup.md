# Apple and Google sign-in

## Production status — 2026-09-08

Completed: Google OAuth client and Supabase provider, Apple App ID, Services ID,
signing key, client-secret JWT and Supabase provider, production Site URL
`https://tripcash.de/app`, web redirects, and the verified HTTPS callback
`https://tripcash.de/auth-callback`.

Completed production checks: existing-account Google login, Apple private-relay
login, OAuth cancellation, and web callbacks. Do not repeat the completed provider
configuration or web checks unless authentication behavior changes.

Native iOS and Android verification and Apple client-secret renewal are tracked in
the private release checklists.

The deployed `/.well-known/apple-app-site-association` and
`/.well-known/assetlinks.json` files bind the HTTPS callback to the native apps. Add
the Google Play production App Signing SHA-256 fingerprint to `assetlinks.json` when
it is available; the checked-in fingerprint is for the local Android debug key.

The shared web/iOS/Android implementation reads enabled providers from Supabase
Auth settings. Buttons stay hidden until their provider is enabled. Native builds
open the official Capacitor Browser plugin and return through the existing callback.
The user accepts terms before starting. Guest users must save their account with
email first; this flow does not switch or automatically merge guest identities.

## Completed owner configuration reference

1. Google Cloud: configure the OAuth consent screen, authorized domain `tripcash.de`,
   and a Web application OAuth client. Set its authorized redirect URI to
   `https://msnholvugsehlxkvzlxp.supabase.co/auth/v1/callback`.
2. Enter that Google client ID and secret in Supabase Authentication → Providers →
   Google. Keep secrets in the provider dashboard, never in source code or chat.
3. Apple Developer: enable Sign in with Apple for the app, register the associated
   Services ID for web OAuth, and configure the same Supabase HTTPS callback. Use
   Apple's required domain verification and associate the Services ID with the app.
4. Generate the Apple signing key/client secret and enter the secret in
   Supabase's Apple provider. The Client IDs field must contain the web Services
   ID first and the native App ID `com.tripcash.app` second, separated by a comma.
   Supabase uses the first ID for browser OAuth and accepts either ID as the
   audience for native token sign-in. Record the secret expiry and renew before
   expiration. Keep the private key in the existing credential backup.
5. Supabase Auth URL Configuration: allow `https://tripcash.de/app` and
   `https://tripcash.de/auth-callback`. Keep the production Site URL on the custom domain.
6. Enable each provider only after its configuration is complete; the app will
   then show that provider on its next launch.

## Native verification reference

Provider login cannot be validated end-to-end with mocked credentials. The exact
iOS and Android cases are centralized in the private release checklists; web
production verification is complete.

References: [Supabase Google](https://supabase.com/docs/guides/auth/social-login/auth-google),
[Supabase Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple),
[Capacitor Browser](https://capacitorjs.com/docs/apis/browser).
