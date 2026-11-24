import { createHash, createPublicKey, verify } from 'node:crypto'
import { basename } from 'node:path'

export const RELEASE_KEY = 'MCowBQYDK2VwAyEAQbo1L199M6phAczpCAlP6iQc0+AMcbpjrnqH1XvCUyk='
// rekor.sigstore.dev's log key (GET /api/v1/log/publicKey); its sha256 is the logID of every entry it signs.
export const REKOR_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE2G2Y+2tabdTV5BcGiBIx0a9fAFwrkBbmLSGtks4L3qX6yYY0zufBnhC8Ur/iy55GhWP/9A/bY2LhC30M9+RYtw=='
// SEC6: a release is installed only once its Rekor entry is this old, so a stolen key's release is public for an hour first.
export const MIN_AGE_SECONDS = 3600

const spki = (key) => createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' })
const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest()

function signedBy(manifest, signature, key) {
  const publicKey = spki(key)
  return publicKey.asymmetricKeyType === 'ed25519' && verify(null, Buffer.from(manifest), publicKey, Buffer.from(signature.trim(), 'base64'))
}

export function cosigned({ manifest, signature, key, version, files }) {
  try {
    if (!signedBy(manifest, signature, key)) return false
    const signed = JSON.parse(manifest)
    if (typeof version !== 'string' || signed.version !== version) return false
    return files.length > 0 && files.every((file) => typeof file.sha512 === 'string' && signed.files?.[basename(file.url)] === file.sha512)
  } catch {
    return false
  }
}

// RFC 9162 §2.1.3.2: the root a leaf's audit path leads to, or null.
function rootFrom(index, size, leaf, hashes) {
  let fn = BigInt(index)
  let sn = BigInt(size) - 1n
  if (fn > sn) return null
  let r = leaf
  for (const hex of hashes) {
    const p = Buffer.from(hex, 'hex')
    if (sn === 0n) return null
    if (fn & 1n || fn === sn) {
      r = sha256(Buffer.from([1]), p, r)
      while (!(fn & 1n) && fn !== 0n) [fn, sn] = [fn >> 1n, sn >> 1n]
    } else r = sha256(Buffer.from([1]), r, p)
    ;[fn, sn] = [fn >> 1n, sn >> 1n]
  }
  return sn === 0n ? r : null
}

// The entry's integratedTime when Rekor (rekorKey) signed both its timestamp (the SET) and a checkpoint whose tree holds it, else null.
export function rekorIncluded(entry, rekorKey = REKOR_KEY) {
  try {
    const key = spki(rekorKey)
    const { body, integratedTime, logID, logIndex, verification: { signedEntryTimestamp, inclusionProof: proof } } = entry
    const set = JSON.stringify({ body, integratedTime, logID, logIndex })
    if (!verify('sha256', Buffer.from(set), key, Buffer.from(signedEntryTimestamp, 'base64'))) return null
    const [note, signatures] = proof.checkpoint.split('\n\n')
    const [, size, root] = note.split('\n')
    if (size !== String(proof.treeSize) || Buffer.from(root, 'base64').toString('hex') !== proof.rootHash) return null
    if (!signatures.split('\n').some((line) => line.startsWith('— ') && verify('sha256', Buffer.from(`${note}\n`), key, Buffer.from(line.split(' ').pop(), 'base64').subarray(4)))) return null
    const leaf = sha256(Buffer.from([0]), Buffer.from(body, 'base64'))
    return rootFrom(proof.logIndex, proof.treeSize, leaf, proof.hashes)?.toString('hex') === proof.rootHash ? integratedTime : null
  } catch {
    return null
  }
}

// SEC6 in one pure check, shared by the shell, the phone and servers: release.json carries the release key's signature, Rekor logged
// exactly that manifest, signature and key, and the entry is at least an hour old. rekor is release.json.rekor ({ uuid: entry }).
// A missing or unreachable entry is a refusal, so updates fail closed. Returns { ok: true } or { ok: false, reason, retryAt? }.
export function verifyRelease({ manifest, signature, key, rekor, rekorKey = REKOR_KEY, now = Date.now() }) {
  try {
    if (!signedBy(manifest, signature, key)) return { ok: false, reason: 'not signed by the release key' }
    const entry = rekor && Object.values(rekor)[0]
    if (!entry) return { ok: false, reason: 'no Rekor entry' }
    const integratedTime = rekorIncluded(entry, rekorKey)
    if (integratedTime === null) return { ok: false, reason: 'the Rekor entry has no valid timestamp or inclusion proof' }
    const { kind, spec } = JSON.parse(Buffer.from(entry.body, 'base64').toString())
    const logged = kind === 'rekord'
      && spec.data.hash.algorithm === 'sha256' && spec.data.hash.value === sha256(Buffer.from(manifest)).toString('hex')
      && Buffer.from(spec.signature.content, 'base64').equals(Buffer.from(signature.trim(), 'base64'))
      && createPublicKey(Buffer.from(spec.signature.publicKey.content, 'base64')).export({ type: 'spki', format: 'der' }).equals(Buffer.from(key, 'base64'))
    if (!logged) return { ok: false, reason: 'the Rekor entry is for another release' }
    const retryAt = (integratedTime + MIN_AGE_SECONDS) * 1000
    return now >= retryAt ? { ok: true } : { ok: false, reason: 'logged less than an hour ago', retryAt }
  } catch {
    return { ok: false, reason: 'malformed release or Rekor entry' }
  }
}
