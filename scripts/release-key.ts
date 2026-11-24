import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { sequence: { type: 'string' }, channel: { type: 'string' }, 'shell-api': { type: 'string' }, halt: { type: 'boolean' }, rekor: { type: 'string' }, keys: { type: 'string' } },
})
const [command, path, dir, given] = positionals
const usage = 'usage: release-key.ts key <new key file> | sign <key file> <release folder> [version] [--sequence N] [--channel stable|beta] [--shell-api MIN-MAX] [--halt] [--rekor https://rekor.sigstore.dev] [--keys <JSON: current, next, revoked>]\n       | point <key file> <signed release folder> <out folder> [--channel stable|beta] [--sequence N] [--halt] [--rekor https://rekor.sigstore.dev]'

if (command === 'key' && path && !existsSync(path)) {
  const pair = generateKeyPairSync('ed25519')
  writeFileSync(path, pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
  console.log(pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'))
} else if (command === 'sign' && path && dir) {
  const key = createPrivateKey(readFileSync(path))
  const names = readdirSync(dir).filter((name) => !name.startsWith('release.json') && !name.startsWith('.') && statSync(join(dir, name)).isFile()).sort()
  const versions = new Set(names.filter((name) => /^latest.*\.yml$/.test(name)).map((name) => /^version: *['"]?([^'"\s]+)/m.exec(readFileSync(join(dir, name), 'utf8'))?.[1]))
  const version = given ?? (versions.size === 1 ? [...versions][0] : undefined)
  if (!version) {
    console.error(`${dir}: no single version in its latest*.yml (${[...versions].join(', ') || 'none'}), so pass it: release-key.ts sign <key file> <release folder> <version>`)
    process.exit(2)
  }
  const files = Object.fromEntries(names.map((name) => [name, createHash('sha512').update(readFileSync(join(dir, name))).digest('base64')]))
  // v2 keeps v1's version and files, so v1 checks (cosigned) still pass; packs are the openhut-<name>.tgz with an openhut-<name>.json manifest.
  const packs = Object.fromEntries(names.filter((name) => /^openhut-.+\.tgz$/.test(name) && files[name.replace(/\.tgz$/, '.json')])
    .map((name) => [name.slice(8, -4), { file: name, sha512: files[name], manifest: name.replace(/\.tgz$/, '.json'), manifestSha512: files[name.replace(/\.tgz$/, '.json')] }]))
  const [min, max = min] = (flags['shell-api'] ?? '1').split('-').map(Number)
  const release = {
    schema: 2,
    version,
    sequence: Number(flags.sequence ?? Math.floor(Date.now() / 1000)),
    channel: flags.channel ?? (version.includes('-') ? 'beta' : 'stable'),
    shellApi: { min, max },
    halt: flags.halt ?? false,
    packs,
    files,
    // M5 key rotation: a release signed by "next" names the new pinned set, with the old "current" revoked.
    ...(flags.keys ? { keys: JSON.parse(flags.keys) } : {}),
  }
  if (!Number.isSafeInteger(release.sequence) || !['stable', 'beta'].includes(release.channel) || !(min <= max)) {
    console.error(usage)
    process.exit(2)
  }
  await signAndLog(key, dir, release)
} else if (command === 'point' && path && dir && given) {
  // R4: re-sign an already-built, already-signed release as a channel pointer (Promote, halt, or a pointer back to N−1). Builds nothing:
  // the packs and files stay exactly those the release names; only channel, sequence and halt change, under a higher sequence.
  const key = createPrivateKey(readFileSync(path))
  const manifest = readFileSync(join(dir, 'release.json'))
  if (!verify(null, manifest, createPublicKey(key), Buffer.from(readFileSync(join(dir, 'release.json.sig'), 'utf8').trim(), 'base64'))) {
    console.error(`${dir}/release.json isn't signed by this release key, so it can't be pointed to`)
    process.exit(1)
  }
  const from = JSON.parse(manifest.toString())
  if (from.halt && !flags.halt) {
    console.error(`${dir}/release.json is a halt; point to the release itself (its releases/<sha256>.json from before the halt)`)
    process.exit(1)
  }
  const release = { ...from, channel: flags.channel ?? from.channel, sequence: Number(flags.sequence ?? Math.floor(Date.now() / 1000)), halt: flags.halt ?? false }
  if (from.schema !== 2 || !Number.isSafeInteger(release.sequence) || release.sequence <= from.sequence || !['stable', 'beta'].includes(release.channel)) {
    console.error(`${usage}\n(point needs a v2 release.json and a sequence above its ${from.sequence})`)
    process.exit(2)
  }
  mkdirSync(given, { recursive: true })
  await signAndLog(key, given, release)
} else {
  console.error(usage)
  process.exit(2)
}

async function signAndLog(key: KeyObject, dir: string, release: Record<string, any>) {
  const manifest = Buffer.from(`${JSON.stringify(release, null, 2)}\n`)
  const signature = sign(null, manifest, key)
  writeFileSync(join(dir, 'release.json'), manifest)
  writeFileSync(join(dir, 'release.json.sig'), `${signature.toString('base64')}\n`)
  const publicKey = createPublicKey(key)
  console.log(`${dir}/release.json: version ${release.version}, sequence ${release.sequence}, ${release.channel}${release.halt ? ', halt' : ''}, ${Object.keys(release.packs).length} packs, ${Object.keys(release.files).length} files, signed by ${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`)
  if (flags.rekor) {
    // SEC6: log the signed manifest publicly. A rekord entry carries an Ed25519 signature over the whole artifact (hashedrekord can't).
    const res = await fetch(new URL('/api/v1/log/entries', flags.rekor), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apiVersion: '0.0.1', kind: 'rekord', spec: { data: { content: manifest.toString('base64') }, signature: { format: 'x509', content: signature.toString('base64'), publicKey: { content: Buffer.from(publicKey.export({ type: 'spki', format: 'pem' })).toString('base64') } } } }),
    })
    const entry = await res.text()
    if (res.status !== 201) {
      console.error(`${flags.rekor} refused the entry (${res.status}): ${entry}`)
      process.exit(1)
    }
    writeFileSync(join(dir, 'release.json.rekor'), entry)
    console.log(`${dir}/release.json.rekor: Rekor entry ${Object.keys(JSON.parse(entry))[0]}`)
  }
}
