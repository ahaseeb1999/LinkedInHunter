/**
 * LinkedIn Hunter — License Server
 * Cloudflare Worker entry point
 *
 * Routes:
 *   /api/v1/*           App-facing (HMAC-signed)
 *   /admin/*            Admin auth + bootstrap
 *   /admin/api/*        Admin panel API (session-cookie auth)
 *   /health             Liveness check (no auth)
 */

import {
  verifyAppRequest, trialStart, activate, check, actionToken,
} from './routes/app.js'

import {
  bootstrap, login, logout, me,
  listLicenses, createLicense, updateLicense, revealLicense, deleteLicense,
  listDevices, bootDevice, bootAllDevices,
  activateKillSwitch, deactivateKillSwitch,
  listActivity, stats,
} from './routes/admin.js'

/**
 * CORS: we allow any *.pages.dev or *.workers.dev origin (your admin panel
 * will be on one of those). For real-world non-dev deployments, restrict
 * this to your specific panel domain.
 */
function corsHeaders(request) {
  const origin = request?.headers?.get?.('origin') || ''
  // Allow any pages.dev / workers.dev subdomain (incl. preview deploys with
  // hash subdomains like <hash>.linkedin-hunter-admin.pages.dev), plus
  // localhost for local development.
  const allowed =
    /^https?:\/\/[a-z0-9.-]+\.(pages|workers)\.dev$/i.test(origin) ||
    /^http:\/\/localhost(:\d+)?$/i.test(origin) ||
    /^http:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)
  const allow = allowed ? origin : '*'
  return {
    'access-control-allow-origin': allow,
    'access-control-allow-credentials': allow === '*' ? 'false' : 'true',
    'access-control-allow-headers': 'content-type, authorization, x-timestamp, x-signature',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-max-age': '86400',
    'vary': 'origin',
  }
}

const json = (data, status = 200, request = null) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'content-type': 'application/json',
    ...corsHeaders(request),
  },
})

/**
 * Wrap any Response with CORS headers. Used to ensure every route's response
 * — including ones built by helper json() functions in /routes/ — has the
 * correct cross-origin headers added on top.
 */
