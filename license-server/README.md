# LinkedIn Hunter — License Server

Runs on Cloudflare Workers. Free tier handles thousands of users.

## What's in here

```
license-server/
├── src/
│   ├── index.js              # Main Worker entry point + router
│   ├── routes/
│   │   ├── app.js            # App-facing endpoints (HMAC-signed)
│   │   └── admin.js          # Admin panel API (session-auth)
│   └── lib/
│       ├── crypto.js         # HMAC + bcrypt + random helpers
│       ├── jwt.js            # License token signing
│       ├── keys.js           # License key generation + parsing
│       ├── db.js             # D1 query helpers
│       └── auth.js           # Admin session management
├── scripts/
│   ├── set-secrets.js        # Generates + uploads all Workers secrets
│   └── create-admin.js       # Creates the first admin (via bootstrap)
├── test/
│   └── run.js                # 15 tests against crypto, JWT, keys
├── schema.sql                # D1 schema
├── wrangler.toml             # Cloudflare Worker config
└── package.json
```

## Security overview

| What | How it's protected |
|---|---|
| License keys | HMAC-SHA256 hashed with `KEY_PEPPER` before storage. Raw key shown only ONCE in admin panel. |
| Device IDs | HMAC-SHA256 of hardware fingerprint with `DEVICE_PEPPER`. Server never stores raw hardware info. |
| Admin passwords | bcrypt cost-12 + `ADMIN_PEPPER`. Brute-force impractical. |
| App↔Server requests | HMAC signature with `API_HMAC_SECRET`, 5-min replay window. |
| Session cookies | 64-byte random, HttpOnly, Secure, SameSite=Strict, server-side revocation. |
| License tokens | JWT signed with `JWT_SECRET`, 24h TTL, encrypted on user disk via DPAPI. |
| Action tokens | Short-lived (10 min) per-action permission slips. Even local crackers can't forge. |

All peppers live in **Cloudflare Workers Secrets** — never in code, never in git.

## Deploy in 10 minutes

### Step 1 — Install dependencies (1 min)

```powershell
cd s:\LinkedInHunter\license-server
npm install
```

### Step 2 — Log in to Cloudflare (1 min)

```powershell
wrangler login
```

Opens your browser. Click "Allow" to link Wrangler to your Cloudflare account.

### Step 3 — Create the D1 database (1 min)

```powershell
wrangler d1 create linkedin-hunter-db
```

Output looks like:

```
✅ Successfully created DB 'linkedin-hunter-db' in region xxxx
Created your database using D1's new storage backend.

[[d1_databases]]
binding = "DB"
database_name = "linkedin-hunter-db"
database_id = "abc123-def456-789..."
```

**Copy the `database_id`** and paste it into `wrangler.toml` (replace `PASTE_DATABASE_ID_HERE_AFTER_WRANGLER_D1_CREATE`).

### Step 4 — Apply the schema (1 min)

```powershell
npm run db:schema
```

Creates all tables. Should show: `🌀 Executing X queries — ✅ Successfully executed Y queries`.

### Step 5 — Set all secrets (2 min)

```powershell
npm run secrets:set
```

This generates strong random values for every secret (KEY_PEPPER, DEVICE_PEPPER, etc.) and uploads them to Cloudflare. **The script prints `API_HMAC_SECRET` and `ADMIN_BOOTSTRAP_TOKEN` at the end — copy both to a safe place. You need them later.**

### Step 6 — Deploy the Worker (30 sec)

```powershell
npm run deploy
```

Output:

```
✨ Success! Deployed to https://linkedin-hunter-api.<your-subdomain>.workers.dev
```

This is your live API URL. **Save it.**

### Step 7 — Create your first admin (1 min)

```powershell
$env:SERVER_URL = "https://linkedin-hunter-api.<your-subdomain>.workers.dev"
$env:BOOTSTRAP_TOKEN = "<paste from step 5 output>"
node scripts/create-admin.js --email abdulhaseebshykh1999@gmail.com --password "PickStrongPassword!"
```

Should print: `✓ Admin created: abdulhaseebshykh1999@gmail.com`

You're now ready to log in via the admin panel (built in Phase C).

### Step 8 — Verify (30 sec)

```powershell
# Should return { "ok": true, "name": "linkedin-hunter-api" }
curl https://linkedin-hunter-api.<your-subdomain>.workers.dev/health
```

If you see that JSON, your server is live and reachable from anywhere in the world. Cost: $0/month.

## Updating the server later

After any code change:

```powershell
npm test          # all 15 tests should pass
npm run deploy    # pushes update to Cloudflare
```

Live within ~5 seconds globally.

## Watching live logs

```powershell
npm run tail
```

Streams every request and `console.log` from Cloudflare's edge to your terminal. Invaluable during testing.

## Common operations

```powershell
# See what's in the database
wrangler d1 execute linkedin-hunter-db --command "SELECT id, key_prefix, name, max_seats, status FROM licenses"

# Quick health check
curl https://linkedin-hunter-api.<sub>.workers.dev/health

# Tail logs from production
wrangler tail
```

## API endpoints summary

### App endpoints (HMAC-signed)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/trial/start` | Start a 3-day trial for this device |
| POST | `/api/v1/activate` | Bind a license key to this device |
| POST | `/api/v1/check` | Heartbeat (am I still allowed?) |
| POST | `/api/v1/action-token` | Short-lived token for sensitive actions |

### Admin endpoints (session-cookie auth)

| Method | Path | Purpose |
|---|---|---|
| POST | `/admin/bootstrap` | One-time setup (creates first admin) |
| POST | `/admin/login` | Sign in |
| POST | `/admin/logout` | Sign out |
| GET  | `/admin/api/me` | Current admin info |
| GET  | `/admin/api/stats` | Dashboard counters |
| GET  | `/admin/api/activity` | Activity log (last N events) |
| GET  | `/admin/api/licenses` | List all license keys |
| POST | `/admin/api/licenses` | Create new key (returns raw key once) |
| PATCH | `/admin/api/licenses/:id` | Update (name, seats, status, etc.) |
| GET  | `/admin/api/licenses/:id/devices` | List devices on this key |
| DELETE | `/admin/api/licenses/:id/devices/:device_id` | Boot a device |
| POST | `/admin/api/licenses/:id/boot-all` | Boot all devices on a key |
| POST | `/admin/api/kill-switch` | Activate global kill switch |
| DELETE | `/admin/api/kill-switch` | Deactivate kill switch |
