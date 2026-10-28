# Automatic Sign in with Apple revocation

When an Apple-linked user deletes their account in the iOS app, TripCash asks them
to confirm with Apple again. The app sends the resulting one-time authorization
code to the account-closure Function. The Function exchanges it with Apple,
verifies that Apple's returned identity belongs to the same linked Supabase user,
revokes the returned refresh/access token, and then deletes the TripCash account.

TripCash does not retain Apple provider tokens. Account deletion never depends on
Apple succeeding: if confirmation, exchange, or revocation is unavailable, deletion
still completes and the user receives the existing manual-removal instructions.

## Known identifiers

- Apple Team ID: `945267LMP6`
- Native App ID and deletion-flow client ID: `com.tripcash.app`
- The Services ID configured in Supabase remains the client for browser OAuth. Do
  not use that Services ID when exchanging the native authorization code.

## One-time owner setup

1. Because the earlier storage migration was applied, run
   `supabase/sql/migrations/remove-apple-revocation-token-storage.sql` in the
   production Supabase SQL Editor.
2. In Apple Developer, confirm that App ID `com.tripcash.app` has the Sign in with
   Apple capability and that the signing key is associated with it.
3. In Cloudflare Pages → TripCash → Settings → Variables and Secrets, add these as
   encrypted production secrets:
   - `APPLE_TEAM_ID`: `945267LMP6`
   - `APPLE_CLIENT_ID`: `com.tripcash.app`
   - `APPLE_KEY_ID`: the 10-character ID of the Sign in with Apple key
   - `APPLE_PRIVATE_KEY`: the complete contents of the matching `.p8` file
4. Deploy the Cloudflare Pages project.
5. Create and distribute a new iOS build because the native Apple confirmation
   plugin and entitlement are part of the app binary.

Never put the `.p8` key or generated Apple client-secret JWT in Git, chat,
screenshots, Xcode build settings, or the mobile bundle. The separate Apple
client-secret JWT configured in Supabase still follows its own renewal schedule.

## Acceptance test

Use a disposable Apple test account:

1. Sign in with Apple in the new iOS build.
2. Delete the TripCash account in Profile and complete the Apple confirmation.
3. Confirm deletion completes without the manual Apple-removal prompt.
4. Confirm TripCash no longer appears as authorized, or that signing in again asks
   Apple to authorize the app again.
5. Repeat once with the Apple secrets temporarily unavailable and confirm deletion
   still completes while the manual-removal fallback is shown.
6. Cancel the Apple confirmation once and confirm the TripCash account is not
   deleted.
7. Simulate an Apple confirmation failure and confirm deletion still completes
   with the manual-removal fallback.

Do not test deletion with an account containing data that must be preserved.
