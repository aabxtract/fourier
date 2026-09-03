import { resolveAgentId, getOverview, getMemory, getRequests } from '../src/logic.js'

/**
 * Fourier hosted viewer — Vercel serverless function.
 * Read-only, code-gated. Routes (rewritten via vercel.json ?route= param):
 *   POST /api/view/auth      { code } -> { ok, agentId }
 *   GET  /api/view/overview  X-Fourier-Code header -> events + policy
 *   GET  /api/view/memory
 *   GET  /api/view/requests
 *
 * Note: in-memory rate limiting is per lambda instance; Neon-side
 * connection pooling (the -pooler endpoint) handles concurrency.
 */

const authAttempts = new Map<string, { count: number; resetAt: number }>()

function rateLimited(map: Map<string, { count: number; resetAt: number }>, key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = map.get(key)
  if (!entry || entry.resetAt < now) {
    map.set(key, { count: 1, resetAt: now + windowMs })
    return false
  }
  entry.count++
  return entry.count > max
}

function ip(req: Request): string {
  return req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const route = url.searchParams.get('route') ?? ''

  try {
    if (route === 'auth' && req.method === 'POST') {
      if (rateLimited(authAttempts, `auth:${ip(req)}`, 15, 5 * 60 * 1000)) {
        return json({ error: 'Too many attempts. Try again in a few minutes.' }, 429)
      }
      const body = (await req.json().catch(() => ({}))) as { code?: unknown }
      const rawCode = typeof body.code === 'string' ? body.code : null
      const agentId = await resolveAgentId(rawCode)
      if (!agentId) return json({ error: 'Unknown or revoked access code.' }, 401)
      return json({ ok: true, agentId })
    }

    // Data routes
    if (rateLimited(authAttempts, `api:${ip(req)}`, 120, 60 * 1000)) {
      return json({ error: 'Slow down.' }, 429)
    }

    const code = req.headers.get('x-fourier-code') ?? url.searchParams.get('code')
    const agentId = await resolveAgentId(code)
    if (!agentId) return json({ error: 'Unknown or revoked access code.' }, 401)

    if (route === 'overview') return json(await getOverview(agentId))
    if (route === 'memory') return json(await getMemory(agentId))
    if (route === 'requests') return json(await getRequests(agentId))

    return json({ error: 'not found' }, 404)
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500)
  }
}
