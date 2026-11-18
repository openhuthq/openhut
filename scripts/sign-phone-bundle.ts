import { execFileSync } from 'node:child_process'
import { createHash, createPrivateKey, sign } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: { dir: { type: 'string' }, out: { type: 'string' }, sequence: { type: 'string' }, 'app-version': { type: 'string' }, 'updates-url': { type: 'string' } },
})
const dir = need('dir')
const out = resolve(need('out'))
const sequence = Number(need('sequence'))
const appVersion = need('app-version')
const updatesUrl = need('updates-url').replace(/\/$/, '')
if (!Number.isSafeInteger(sequence) || sequence < 0) fail('--sequence takes a whole number, higher than every bundle signed before.')

const pem = process.env.PHONE_BUNDLE_KEY || (process.env.PHONE_BUNDLE_KEY_FILE ? readFileSync(process.env.PHONE_BUNDLE_KEY_FILE, 'utf8') : '')
if (!pem) fail('Set PHONE_BUNDLE_KEY to the RSA private key in PEM, or PHONE_BUNDLE_KEY_FILE to its path.')
const key = createPrivateKey(pem)
if (key.asymmetricKeyType !== 'rsa') fail('The bundle key is an RSA private key; this one is not.')

mkdirSync(out, { recursive: true })
const zip = join(out, 'bundle.zip')
rmSync(zip, { force: true })
execFileSync('zip', ['-qrX', zip, '.'], { cwd: dir })
const bytes = readFileSync(zip)
const sha256 = createHash('sha256').update(bytes).digest('hex')
const bundleId = `${sequence}-${sha256.slice(0, 16)}`
const unsigned = {
  appVersion,
  bundleId,
  bundleSignature: sign('sha256', bytes, key).toString('base64'),
  sequence,
  sha256,
  url: `${updatesUrl}/bundles/${bundleId}.zip`,
}
const canonical = JSON.stringify(Object.fromEntries(Object.entries(unsigned).sort(([a], [b]) => (a < b ? -1 : 1))))
const manifest = { ...unsigned, signature: sign('sha256', Buffer.from(canonical), key).toString('base64') }
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`Signed ${bundleId} for app ${appVersion}: ${join(out, 'bundle.zip')} and ${join(out, 'manifest.json')}`)

function need(name: 'dir' | 'out' | 'sequence' | 'app-version' | 'updates-url'): string {
  return values[name] || fail(`Pass --${name}. Usage: node scripts/sign-phone-bundle.ts --dir <renderer> --out <folder> --sequence <n> --app-version <native version> --updates-url <https://…/v1/updates>`)
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
