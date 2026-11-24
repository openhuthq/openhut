// R7 / SEC6: a server runs an install.sh only when its sha512 is in a release.json signed by the release key, logged in Rekor,
// and that entry is at least an hour old. The updater (in the base image, never the layer) runs this before every "Update now".
//   node verify-installer.mjs <install.sh> <folder with release.json, release.json.sig, release.json.rekor>
// Exit 0 when it may run; otherwise prints an "openhut: …" line (the admin page shows it) and exits 4.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REKOR_KEY, RELEASE_KEY, verifyRelease } from '../packages/desktop/src/release-key.mjs'

export function verifyInstaller({ installer, manifest, signature, rekor, key = RELEASE_KEY, rekorKey = REKOR_KEY, now = Date.now() }) {
  const check = verifyRelease({ manifest, signature, rekor, key, rekorKey, now })
  if (!check.ok) {
    return check.retryAt
      ? { ok: false, reason: `this release was published less than an hour ago, so it installs from ${new Date(check.retryAt).toISOString()}` }
      : { ok: false, reason: `the release isn't signed and logged as it should be (${check.reason})` }
  }
  const sha512 = createHash('sha512').update(installer).digest('base64')
  if (JSON.parse(manifest).files?.['install.sh'] !== sha512) return { ok: false, reason: "this install.sh isn't the one the signed release names" }
  return { ok: true }
}

if (process.argv[1] === import.meta.filename) {
  const [installer, dir] = process.argv.slice(2)
  let result
  try {
    const read = (name) => readFileSync(join(dir, name), 'utf8')
    result = verifyInstaller({ installer: readFileSync(installer), manifest: read('release.json'), signature: read('release.json.sig'), rekor: JSON.parse(read('release.json.rekor')) })
  } catch (error) {
    result = { ok: false, reason: `couldn't read the signed release (${error.message})` }
  }
  if (!result.ok) {
    console.log(`openhut: not updating: ${result.reason}`)
    process.exit(4)
  }
  console.log('openhut: install.sh is in a signed release logged over an hour ago')
}