function withCors(response, request) {
  const headers = new Headers(response.headers)
  const cors = corsHeaders(request)
  for (const [k, v] of Object.entries(cors)) headers.set(k, v)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

const notFound = () => json({ ok: false, error: 'not_found' }, 404)
const badJson  = () => json({ ok: false, error: 'bad_json' }, 400)
const serverErr = (msg) => json({ ok: false, error: 'server_error', detail: msg }, 500)

async function parseBody(req) {
  if (!req.body) return { ok: true, body: {}, text: '' }
  const text = await req.text()
  if (!text) return { ok: true, body: {}, text: '' }
  try { return { ok: true, body: JSON.parse(text), text } }
  catch { return { ok: false, body: null, text: '' } }
}

function meta(req) {
  return {
    ip: req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || null,
    country: req.headers.get('cf-ipcountry') || null,
  }
}

async function handle(request, env, ctx) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method.toUpperCase()

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) })
    }

    // Health check (no auth)
    if (path === '/health') return json({ ok: true, name: 'linkedin-hunter-api' }, 200, request)

    try {
      // ─────────────────────────────────────────────────────────────
      //  APP ENDPOINTS (HMAC-signed)
      // ─────────────────────────────────────────────────────────────
      if (path.startsWith('/api/v1/') && method === 'POST') {
        const parsed = await parseBody(request)
        if (!parsed.ok) return badJson()

        const sig = await verifyAppRequest(request, env, parsed.text)
        if (!sig.ok) return json({ ok: false, error: sig.error }, 401)

        const m = meta(request)

        if (path === '/api/v1/trial/start')   return trialStart(request, env, parsed.body, m)
        if (path === '/api/v1/activate')      return activate(request, env, parsed.body, m)
        if (path === '/api/v1/check')         return check(request, env, parsed.body, m)
        if (path === '/api/v1/action-token')  return actionToken(request, env, parsed.body, m)
        return notFound()
      }

      // ─────────────────────────────────────────────────────────────
      //  ADMIN BOOTSTRAP / LOGIN (no session yet)
      // ─────────────────────────────────────────────────────────────
      if (path === '/admin/bootstrap' && method === 'POST') {
        const parsed = await parseBody(request)
        if (!parsed.ok) return badJson()
        return bootstrap(request, env, parsed.body)
      }
      if (path === '/admin/login' && method === 'POST') {
        const parsed = await parseBody(request)
        if (!parsed.ok) return badJson()
        return login(request, env, parsed.body, meta(request))
      }
      if (path === '/admin/logout' && method === 'POST') {
        return logout(request, env)
      }

      // ─────────────────────────────────────────────────────────────
      //  ADMIN API (session-cookie auth — each handler checks)
      // ─────────────────────────────────────────────────────────────
      if (path === '/admin/api/me' && method === 'GET')           return me(request, env)
      if (path === '/admin/api/stats' && method === 'GET')        return stats(request, env)
      if (path === '/admin/api/activity' && method === 'GET')     return listActivity(request, env)

      // Licenses CRUD
      if (path === '/admin/api/licenses' && method === 'GET')     return listLicenses(request, env)
      if (path === '/admin/api/licenses' && method === 'POST') {
        const parsed = await parseBody(request)
        if (!parsed.ok) return badJson()
        return createLicense(request, env, parsed.body)
      }

      // /admin/api/licenses/:id  PATCH | DELETE
      const idMatch = path.match(/^\/admin\/api\/licenses\/(\d+)$/)
      if (idMatch && method === 'PATCH') {
        const parsed = await parseBody(request)
        if (!parsed.ok) return badJson()
        return updateLicense(request, env, parsed.body, { id: idMatch[1] })
      }
      if (idMatch && method === 'DELETE') {
        return deleteLicense(request, env, null, { id: idMatch[1] })
      }

      // /admin/api/licenses/:id/reveal  GET — decrypt and return raw key
      const revealMatch = path.match(/^\/admin\/api\/licenses\/(\d+)\/reveal$/)
      if (revealMatch && method === 'GET') return revealLicense(request, env, null, { id: revealMatch[1] })

      // /admin/api/licenses/:id/devices  GET
      const devMatch = path.match(/^\/admin\/api\/licenses\/(\d+)\/devices$/)
      if (devMatch && method === 'GET') return listDevices(request, env, null, { id: devMatch[1] })

      // /admin/api/licenses/:id/devices/:device_id  DELETE
      const devBootMatch = path.match(/^\/admin\/api\/licenses\/(\d+)\/devices\/([a-f0-9]{64})$/)
      if (devBootMatch && method === 'DELETE') {
        return bootDevice(request, env, null, { id: devBootMatch[1], device_id: devBootMatch[2] })
      }

      // /admin/api/licenses/:id/boot-all  POST
      const bootAllMatch = path.match(/^\/admin\/api\/licenses\/(\d+)\/boot-all$/)
      if (bootAllMatch && method === 'POST') return bootAllDevices(request, env, null, { id: bootAllMatch[1] })

      // Kill switch
      if (path === '/admin/api/kill-switch' && method === 'POST') {
        const parsed = await parseBody(request)
        if (!parsed.ok) return badJson()
        return activateKillSwitch(request, env, parsed.body)
      }
      if (path === '/admin/api/kill-switch' && method === 'DELETE') {
        return deactivateKillSwitch(request, env)
      }

      return notFound()
    } catch (e) {
      console.error('[fatal]', e.stack || e.message)
      return serverErr(e.message)
    }
}

export default {
  async fetch(request, env, ctx) {
    // Every response — including ones built by route helpers — is augmented
    // with the correct CORS headers here. No way for a route to forget them.
    const response = await handle(request, env, ctx)
    return withCors(response, request)
  },
}
