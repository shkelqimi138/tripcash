# Local Supabase integration environment

This project is intentionally local-only and must never be linked to the production
Supabase project. The integration schema is a snapshot of the already-applied
TripCash schema.

Start the local stack with `supabase start`, then run `npm run test:integration`.
The integration runner first verifies that both Supabase URLs use a loopback address,
resets only the local database, and loads `supabase/sql/schema.sql` directly into the
named local Docker container. The destructive fresh-install schema is intentionally
not stored in `supabase/migrations`, where it could be mistaken for a production
migration.

The suite covers Auth, RLS, invitations, password recovery, admin access, account
deletion, and exchange-rate failure behavior.

## SQL inventory

| File | Purpose |
|---|---|
| `sql/schema.sql` | Destructive fresh-project schema used by local integration tests |
| `sql/migrations/remaining-migration.sql` | Applied production feature migration; retain as history |
| `sql/migrations/cross-device-preferences.sql` | Applied production preference migration; retain as history |
| `sql/migrations/transactional-email.sql` | Applied production welcome-email migration; retain as history |
| `sql/migrations/security-stage-1.sql` | Applied production security migration; retain as history |
| `sql/migrations/security-hardening.sql` | Applied production security migration; retain as history |
| `sql/migrations/security-hotfix.sql` | Applied production invite-policy correction; retain as history |
| `sql/migrations/account-data-controls.sql` | Applied production account-data deletion migration; retain as history (2026-09-17) |
| `sql/migrations/remove-apple-revocation-token-storage.sql` | Applied production cleanup removing stored Apple revocation tokens; retain as history |
| `sql/migrations/restrict-account-deletion.sql` | Applied production restriction of account deletion to the service role; retain as history |
| `sql/migrations/allow-secret-key-account-deletion.sql` | Applied production grant letting the service role delete accounts with current secret keys; retain as history |
| `sql/migrations/grant-service-role-schema-usage.sql` | Applied manually in production on 2026-10-14 so the service role can resolve public functions; retain as history |
| `sql/migrations/receipt-scan-rate-limit.sql` | Apply once in production before enabling receipt extraction; atomically limits scans per confirmed account |
| `sql/migrations/admin-stats-minimal-fields.sql` | Apply once in production; limits admin statistics to the fields the admin screen shows |
| `sql/seeds/demo-seed.sql` | Optional screenshot/demo data for its explicitly named test user |

Do not run an applied production migration again. Do not run `schema.sql` against
production.
