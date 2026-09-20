# PetitBakery

PetitBakery is a Cloudflare Pages storefront with Supabase Auth/Postgres and a Hono API. The browser uses only the Supabase publishable key; the Hono Worker keeps the Supabase secret key and is the trusted path for checkout and admin data.

## Setup

1. Create a Supabase project.
2. Add these Auth redirect URLs: `http://localhost:8788/verify/`, `http://localhost:8788/reset-password/`, `https://petitbakery.pages.dev/verify/`, and `https://petitbakery.pages.dev/reset-password/`. Signup and password-reset redirects must be on this allowlist ([Supabase redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls)).
3. Copy `.env.example` to `.env` and fill in the values. Do not commit `.env`. The browser config at `frontend/js/config.js` also needs the `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values; never put `SUPABASE_SECRET_KEY` there.
4. Apply the schema and seed products with the Supabase CLI. Use the database connection string and percent-encode special characters in its password: `npx supabase db push --db-url "postgresql://postgres:ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres"`.
5. Put `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the Worker secret store. The production storefront is `https://petitbakery.pages.dev` and its API is `https://petitbakery-api.velozz.workers.dev`; the deployment workflow writes the browser-safe URL and publishable key configuration.

## Local development commands

Run these from the repository root with Node 22 installed:

Create `.env` once with `cp .env.example .env` (PowerShell: `Copy-Item .env.example .env`), then fill its values. For local use, set `APP_ORIGIN` and `CORS_ORIGIN` to `http://localhost:8788`. Copy `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` into `frontend/js/config.js` for browser auth; keep the secret key out of frontend files. The local Worker uses the Supabase project in `.env`, so use a dedicated development project for signup, checkout, or admin changes.

1. Install the backend dependencies:

   ```sh
   npm ci --prefix backend
   ```

2. Start the local API and storefront together:

   ```sh
   npm start
   ```

   Open `http://localhost:8788/`; the API runs at `http://localhost:8787/`. Stop both with Ctrl+C.
3. Typecheck the backend:

   ```sh
   npm run typecheck --prefix backend
   ```

4. Check browser JavaScript syntax on macOS/Linux:

   ```sh
   find frontend -type f -name '*.js' -print0 | xargs -0 -n 1 node --check
   ```

   In PowerShell:

   ```powershell
   Get-ChildItem frontend -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE } }
   ```

To run either server separately, use `npm run dev --prefix backend` for the API or `node scripts/serve-frontend.mjs` for the storefront. Use these instead of `npm start` when you only need one server.

GitHub Actions expects every `.env` name as a repository secret: `APP_ORIGIN`, `CORS_ORIGIN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, and `POSTGRESQL_DB_PASSWORD`. Also set `SUPABASE_DB_POOLER_HOST` to the hostname from Supabase Dashboard → Connect → Session pooler; GitHub-hosted runners need this IPv4-compatible endpoint for migrations. Pull requests only run checks; pushes to `main` and manual dispatches deploy production.

## Signup confirmation email

The hosted Supabase project uses dashboard-managed email templates. In Authentication → Email → Templates → Confirm signup, set the subject to `Confirm your PetitBakery account` and paste the HTML from [`supabase/templates/confirmation.html`](supabase/templates/confirmation.html). The template uses Supabase's `{{ .ConfirmationURL }}` variable ([email template guide](https://supabase.com/docs/guides/auth/auth-email-templates)). Keep `/verify/` on the redirect allowlist for both localhost and the deployed Pages origin. The app sends new signups there and shows confirmation success or an expired-link recovery action.

## Invite an admin

For each new admin, invite their email from Supabase Dashboard → Authentication → Users → Invite user. Have them accept the email invite and finish setting up their account. Then, in the Dashboard SQL Editor, promote that account's profile (replace the example email):

```sql
update public.profiles
set role = 'admin'
where lower(email) = lower('new-admin@example.com')
returning id, email, role;
```

Confirm the returned row has the intended email and `role = 'admin'`, then have them sign in and open `https://petitbakery.pages.dev/admin/`. If no row is returned, confirm they accepted the invite and that the email is correct. The profile is created from the Auth user with the default `customer` role. Do not use `npm run reset:remote` to add an admin: it deletes every other Auth user and resets remote database data.

The guarded admin reset keeps or invites `whalo8040@gmail.com`, sets its `profiles.role` to `admin`, and removes every other Auth user. It also resets user-created database entities, replays migrations (which seed the products), and resets customer orders. This is for an explicitly selected disposable hosted project only; it is not part of CI or deployment. The Supabase CLI documents that remote `db reset` drops user-created entities and replays migrations ([CLI `db reset`](https://supabase.com/docs/reference/cli/supabase#supabase-db-reset)).

Preview the target without making requests or changing data:

```sh
npm run reset:remote -- --remote --project-ref YOUR_PROJECT_REF --dry-run
```

For an actual reset, omit `--dry-run`. Review the printed project URL and database host, then type the exact project reference when prompted. The command also requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `POSTGRESQL_DB_PASSWORD`, and `SUPABASE_DB_POOLER_HOST` in `.env`; it refuses CI and mismatched project references. Do not add it to an Action or deployment workflow.

Checkout creates an order and demo payment record, but does not collect payment details or charge money.
