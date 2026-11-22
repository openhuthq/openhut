import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [command, path, dir, given] = process.argv.slice(2)

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
  const manifest = Buffer.from(`${JSON.stringify({ version, files }, null, 2)}\n`)
  writeFileSync(join(dir, 'release.json'), manifest)
  writeFileSync(join(dir, 'release.json.sig'), `${sign(null, manifest, key).toString('base64')}\n`)
  console.log(`${dir}/release.json: version ${version}, ${names.length} files, signed by ${createPublicKey(key).export({ type: 'spki', format: 'der' }).toString('base64')}`)
} else {
  console.error('usage: release-key.ts key <new key file> | sign <key file> <release folder> [version]')
  process.exit(2)
}
