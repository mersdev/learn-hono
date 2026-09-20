# PetitBakery

PetitBakery is a Cloudflare Pages storefront with Supabase Auth/Postgres and a Hono API. The browser uses only the Supabase publishable key; the Hono Worker keeps the Supabase secret key and is the trusted path for checkout and admin data.

## Setup

1. Create a Supabase project.
2. Add these Auth redirect URLs: `http://localhost:8788/verify/`, `http://localhost:8788/reset-password/`, `https://petitbakery.pages.dev/verify/`, and `https://petitbakery.pages.dev/reset-password/`. Signup and password-reset redirects must be on this allowlist ([Supabase redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls)).
3. Copy `.env.example` to `.env` and fill in the values. Do not commit `.env`. The browser config at `frontend/js/config.js` also needs the `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` values; never put `SUPABASE_SECRET_KEY` there.
4. Apply the schema and seed products with the Supabase CLI. Use the database connection string and percent-encode special characters in its password: `npx supabase db push --db-url "postgresql://postgres:ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres"`.
5. GitHub Actions uses repository secrets as the source of truth for production. The deployment workflow syncs the values required at request time into the Worker runtime; do not enter them manually in the Cloudflare dashboard. The production storefront is `https://petitbakery.pages.dev` and its API is `https://petitbakery-api.velozz.workers.dev`.

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

Add the required production values as GitHub repository secrets: `APP_ORIGIN`, `CORS_ORIGIN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWKS_URL`, `POSTGRESQL_DB_PASSWORD`, and `SUPABASE_DB_POOLER_HOST` (the hostname from Supabase Dashboard → Connect → Session pooler; GitHub-hosted runners need this IPv4-compatible endpoint for migrations). `ADMIN_BOOTSTRAP_SECRET` is optional and only needed while enabling first-admin bootstrap. The Worker cannot read GitHub Secrets directly, so the deploy workflow copies runtime values into the Worker; when `ADMIN_BOOTSTRAP_SECRET` is absent from GitHub, the workflow removes any previous Worker copy. Pull requests only run checks; pushes to `main` and manual dispatches deploy production.

## Signup confirmation email

The hosted Supabase project uses dashboard-managed email templates. In Authentication → Email → Templates → Confirm signup, set the subject to `Confirm your PetitBakery account` and paste the HTML from [`supabase/templates/confirmation.html`](supabase/templates/confirmation.html). The template uses Supabase's `{{ .ConfirmationURL }}` variable ([email template guide](https://supabase.com/docs/guides/auth/auth-email-templates)). Keep `/verify/` on the redirect allowlist for both localhost and the deployed Pages origin. The app sends new signups there and shows confirmation success or an expired-link recovery action.

## Admin invitations and first admin

### Bootstrap the first admin

The first admin must be created before anyone can use the admin portal. This endpoint only works when the Supabase project has no Auth users. Generate a long random token (for example, `openssl rand -hex 32`) and add it as the `ADMIN_BOOTSTRAP_SECRET` GitHub repository secret under **Settings → Secrets and variables → Actions**. Run the `Verify and deploy PetitBakery backend` workflow so it syncs the token to the Worker runtime. The Worker needs the token at runtime to authorize this request; you do not need to enter it manually in Cloudflare. Then call the API with an unused email:

Keep the generated token available for the request. Load it into your shell without adding it to command history (the input is hidden):

```sh
read -s ADMIN_BOOTSTRAP_SECRET
export ADMIN_BOOTSTRAP_SECRET
```

```sh
curl --request POST 'https://petitbakery-api.velozz.workers.dev/api/bootstrap/admin' \
  --header "Authorization: Bearer $ADMIN_BOOTSTRAP_SECRET" \
  --header 'Content-Type: application/json' \
  --data '{"email":"owner@example.com"}'
```

For local development, set `ADMIN_BOOTSTRAP_SECRET` in `.env`, use `http://localhost:8787/api/bootstrap/admin`, and set `APP_ORIGIN=http://localhost:8788`. The invite redirects to `/verify/`, which must be on Supabase's Auth redirect allowlist. After the API confirms success, delete `ADMIN_BOOTSTRAP_SECRET` from GitHub repository secrets and run the deploy workflow again; it removes the Worker runtime copy. Keep the value out of source control and logs. The first admin must accept the emailed invitation before signing in.

If the invite is sent but the API cannot grant the admin role, remove that pending user from Supabase Dashboard → Authentication → Users, then retry the bootstrap request.

### Invite more admins

An existing admin can open `https://petitbakery.pages.dev/admin/`, enter an unused email in the overview's **Invite an admin** form, and click **Invite admin**. The new user accepts the emailed invite, then signs in to use the admin portal. Existing Auth accounts are rejected; ask for an unused email address instead.

### Reset a remote project

The guarded remote reset removes every Auth user, including admins, and resets user-created database entities, replays migrations (which seed the products), and resets customer orders. It does not invite or promote anyone. Afterward, bootstrap the first admin using the steps above. Use this only for an explicitly selected disposable hosted project; it is not part of CI or deployment. The Supabase CLI documents that remote `db reset` drops user-created entities and replays migrations ([CLI `db reset`](https://supabase.com/docs/reference/cli/supabase#supabase-db-reset)).

Preview the target without making requests or changing data:

```sh
npm run reset:remote -- --remote --project-ref YOUR_PROJECT_REF --dry-run
```

For an actual reset, omit `--dry-run`. Review the printed project URL and database host, then type the exact project reference when prompted. The command also requires `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `POSTGRESQL_DB_PASSWORD`, and `SUPABASE_DB_POOLER_HOST` in `.env`; it refuses CI and mismatched project references. Do not add it to an Action or deployment workflow.

Checkout creates an order and demo payment record, but does not collect payment details or charge money.
