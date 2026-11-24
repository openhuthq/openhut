import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, type webcrypto } from 'node:crypto'
import { request } from 'node:http'
import { duplexPair } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import Fastify from 'fastify'
import { facesOf } from '@openhut/common/cloud/faces.ts'
import { bootCloud, devSignIn, hasCloud, webBrowser } from '../cloud/real-cloud.ts'

const skip = hasCloud ? false : 'private/api isn’t checked out here'

async function newWindow(url: string) {
  const { openhutCloud } = await import('@openhut/common/cloud/openhut-cloud.ts')
  const { toBase64 } = await import('@openhut/common/vault/public.ts')
  const signing = await crypto.subtle.generateKey('Ed25519', false, ['sign', 'verify']) as webcrypto.CryptoKeyPair
  const box = await crypto.subtle.generateKey('X25519', false, ['deriveBits']) as webcrypto.CryptoKeyPair
  const raw = async (key: webcrypto.CryptoKey) => new Uint8Array(await crypto.subtle.exportKey('raw', key))
  const device = toBase64(new Uint8Array([...await raw(signing.publicKey), ...await raw(box.publicKey)]))
  const kept = new Map<string, unknown>()
  const store = { get: async <T>(key: string) => kept.get(key) as T | undefined, set: async (key: string, value: unknown) => { kept.set(key, value) } }
  const key = { id: async () => device, sign: async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', signing.privateKey, Uint8Array.from(bytes))), noise: async () => ({ publicKey: await raw(box.publicKey), secretKey: new Uint8Array(32) }) }
  return { device, client: openhutCloud.device({ url, key, store }) }
}

test('the desktop window: the shell hands its key over IPC, the runtime lists it as its own window and gives it a join code; only that window changes trust, with presence asked by the runtime; a reinstall takes over with presence and the old key is refused', { skip }, async () => {
  const cloud = await bootCloud()
  const { fakeAgentd } = await import('../agents/signed-in.ts')
  fakeAgentd()
  const { migrate } = await import('../../../src/server/platform/db.ts')
  const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
  const { validateWithZod } = await import('../../../src/server/platform/validation.ts')
  const { settings } = await import('../../../src/server/platform/settings.ts')
  const { cloudController } = await import('../../../src/server/cloud/cloud-controller.ts')
  const { cloudEvents } = await import('../../../src/server/cloud/cloud-events.ts')
  const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
  const { userPresence } = await import('../../../src/server/cloud/user-presence.ts')
  const { memberOf, tagDevice, tunnelKeyOf, who } = await import('../../../src/server/team/identity.ts')
  const { ownWindow } = await import('../../../src/server/team/own-window.ts')
  await migrate()
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validateWithZod)
  app.get('/caller', async (req) => who(req))
  await app.register(cloudController, { prefix: '/api/cloud' })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const headers = { authorization: 'Bearer test-key' }
  const over = (device: string) => ({ method = 'GET', path, body }: { method?: string; path: string; body?: unknown }) => new Promise<{ status: number; text: string }>((done, fail) => {
    const out = request({ method, path, headers: body === undefined ? {} : { 'content-type': 'application/json' }, createConnection: () => {
      const [ours, theirs] = duplexPair()
      app.server.emit('connection', tagDevice({ conn: ours, key: tunnelKeyOf(device) }))
      return theirs
    } }, (res) => {
      let text = ''
      res.setEncoding('utf8').on('data', (chunk: string) => { text += chunk }).on('end', () => done({ status: res.statusCode ?? 0, text }))
    }).on('error', fail)
    out.end(body === undefined ? undefined : JSON.stringify(body))
  })
  const asked: string[] = []
  const presence = (ok: boolean) => { userPresence.ask = async (reason) => { asked.push(reason); return ok } }
  try {
    await assert.rejects(ownWindow.take({ key: (await newWindow(cloud.url)).device }), /Enable OpenHut Cloud/, 'the runtime signs in first; a window can’t take over a runtime that isn’t signed in')

    const started = (await app.inject({ method: 'POST', url: '/api/cloud/sessions', headers })).json<{ authorizationUrl: string }>()
    await app.inject({ method: 'GET', url: await devSignIn({ authorizationUrl: started.authorizationUrl, email: 'mo@example.com' }) })
    for (let i = 0; i < 100 && (await app.inject({ method: 'GET', url: '/api/cloud', headers })).json<{ status: string }>().status !== 'on'; i++) await sleep(50)
    const home = keysService.mustBeOn().workspace.id

    presence(false)
    const first = await newWindow(cloud.url)
    const join = await ownWindow.take({ key: first.device })
    assert.deepEqual(asked, [], 'the first window comes in without presence: it can only arrive over the shell’s own IPC channel')
    assert.equal(join.computer, await keysService.deviceKey(), 'the window learns which computer is its own runtime')
    const me = await first.client.signIn({ joinCode: join.code })
    assert.equal(me.object === 'me' && me.email, 'mo@example.com')
    assert.equal((await first.client.me())?.workspaces.find((each) => each.id === home)?.access, 'listed', 'one Google sign-in (the runtime’s) and the window is in, with no knock')
    assert.equal(memberOf(tunnelKeyOf(first.device))?.own, true)
    await assert.rejects(first.client.signIn({ joinCode: join.code }), /expired or was used/, 'the join code works once')
    const window = over(first.device)

    const { device: browserKey, client: browserClient } = await webBrowser({ url: cloud.url, email: 'mo@example.com' })
    const nonce = randomBytes(32).toString('base64url')
    assert.equal((await browserClient.knock({ team: home, nonce }).ask({ name: 'Chrome', os: 'web' })).asked, true)
    await cloudEvents.refreshRequests(home)
    const approval = { method: 'POST', path: `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(browserKey)}/approvals` }
    assert.equal((await window({ method: 'POST', path: `/api/cloud/workspaces/${home}/requests/${encodeURIComponent(browserKey)}/reviews` })).status, 200, 'the own window reaches the /api/cloud routes over the tunnel')
    assert.equal(await browserClient.knock({ team: home, nonce }).reveal(), true)
    await cloudEvents.refreshRequests(home)
    const faces = facesOf({ device: browserKey, nonce })
    asked.length = 0
    const refused = await window({ ...approval, body: { faces } })
    assert.equal(refused.status, 403, refused.text)
    assert.match(refused.text, /Not confirmed/)
    assert.deepEqual(asked, ['let Chrome into OpenHut'], 'the runtime asked for presence itself; nothing the window says skips it')
    assert.equal(memberOf(tunnelKeyOf(browserKey)), undefined)
    presence(true)
    const letIn = await window({ ...approval, body: { faces } })
    assert.equal(letIn.status, 200, letIn.text)
    assert.equal(memberOf(tunnelKeyOf(browserKey))?.own, true, 'with presence, the own window lets the browser in')

    const browser = over(browserKey)
    assert.equal(settings.ownWindow(), first.device, 'a device let in through a Cloud join request never becomes the own window')
    for (const route of [{ ...approval, body: { faces } }, { method: 'POST', path: '/api/cloud/kits' }, { method: 'DELETE', path: `/api/cloud/devices/${encodeURIComponent(first.device)}` }, { method: 'POST', path: `/api/cloud/workspaces/${home}/keys` }, { method: 'DELETE', path: '/api/cloud' }]) {
      const tried = await browser(route)
      assert.equal(tried.status, 403, `the browser calling ${route.method} ${route.path} over the tunnel: ${tried.text}`)
    }
    assert.equal((await browser({ path: '/api/cloud' })).status, 200, 'the browser still reads')

    asked.length = 0
    presence(false)
    assert.equal((await window({ method: 'POST', path: '/api/cloud/kits' })).status, 403)
    presence(true)
    assert.equal((await window({ method: 'POST', path: '/api/cloud/kits' })).status, 200)
    assert.deepEqual(asked, ['save a new recovery kit', 'save a new recovery kit'], 'the kit asks for presence each time')

    presence(false)
    const reinstalled = await newWindow(cloud.url)
    await assert.rejects(ownWindow.take({ key: reinstalled.device }), /Not confirmed/, 'a second key over IPC without presence is refused')
    assert.equal(settings.ownWindow(), first.device)
    assert.equal((await window({ path: '/caller' })).status, 200, 'the old window keeps working')
    presence(true)
    const again = await ownWindow.take({ key: reinstalled.device })
    await reinstalled.client.signIn({ joinCode: again.code })
    assert.equal((await reinstalled.client.me())?.workspaces.find((each) => each.id === home)?.access, 'listed')
    assert.equal(settings.ownWindow(), reinstalled.device, 'with presence, the reinstalled window takes over as own window')
    const old = await window({ method: 'POST', path: '/api/cloud/kits' })
    assert.equal(old.status, 401, `the old window’s key is refused: ${old.text}`)
    assert.equal((await window({ path: '/caller' })).status, 401)
    const now = over(reinstalled.device)
    assert.equal((await now({ path: '/caller' })).status, 200)
    assert.equal((await now({ ...approval, body: { faces } })).status, 404, 'the new window reaches the trust routes: this request is just gone')

    assert.equal((await now({ method: 'DELETE', path: `/api/cloud/devices/${encodeURIComponent(reinstalled.device)}` })).status, 200, 'you remove the own window from your list')
    presence(false)
    await assert.rejects(ownWindow.take({ key: reinstalled.device }), /Not confirmed/, 'a removed window key isn’t listed again over IPC without presence')
    assert.equal(memberOf(tunnelKeyOf(reinstalled.device)), undefined)
    presence(true)
    await assert.rejects(ownWindow.take({ key: reinstalled.device }), /couldn’t save/, 'even with presence the Cloud never lists a removed key again; a new window key has to take over')
    assert.equal(memberOf(tunnelKeyOf(reinstalled.device)), undefined)
  } finally {
    cloudEvents.stop()
    await app.close()
    await cloud.close()
  }
})
