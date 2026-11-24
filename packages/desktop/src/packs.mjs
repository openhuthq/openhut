// M5: the shell's pack updater, with no electron-updater. It polls the channel pointer (R4), checks it with verifyRelease and
// pointerAction (SEC6), fetches the release's packs by hash from packs/<sha512 hex>, checks every file against the pack's manifest,
// and installs them as pending. The next boot runs the pending set; the shell commits it once the server is up, or rolls back to
// the previous set by itself (also when a pending set is found already tried, i.e. the last boot died).
// State lives in <home>/packs/state.json; packs are extracted once each into <home>/packs/store/<sha512 hex>/.
import { execFile } from 'node:child_process'
import { createHash, verify, createPublicKey } from 'node:crypto'
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { pointerAction, RELEASE_KEY, REKOR_KEY } from './release-key.mjs'

// Bump when preload.cjs, the env main.mjs passes the server, PGlite (node_modules stays in the shell) or Electron's major change.
export const SHELL_API = 1
// The owner's offline "next" key (M5 key lifecycle). Empty until the owner generates it and pastes its public half here.
export const NEXT_RELEASE_KEY = 'MCowBQYDK2VwAyEACy4oolVkyw43n8Hz4Ui1fR0MkFKY1L5ULz+0OK1rhXo='
export const PINNED_KEYS = { current: RELEASE_KEY, next: NEXT_RELEASE_KEY, revoked: [] }

const hex = (b64) => Buffer.from(b64, 'base64').toString('hex')
const sha512 = (body) => createHash('sha512').update(body).digest('base64')
const statePath = (home) => join(home, 'packs', 'state.json')
export const readState = (home) => existsSync(statePath(home)) ? JSON.parse(readFileSync(statePath(home), 'utf8')) : { seen: 0, keys: PINNED_KEYS, current: null, previous: null, pending: null }
const writeState = (home, state) => {
  mkdirSync(join(home, 'packs'), { recursive: true })
  writeFileSync(`${statePath(home)}.tmp`, JSON.stringify(state, null, 2))
  renameSync(`${statePath(home)}.tmp`, statePath(home))
}

// The trusted key ("current" or "next", never a revoked one) that signed this manifest, or null.
export function signerOf({ manifest, signature }, keys) {
  for (const key of [keys.current, keys.next]) {
    if (!key || keys.revoked.includes(key)) continue
    try {
      if (verify(null, Buffer.from(manifest), createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' }), Buffer.from(signature.trim(), 'base64'))) return key
    } catch {}
  }
  return null
}

// Rotation: a verified release signed by the key it names as its new "current" (the old "next") replaces the pinned set; revocations only add.
export function rotate(keys, release, signer) {
  const next = release.keys
  if (!next?.current || next.current !== signer) return keys
  return { current: next.current, next: next.next ?? '', revoked: [...new Set([...keys.revoked, ...(next.revoked ?? [])])] }
}

const fingerprint = (key) => createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 16)

// One poll. Returns { action, ... } as pointerAction does, after acting on it: install puts the packs in the store and sets them pending,
// halt drops a pending set that hasn't booted yet.
export async function poll({ home, feed, channel, platform = `${process.platform}-${process.arch}`, shellApi = SHELL_API, keys: pinned, rekorKey = REKOR_KEY, now = Date.now(), fetch = globalThis.fetch }) {
  const state = readState(home)
  const keys = pinned ?? state.keys
  const get = async (path) => {
    const res = await fetch(new URL(path, feed))
    if (!res.ok) throw new Error(`${path}: ${res.status}`)
    return Buffer.from(await res.arrayBuffer())
  }
  const base = `channels/${channel}/release.json`
  const [manifest, signature, rekor] = await Promise.all([base, `${base}.sig`, `${base}.rekor`].map((path) => get(path).then(String, () => '')))
  const pointer = { manifest, signature, rekor: rekor ? JSON.parse(rekor) : undefined }
  const key = signerOf(pointer, keys)
  if (!key) return { action: 'refuse', reason: 'not signed by a trusted release key' }
  const decision = pointerAction({ pointer, channel, installed: state.seen, shellApi, key, rekorKey, now })
  const entry = pointer.rekor && Object.values(pointer.rekor)[0]
  const signed = entry && { key: fingerprint(key), logIndex: entry.logIndex, loggedAt: entry.integratedTime * 1000 }
  if (decision.action === 'halt') {
    writeState(home, { ...state, seen: decision.sequence, pending: null })
    return { ...decision, dropped: state.pending?.sequence ?? null, signed }
  }
  if (!['wait', 'install'].includes(decision.action)) return decision
  // Signed and logged: download and check the packs now, also while waiting out the hour (SEC6 step 3). Only install sets them pending.
  const roles = { app: 'app', [`runtime-${platform}`]: 'runtime', [`native-${platform}`]: 'native' }
  const packs = {}
  for (const [name, pack] of Object.entries(JSON.parse(manifest).packs ?? {})) {
    if (!roles[name]) continue
    packs[roles[name]] = hex(pack.sha512)
    await installPack({ home, pack, get })
  }
  if (decision.action === 'wait') return { ...decision, version: JSON.parse(manifest).version, signed, downloaded: Object.keys(packs) }
  if (!packs.app) return { action: 'refuse', reason: 'the release has no app pack' }
  const release = JSON.parse(manifest)
  writeState(home, { ...state, seen: decision.sequence, keys: rotate(keys, release, key), pending: { sequence: decision.sequence, version: decision.version, packs, tried: false } })
  return { ...decision, signed }
}

async function installPack({ home, pack, get }) {
  const store = join(home, 'packs', 'store')
  const id = hex(pack.sha512)
  if (existsSync(join(store, id))) return
  const [tgz, manifest] = await Promise.all([get(`packs/${id}`), get(`packs/${hex(pack.manifestSha512)}`)])
  if (sha512(tgz) !== pack.sha512 || sha512(manifest) !== pack.manifestSha512) throw new Error(`pack ${pack.file} doesn't match the release`)
  const tmp = join(store, `${id}.tmp`)
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  writeFileSync(join(store, `${id}.tgz`), tgz)
  try {
    // A relative path, so GNU tar on Windows doesn't read "C:" as a remote host.
    await promisify(execFile)('tar', ['-xzf', `../${id}.tgz`], { cwd: tmp })
    const want = JSON.parse(manifest).files
    const have = files(tmp)
    const bad = [...new Set([...Object.keys(want), ...Object.keys(have)])].filter((path) => want[path] !== have[path])
    if (bad.length) throw new Error(`pack ${pack.file}: ${bad.length} files don't match its manifest, like ${bad[0]}`)
    renameSync(tmp, join(store, id))
  } finally {
    rmSync(tmp, { recursive: true, force: true })
    rmSync(join(store, `${id}.tgz`), { force: true })
  }
}

function files(dir, prefix = '') {
  const out = {}
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const path = `${prefix}${name}`
    const stat = lstatSync(abs)
    if (stat.isSymbolicLink()) out[path] = `link:${readlinkSync(abs)}`
    else if (stat.isDirectory()) Object.assign(out, files(abs, `${path}/`))
    else out[path] = sha512(readFileSync(abs))
  }
  return out
}

