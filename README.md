# Daybook — daily accounting for small businesses

Daybook is a responsive bookkeeping app for shop owners and independent sellers. It tracks income and expenses, summarizes cash flow, and keeps each account's records private. This repository contains the complete React/Vite client, Express API, and PostgreSQL schema.

## Features

- Email/password registration, login, logout, and a secure HTTP-only session cookie.
- Income and expense entries with amount, date, category, description, and payment method.
- Dashboard totals, cash-flow chart, 7-day/30-day summaries, searchable and filterable history, and CSV export.
- User profile name editing API and protected administrator panel for account roles and aggregate usage counts. Admins do not receive financial details.
- Server-side ownership checks on every transaction read, update, and delete. Registration/profile requests cannot set a role.
- PostgreSQL constraints and indexes, input validation, parameterized SQL, Helmet, credentialed CORS, and authentication rate limiting.

## Technology

React 18, Vite, Recharts, Express, PostgreSQL (`pg`), bcryptjs, signed JWT stored in an HTTP-only cookie, Zod validation.

## Folder structure

```text
client/                  React user interface
  src/App.jsx             Pages, forms, chart and API calls
  src/style.css           Responsive styling
  vite.config.js          React plugin and repository-root env-file loading
server/                  Express REST API
  src/index.js            Routes, validation, startup and admin bootstrap
  src/auth.js             Session verification and role middleware
  src/db.js               PostgreSQL pool
  src/migrate.js          Applies the idempotent database schema
database/schema.sql       Tables, checks, foreign keys and indexes
.env.example              Local configuration template with placeholders only
.npmrc                    Sets bounded registry retries and request timeouts
```

## Run locally

Requirements: Node.js 20 or newer, npm, and PostgreSQL 14 or newer.

1. Create a database named `daybook` in PostgreSQL (for example `createdb daybook`).
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, and `CLIENT_URL` as described below. Replace the `CHANGE_ME` JWT value with a random secret at least 32 characters long; the server rejects the provided placeholder. `INITIAL_ADMIN_*` is commented out and optional; only enable it for first-admin setup.
3. Install dependencies: `npm ci --offline=false`, `npm ci --prefix server --offline=false`, and `npm ci --prefix client --offline=false`. The repository `.npmrc` applies bounded registry retries. If `NPM_CONFIG_OFFLINE=true` is set in your shell or CI environment, the environment variable overrides `.npmrc`; the explicit `--offline=false` on these commands overrides it. If the network is unavailable, npm still cannot download a missing package; reconnect and retry.
4. Initialize the schema with `npm run db:setup` from the repository root. Alternatively, use `psql -v ON_ERROR_STOP=1 -d daybook -f database/schema.sql` so psql stops on the first SQL error.
5. Start both services from the root: `npm run dev`. Client is at http://localhost:5173 and API at http://localhost:4000.

Alternatively, run `npm run dev --prefix server` and `npm run dev --prefix client` in separate terminals. Build the frontend with `npm run build --prefix client`; start the API with `npm start --prefix server`. Vite and the PostgreSQL pool load the root `.env` during local development. The API checks required settings and connects to PostgreSQL before it starts listening.

## Environment variables

| Name | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | server | PostgreSQL connection string |
| `JWT_SECRET` | server | Signs login tokens; use a unique random 32+ character secret |
| `CLIENT_URL` | server | Allowed frontend origin(s), comma-separated if needed |
| `PORT` | server | API port (hosting platforms usually assign it) |
| `NODE_ENV` | server | Use `production` in deployment |
| `COOKIE_SECURE` | server | Set `true` when served over HTTPS |
| `INITIAL_ADMIN_EMAIL` | server | Optional first administrator's email |
| `INITIAL_ADMIN_PASSWORD` | server | Optional password (at least 16 characters); remove after bootstrap |
| `VITE_API_URL` | client build | Public API URL ending in `/api` |

Never commit `.env`. The `.gitignore` excludes it. Vite variables are included in public frontend assets, so never place credentials or secrets in `VITE_*` values.

## How the pieces fit together

The browser renders the React pages and sends JSON requests to the Express API. The API validates every submitted field, reads the signed session cookie, and gets the user's ID from the verified token. For transaction operations, SQL always includes that verified ID in its `WHERE` or `INSERT` clause; the client cannot choose another owner. PostgreSQL enforces that each transaction belongs to a real user and rejects invalid amounts or transaction types. The summary endpoint calculates income, expenses, and net profit (income minus expenses) from the logged-in user's records.

