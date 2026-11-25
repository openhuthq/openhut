// openhut.dev, www and keys (M2 step 6): what the openhut-cloud Worker served in front of these assets, moved here so that
// Worker can be deleted. events/ started as a copy of the old Worker's events (that Worker is deleted). The MAIL binding moves too.
import { clientOf, countryOf, ingest, isLive, save, type HubEnv, type Waiter } from './events/hub.ts'
import { telemetryEvent } from '@openhut/common/telemetry.ts'

const HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'cache-control': 'no-cache',
  vary: 'Accept, User-Agent',
}
// `/` is the stable install.sh on dl.openhut.dev (pinned to the stable image by digest, published there by Promote).
const STABLE_INSTALLER = 'https://dl.openhut.dev/channels/stable/install.sh'
const PREVIEW_BOT = /bot|facebookexternalhit|slack|whatsapp|telegram|discord|linkedin|skype|embedly|iframely|preview|crawler|spider/i
const PAGE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"

export default {
  async fetch(request: Request, env: SiteEnv, ctx: Waiter): Promise<Response> {
    const url = new URL(request.url)
    if ((url.pathname === '/api/events' || url.pathname === '/v1/events') && request.method === 'POST') return ingest({ request, env, ctx })
    const installer = url.pathname === '/' && !(request.headers.get('accept') ?? '').includes('text/html') && !PREVIEW_BOT.test(request.headers.get('user-agent') ?? '')
    const asset = installer ? undefined : await env.ASSETS.fetch(new Request(url, request))
    const response = asset ? new Response(asset.body, asset) : new Response(null, { status: 302, headers: { location: STABLE_INSTALLER } })
    for (const [name, value] of Object.entries(HEADERS)) response.headers.set(name, value)
    const counted = response.ok || installer
    if (counted && request.method === 'GET' && isLive(url)) {
      const event = downloadEvent({ installer, path: url.pathname, userAgent: request.headers.get('user-agent') ?? '' })
      if (event) {
        ctx.waitUntil(save({ env, events: [event], country: countryOf(request) }))
      }
    }
    if (response.headers.get('content-type')?.startsWith('text/html')) response.headers.set('content-security-policy', PAGE_CSP)
    return response
  },
}

function downloadEvent({ installer, path, userAgent }: { installer: boolean; path: string; userAgent: string }) {
  if (installer) return telemetryEvent({ name: 'install_script_fetched', properties: { client: clientOf(userAgent) } })
  if (path === '/openhut.tgz') return telemetryEvent({ name: 'release_downloaded' })
  return undefined
}

export type SiteEnv = HubEnv & { ASSETS: { fetch: (request: Request) => Promise<Response> } }
