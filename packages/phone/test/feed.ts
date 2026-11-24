// R6 proof harness: a local R4 feed (channels/<channel>/release.json + .sig + .rekor, packs/<sha512 hex>) signed with a throwaway test
// key and logged in a fake Rekor, for a simulator or emulator debug build of the phone shell.
//   node packages/phone/test/feed.ts <dir> [port]                 serves the feed and prints the launch environment
//   curl -X POST 'localhost:<port>/publish?name=A&age=7200&sequence=100[&evil=1]'   publishes a pack logged <age> seconds ago
import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fakeRekor } from '../../desktop/test/fake-rekor.ts'

const [dir, port = '8787'] = process.argv.slice(2)
const releaseKey = join(import.meta.dirname, '../../../scripts/release-key.ts')
mkdirSync(join(dir, 'packs'), { recursive: true })
const keyFile = join(dir, 'test-release.pem')
const key = existsSync(keyFile) ? '' : execFileSync(process.execPath, [releaseKey, 'key', keyFile], { encoding: 'utf8' }).trim()
let loggedAt = 0
const rekor = fakeRekor(() => loggedAt)
await new Promise<void>((done) => rekor.server.listen(0, '127.0.0.1', done))
const rekorUrl = `http://127.0.0.1:${(rekor.server.address() as any).port}`

// The evil pack tries every lever a pack has: Capacitor's persisted base path, Preferences without its prefix, and the old live-update plugin.
const evil = `<script>
const P = window.Capacitor?.Plugins, out = []
const tryIt = async (what, fn) => { try { await fn(); out.push(what + ': done') } catch (e) { out.push(what + ': ' + e.message) } }
addEventListener('load', async () => {
  await tryIt('Preferences group NativeStorage', () => P.Preferences.configure({ group: 'NativeStorage' }))
  for (const k of ['serverBasePath', 'openhut.updater.disabled', 'update.sequence']) await tryIt('set ' + k, () => P.Preferences.set({ key: k, value: '999999' }))
  await tryIt('LiveUpdate.setNextBundle', () => P.LiveUpdate.setNextBundle({ bundleId: 'x' }))
  await tryIt('WebView.persistServerBasePath', () => P.WebView.persistServerBasePath())
  await tryIt('WebView.setServerBasePath', () => P.WebView.setServerBasePath({ path: '/tmp' }))
  document.getElementById('log').textContent = out.join('\\n')
})
</script><pre id="log" style="white-space:pre-wrap;font-size:13px">trying to disable the check…</pre>`

async function publish(name: string, age: number, sequence: number, bad: boolean) {
  const folder = join(dir, `release-${sequence}`)
  mkdirSync(join(folder, 'src/renderer'), { recursive: true })
  writeFileSync(join(folder, 'src/renderer/index.html'), `<!doctype html><meta name="viewport" content="width=device-width"><body style="font:20px -apple-system;padding:60px 20px;background:${bad ? '#fdd' : '#dfd'}"><h1>Pack ${name}</h1><p>sequence ${sequence}${bad ? ' — tries to disable the check' : ''}</p>${bad ? evil : ''}`)
  execFileSync('tar', ['-czf', join(folder, 'openhut-app.tgz'), '-C', join(folder, 'src'), 'renderer'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
  writeFileSync(join(folder, 'openhut-app.json'), JSON.stringify({ pack: 'app', version: `1.0.${sequence}` }))
  loggedAt = Math.floor(Date.now() / 1000) - age
  // async: release-key.ts logs to the fake Rekor in this same process
  await promisify(execFile)(process.execPath, [releaseKey, 'sign', keyFile, folder, `1.0.${sequence}`, '--channel', 'stable', '--sequence', String(sequence), '--rekor', rekorUrl])
  const tgz = readFileSync(join(folder, 'openhut-app.tgz'))
  writeFileSync(join(dir, 'packs', createHash('sha512').update(tgz).digest('hex')), tgz)
  mkdirSync(join(dir, 'channels/stable'), { recursive: true })
  for (const ext of ['', '.sig', '.rekor']) copyFileSync(join(folder, `release.json${ext}`), join(dir, `channels/stable/release.json${ext}`))
  return `published ${name}: sequence ${sequence}, logged ${age}s ago\n`
}

createServer((req, res) => {
  const url = new URL(req.url!, 'http://x')
  if (req.method === 'POST' && url.pathname === '/publish') {
    const q = url.searchParams
    return void publish(q.get('name')!, Number(q.get('age')), Number(q.get('sequence')), q.get('evil') === '1').then((line) => res.end(line), (error) => res.writeHead(500).end(String(error)))
  }
  const file = join(dir, url.pathname)
  if (!file.startsWith(dir) || !existsSync(file)) return res.writeHead(404).end()
  console.log(`GET ${url.pathname}`)
  res.end(readFileSync(file))
}).listen(Number(port), '127.0.0.1')
console.log(`OPENHUT_FEED=http://127.0.0.1:${port} OPENHUT_RELEASE_KEY=${key || '(reuse the key printed on first run)'} OPENHUT_REKOR_KEY=${rekor.rekorKey}`)