Passwords are hashed with bcrypt before storage. The API sets a signed session token in an HTTP-only cookie, which browser JavaScript cannot read. HTTPS and secure cookie settings should be enabled in production. Email verification and password reset are not included: configure a mail provider and verification workflow before requiring verified addresses.

## API overview

- `POST /api/auth/register`, `/api/auth/login`, `/api/auth/logout`
- `GET /api/auth/me`, `PATCH /api/auth/profile`
- `GET/POST /api/transactions`, `PUT/DELETE /api/transactions/:id`
- `GET /api/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- Admin only: `GET /api/admin/stats`, `GET /api/admin/users?search=...`, `PATCH /api/admin/users/:id/role`
- `GET /api/health`

Transaction amounts and summary totals are returned as decimal strings so PostgreSQL's `NUMERIC` precision is preserved; clients should format them for display without using binary floating-point arithmetic for accounting calculations. Transaction amounts are limited to two decimal places, and date filters are validated as real calendar dates and reject reversed ranges.

## Initialize an administrator

Set `INITIAL_ADMIN_EMAIL` and a unique `INITIAL_ADMIN_PASSWORD` (at least 16 characters) in the server environment before first startup. The server inserts that email as an admin if it does not already exist. It never changes the role of an existing account. Sign in to confirm access, then remove both bootstrap variables from the environment. Admin role changes are restricted to admins. Admin routes show account metadata/counts only and do not expose transaction amounts, descriptions, or categories.

## Deployment: Render API and database, public frontend

The public site and private database are different things: anyone can visit the website and create an account, while PostgreSQL accepts connections only from the backend using a protected connection string. Do not expose the database publicly.

1. Create a GitHub account and an empty repository (do not add a README or license if you plan to push this folder's README). This workspace is already a Git repository. Check `git status` first, then add and push the project:
   ```sh
   git check-ignore -v .env
   git add .
   git status
   git commit -m "Prepare Daybook for deployment"
   git remote add origin https://github.com/YOUR_ACCOUNT/YOUR_REPOSITORY.git
   git push -u origin main
   ```
   Before committing, make sure `git status` does not list `.env`, database exports, or secrets. `.gitignore` excludes `.env` and `.env.*` while allowing the placeholder-only `.env.example`. Commit the package lock files so deployments use reproducible dependency versions.
2. In Render, create a managed PostgreSQL database. Choose a region near the API service and keep network access restricted to Render/internal connections when available. Save the internal connection URL as a secret.
3. Create a Render Web Service from the GitHub repository. Set **Root Directory** to `server`, **Build Command** to `npm ci --offline=false`, and **Start Command** to `npm start`. The server binds to `0.0.0.0` and the port provided by Render in `PORT`.
4. Run `npm run db:setup` from the Render service shell (working directory `server`) or apply the schema using a trusted `psql` session: `psql -v ON_ERROR_STOP=1 "$DATABASE_URL" -f ../database/schema.sql` from the `server` directory. `npm run db:setup` uses the same `DATABASE_URL` configured for the service and wraps the idempotent schema in a transaction. This setup command is not run automatically on every service start.
5. In Render service environment settings add `DATABASE_URL` (the private/internal database URL), `JWT_SECRET` (unique random value, at least 32 characters), `NODE_ENV=production`, `COOKIE_SECURE=true`, and `CLIENT_URL` set to the frontend's exact HTTPS origin (for example `https://daybook.example.com`, without a path or trailing slash). The server refuses startup when `DATABASE_URL`, a non-placeholder `JWT_SECRET`, or `CLIENT_URL` is missing. For the first administrator only, set `INITIAL_ADMIN_EMAIL` and a long random `INITIAL_ADMIN_PASSWORD`; remove them after the first successful bootstrap.
6. Deploy the API and check `https://YOUR-API.onrender.com/api/health` returns `{"ok":true}`.
7. Create a frontend static site (Render Static Site or another static host) connected to the same GitHub repo. Set root `client`, build command `npm ci --offline=false && npm run build`, publish directory `dist`. Add build-time `VITE_API_URL=https://YOUR-API.onrender.com/api`. This value is public and must not contain credentials.
8. Once the static site URL is assigned, set `CLIENT_URL` on the API to that exact HTTPS origin (no trailing path), then redeploy the API. Keep `credentials: include` behavior in the client and CORS credentials enabled in the server. Production session cookies use `Secure` and `SameSite=None` so browser requests work when the static site and API use different provider domains; local HTTP uses `SameSite=Lax`.
9. Open the public HTTPS frontend. Register a normal user, add and edit income/expense records, check date filtering/summary, export CSV, and try signing out/in. Confirm one user's records do not appear in a different account. Test admin using the separately bootstrapped account.
10. For a custom domain, buy/register a domain, add it in your frontend host's domain settings, follow its DNS instructions (usually CNAME and/or apex A/ALIAS records), and wait for DNS/HTTPS certificate provisioning. If the frontend origin changes, update `CLIENT_URL`.

