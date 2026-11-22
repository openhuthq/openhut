import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fetchIcon, linksOf } from '../../../src/server/cloud/team-icon.ts'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')
const pages: Record<string, string> = {
  '/': '<html><head><link rel="shortcut icon" href="/favicon.ico"><link rel="icon" type="image/png" sizes="32x32" href="/small.png"><link rel=apple-touch-icon href="/touch.png?v=1&amp;x=2"><link rel="stylesheet" href="/a.css"></head></html>',
  '/plain': '<html><head><title>No icons</title></head></html>',
  '/broken': '<link rel="icon" href="/page.html"><link rel="icon" href="/huge.png">',
}
const server = createServer((req, res) => {
  const url = req.url ?? ''
  if (url === '/moved') return res.writeHead(301, { location: '/' }).end()
  if (url === '/away') return res.writeHead(302, { location: 'http://169.254.169.254/' }).end()
  if (pages[url]) return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pages[url])
  if (url === '/touch.png?v=1&x=2') return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.concat([PNG, Buffer.from('touch')]))
  if (url === '/favicon.ico') return res.writeHead(200, { 'content-type': 'image/vnd.microsoft.icon' }).end('ico')
  if (url === '/huge.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(300 * 1024))
  if (url === '/page.html') return res.writeHead(200, { 'content-type': 'text/html' }).end('<p>not an image</p>')
  res.writeHead(404).end()
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
after(() => server.close())
const address = server.address()
const origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
const local = async (host: string) => host === '127.0.0.1'

test('the icon links rank PNG and SVG first, then the largest; mask icons and stylesheets are not icons', () => {
  const links = linksOf('<link rel="icon" href="/f.ico"><link rel="mask-icon" href="/m.svg"><link rel="icon" sizes="16x16 64x64" type="image/png" href="/a.png"><link rel="icon" href="/logo.svg"><link rel="apple-touch-icon" href="/t.png">')
  assert.deepEqual(links.map((link) => link.href), ['/logo.svg', '/t.png', '/a.png', '/f.ico'])
})

test('the runtime takes the best icon the team’s page links to, following redirects', async () => {
  const icon = await fetchIcon({ page: `${origin}/moved`, allow: local })
  assert.deepEqual(icon && { type: icon.type, bytes: icon.bytes.toString('hex') }, { type: 'image/png', bytes: Buffer.concat([PNG, Buffer.from('touch')]).toString('hex') })
})

test('with no icon links, or only links that aren’t small images, it falls back to /favicon.ico', async () => {
  for (const page of ['/plain', '/broken']) assert.deepEqual(await fetchIcon({ page: `${origin}${page}`, allow: local }), { type: 'image/x-icon', bytes: Buffer.from('ico') })
})

test('it never fetches from a host it doesn’t allow, even through a redirect, and finds nothing on a dead site', async () => {
  assert.equal(await fetchIcon({ page: `${origin}/`, allow: async () => false }), null)
  assert.equal(await fetchIcon({ page: `${origin}/away`, allow: local }).then((icon) => icon?.bytes.toString()), 'ico')
  assert.equal(await fetchIcon({ page: 'http://127.0.0.1:1/', allow: local }), null)
  assert.equal(await fetchIcon({ page: 'file:///etc/hosts' }), null)
})
