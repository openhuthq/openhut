import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'

export async function fakeJakebox(routes: Routes): Promise<FakeJakebox> {
  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    const origin = `http://${req.headers.host}`
    const all: Routes = { 'GET /.well-known/oauth-authorization-server': () => [200, metadataOf(origin)], ...routes }
    const route = all[`${req.method} ${req.url}`]
    const [status, reply] = route ? route({ body, authorization: req.headers.authorization ?? '' }) : [404, { error: { type: 'invalid_request_error', message: `There's no ${req.method} ${req.url}.` } }]
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(reply))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() }
}

function metadataOf(origin: string) {
  return {
    authorization_endpoint: `${origin}/mcp/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/clients`,
  }
}

export type Routes = Record<string, (request: { body: string; authorization: string }) => [number, unknown]>
export type FakeJakebox = { url: string; close: () => void }