Free tiers change over time and may sleep when idle, have build/runtime limits, limited database storage/retention, or no automated backups. Check current provider pricing and limits before inviting customers. Set up scheduled encrypted backups (for PostgreSQL, periodic `pg_dump` to private storage), restrict access to backup credentials, test restoring backups, and establish a retention policy. Use managed database backups where available. Rotate secrets if exposed and never send database URLs to the browser.

### Alternative: Neon PostgreSQL with Render

This repository includes a `render.yaml` Blueprint for the Render API and static frontend. In Render, choose **New > Blueprint**, connect the GitHub repository, and review the two services before applying. The Blueprint asks for `DATABASE_URL`, `CLIENT_URL`, and `VITE_API_URL`; configure those as follows:

1. In Neon, create a project and database. In the Neon dashboard choose **Connect**, select the project/database, and copy its connection string. Keep it private. Use the pooled connection string for the app if available; the backend needs TLS, which is enabled for production connections.
2. Put that connection string into the Render `daybook-api` service's `DATABASE_URL` secret. The database does not need to be exposed to the public website or browser. Neon connections are authenticated by the secret URL; use Neon's IP restrictions if available on your plan.
3. Set the API's `CLIENT_URL` to the frontend's exact HTTPS origin, such as `https://daybook-web.onrender.com` (no path or trailing slash). If Render assigns a different URL or you use a custom domain, use that instead.
4. Set the static site's `VITE_API_URL` to the API URL plus `/api`, such as `https://daybook-api.onrender.com/api`. Vite embeds this public API address in the browser build; it must not contain a secret.
5. Apply the schema once using the API's Render Shell: run `npm run db:setup` from the `server` root directory. Alternatively, run it locally with the same Neon `DATABASE_URL` temporarily set in your shell. The setup command creates the tables and indexes from `database/schema.sql`; it is safe to repeat.
6. Confirm the API health check at `https://YOUR-API.onrender.com/api/health`, then use the frontend URL to register and try the app. The website is public; the database connection remains protected by the backend-held credential. Never put `DATABASE_URL` in a `VITE_*` variable or GitHub.

If creating Render services manually instead of using the Blueprint, use the settings in the preceding Render section: API root `server`, build `npm ci --offline=false`, start `npm start`; frontend root `client`, build `npm ci --offline=false && npm run build`, publish `dist`. The GitHub Actions workflow at `.github/workflows/ci.yml` runs dependency installation, backend syntax checks, and the Vite production build on pushes and pull requests. It does not connect to PostgreSQL or verify live registration/login.

## Troubleshooting

- **Database connection refused:** check `DATABASE_URL`, database availability, firewall/region, and whether schema SQL was applied.
- **CORS or login loops:** `CLIENT_URL` must exactly match the frontend origin; use HTTPS in production and `COOKIE_SECURE=true`.
- **API 500 at startup:** check Render logs and confirm `JWT_SECRET` is 32+ characters and database variables are set.
- **Frontend shows network errors:** verify the public `VITE_API_URL` build variable includes `/api`, then rebuild the static site.
- **Admin bootstrap did not work:** ensure both `INITIAL_ADMIN_*` values were set before startup; bootstrap does not promote an already existing email.
- **Wrong currency:** the interface currently formats amounts in USD. Update the `money` formatter in `client/src/App.jsx` for your business currency.

## Limitations to address before a sensitive production launch

Email verification, password reset, multi-factor authentication, configurable currency/time zone, automated migration execution, and automated backup scheduling are not included. The app uses a stateless signed cookie token; current tokens remain valid until expiry, so plan secret rotation/session invalidation procedures. Review applicable privacy and tax requirements for your location.
"# expenses" 
"# expenses" 
