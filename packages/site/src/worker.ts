const HEADERS = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'SAMEORIGIN',
  'cache-control': 'no-cache',
  vary: 'Accept',
}
const PAGE_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const installer = url.pathname === '/' && !(request.headers.get('accept') ?? '').includes('text/html')
    if (installer) url.pathname = '/install.sh'
    const asset = await env.ASSETS.fetch(new Request(url, request))
    const response = new Response(asset.body, asset)
    for (const [name, value] of Object.entries(HEADERS)) response.headers.set(name, value)
    if (installer) response.headers.set('content-type', 'text/plain; charset=utf-8')
    else if (response.headers.get('content-type')?.startsWith('text/html')) response.headers.set('content-security-policy', PAGE_CSP)
    return response
  },
}

type Env = { ASSETS: { fetch: (request: Request) => Promise<Response> } }
