import { clientOf, forward, ingest, isLive, type HubEnv, type Waiter } from './hub.ts'
import { telemetryEvent } from '@openhut/common/telemetry.ts'

const HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'cache-control': 'no-cache',
  vary: 'Accept',
}
const PAGE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdn.databuddy.cc; connect-src 'self' https://basket.databuddy.cc; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"

export default {
  async fetch(request: Request, env: Env, ctx: Waiter): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/events' && request.method === 'POST') return ingest({ request, env, ctx })
    const installer = url.pathname === '/' && !(request.headers.get('accept') ?? '').includes('text/html')
    if (installer) url.pathname = '/install.sh'
    const asset = await env.ASSETS.fetch(new Request(url, request))
    const response = new Response(asset.body, asset)
    for (const [name, value] of Object.entries(HEADERS)) response.headers.set(name, value)
    if (response.ok && request.method === 'GET' && isLive(url)) {
      const event = downloadEvent({ installer, path: url.pathname, userAgent: request.headers.get('user-agent') ?? '' })
      if (event) ctx.waitUntil(forward({ env, events: [event] }))
    }
    if (installer) response.headers.set('content-type', 'text/plain; charset=utf-8')
    else if (response.headers.get('content-type')?.startsWith('text/html')) response.headers.set('content-security-policy', PAGE_CSP)
    return response
  },
}

function downloadEvent({ installer, path, userAgent }: { installer: boolean; path: string; userAgent: string }) {
  if (installer) return telemetryEvent({ name: 'install_script_fetched', properties: { client: clientOf(userAgent) } })
  if (path === '/openhut.tgz') return telemetryEvent({ name: 'release_downloaded' })
  return undefined
}

type Env = HubEnv & { ASSETS: { fetch: (request: Request) => Promise<Response> } }
