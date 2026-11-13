import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { siteServer } from '../src/server.ts'

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const INSTALL = '#!/bin/sh\necho installing JakeBox\n'
const TARBALL = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0xde, 0xad, 0xbe, 0xef])
const SECRET = 'a file outside the release folder'

const root = await mkdtemp(join(tmpdir(), 'jakebox-site-'))
await mkdir(join(root, 'release'))
await writeFile(join(root, 'release', 'install.sh'), INSTALL)
await writeFile(join(root, 'release', 'jakebox.tgz'), TARBALL)
await writeFile(join(root, 'secret.txt'), SECRET)
const server = siteServer(join(root, 'release')).listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
assert.ok(typeof address === 'object' && address !== null)
const { port } = address
after(() => server.close())

test('curl and wget get install.sh, a browser gets the home page', async () => {
  for (const accept of ['*/*', undefined]) {
    const install = await get('/', accept)
    assert.equal(install.status, 200)
    assert.equal(install.type, 'text/plain; charset=utf-8')
    assert.equal(install.body.toString(), INSTALL)
  }
  const home = await get('/', BROWSER)
  assert.equal(home.status, 200)
  assert.equal(home.type, 'text/html; charset=utf-8')
  assert.match(home.body.toString(), /curl -fsSL https:\/\/get\.jakebox\.dev \| sh/)
})

test('the tarball is served', async () => {
  const tarball = await get('/jakebox.tgz')
  assert.equal(tarball.status, 200)
  assert.equal(tarball.type, 'application/gzip')
  assert.deepEqual(tarball.body, TARBALL)
})

test('every docs page is served', async () => {
  for (const page of ['install', 'upgrade', 'security', 'uninstall']) {
    const docs = await get(`/docs/${page}`, BROWSER)
    assert.equal(docs.status, 200, page)
    assert.match(docs.body.toString(), /<h1>/)
  }
})

test('a path outside the site is refused', async () => {
  const paths = ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/docs/../../secret.txt', '/docs/..%2f..%2fsecret.txt', '/jakebox.tgz/../../secret.txt', '//secret.txt']
  for (const path of paths) {
    for (const accept of ['*/*', BROWSER]) {
      const res = await get(path, accept)
      assert.equal(res.status, 404, path)
      assert.ok(!res.body.toString().includes(SECRET), path)
    }
  }
})

test('an unknown path is 404', async () => {
  for (const path of ['/nope', '/install.sh', '/docs', '/docs/', '/docs/nope', '/docs/install.html', '/__proto__', '/constructor']) {
    assert.equal((await get(path, BROWSER)).status, 404, path)
  }
  assert.equal((await get('/', '*/*', 'POST')).status, 404)
})

function get(path: string, accept?: string, method = 'GET') {
  const headers = accept === undefined ? {} : { accept }
  return new Promise<{ status: number, type: string | undefined, body: Buffer }>((resolve, reject) => {
    request({ host: '127.0.0.1', port, path, method, headers }, async (res) => {
      const chunks = []
      for await (const chunk of res) chunks.push(chunk)
      resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body: Buffer.concat(chunks) })
    }).on('error', reject).end()
  })
}
