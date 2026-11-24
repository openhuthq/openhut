import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: { sequence: { type: 'string' }, channel: { type: 'string' }, 'shell-api': { type: 'string' }, rollout: { type: 'string' }, halt: { type: 'boolean' }, rekor: { type: 'string' } },
})
const [command, path, dir, given] = positionals
const usage = 'usage: release-key.ts key <new key file> | sign <key file> <release folder> [version] [--sequence N] [--channel stable|beta] [--shell-api MIN-MAX] [--rollout 0-100] [--halt] [--rekor https://rekor.sigstore.dev]'

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
    rollout: Number(flags.rollout ?? 100),
    halt: flags.halt ?? false,
    packs,
    files,
  }
  if (!Number.isSafeInteger(release.sequence) || !['stable', 'beta'].includes(release.channel) || !(min <= max) || !(release.rollout >= 0 && release.rollout <= 100)) {
    console.error(usage)
    process.exit(2)
  }
  const manifest = Buffer.from(`${JSON.stringify(release, null, 2)}\n`)
  const signature = sign(null, manifest, key)
  writeFileSync(join(dir, 'release.json'), manifest)
  writeFileSync(join(dir, 'release.json.sig'), `${signature.toString('base64')}\n`)
  const publicKey = createPublicKey(key)
  console.log(`${dir}/release.json: version ${version}, sequence ${release.sequence}, ${release.channel}, ${Object.keys(packs).length} packs, ${names.length} files, signed by ${publicKey.export({ type: 'spki', format: 'der' }).toString('base64')}`)
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
} else {
  console.error(usage)
  process.exit(2)
}