// At startup: the pack set to run, or null for the packs inside the installer. A pending set runs once; found already tried, the last boot
// died with it, so it rolls back here. Before a pending set's first boot, data/app is copied so a rollback restores it.
export function activePack({ home, data, backend }) {
  let state = readState(home)
  if (state.pending?.tried) state = rollback({ home, data })
  if (state.pending) {
    if (existsSync(join(data, 'app'))) {
      rmSync(join(data, 'app.before-pack'), { recursive: true, force: true })
      cpSync(join(data, 'app'), join(data, 'app.before-pack'), { recursive: true })
    }
    state.pending.tried = true
    writeState(home, state)
  }
  const set = state.pending ?? state.current
  if (!set) return null
  const store = join(home, 'packs', 'store')
  const app = join(store, set.packs.app)
  if (backend && !existsSync(join(app, 'node_modules')) && existsSync(join(backend, 'node_modules'))) symlinkSync(join(backend, 'node_modules'), join(app, 'node_modules'), 'junction')
  return {
    pending: !!state.pending, sequence: set.sequence, version: set.version, app,
    runtime: set.packs.runtime && join(store, set.packs.runtime, 'runtime'),
    native: set.packs.native && join(store, set.packs.native, 'bin/native'),
  }
}

// The server came up on the pending set: it becomes current, and the one before it stays as previous.
export function commit({ home, data }) {
  const state = readState(home)
  if (!state.pending) return state
  rmSync(join(data, 'app.before-pack'), { recursive: true, force: true })
  const { tried, ...set } = state.pending
  const next = { ...state, previous: state.current, current: set, pending: null }
  writeState(home, next)
  return next
}

// The pending set didn't start: drop it and restore data/app. `seen` keeps its sequence, so the same pointer isn't installed again.
export function rollback({ home, data }) {
  const state = readState(home)
  if (existsSync(join(data, 'app.before-pack'))) {
    rmSync(join(data, 'app'), { recursive: true, force: true })
    renameSync(join(data, 'app.before-pack'), join(data, 'app'))
  }
  const next = { ...state, pending: null, rolledBack: state.pending?.sequence ?? null }
  writeState(home, next)
  return next
}
