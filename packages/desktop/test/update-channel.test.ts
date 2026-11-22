import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppUpdater } from 'electron-updater/out/AppUpdater.js'
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider.js'
import { useChannel } from '../src/update-channel.mjs'

const root = join(import.meta.dirname, '../../..')

function updaterAt({ version, beta }: { version: string; beta: boolean }) {
  const app = { version, name: 'OpenHut', isPackaged: true, appUpdateConfigPath: '', userDataPath: tmpdir(), baseCachePath: tmpdir(), whenReady: async () => undefined, relaunch: () => undefined, quit: () => undefined, onQuit: () => undefined }
  const updater = new AppUpdater(null, app)
  useChannel({ updater, beta })
  return updater
}

async function offered({ from, beta, feed }: { from: string; beta: boolean; feed: string }) {
  return updaterAt({ version: from, beta }).isUpdateAvailable({ version: feed, files: [], path: '', sha512: '', releaseDate: '' })
}

test('the app reads the beta feed only while the Beta channel is picked', () => {
  const runtime = { platform: 'darwin' as const, executor: null as never, isUseMultipleRangeRequest: false }
  for (const version of ['0.4.1', '0.5.0-beta.1']) {
    assert.equal(new GenericProvider({ provider: 'generic', url: 'https://dl.openhut.dev/' }, updaterAt({ version, beta: true }), runtime).channel, 'beta-mac')
    assert.equal(new GenericProvider({ provider: 'generic', url: 'https://dl.openhut.dev/' }, updaterAt({ version, beta: false }), runtime).channel, 'latest-mac')
  }
})

test('a beta is offered over the stable it leads to, and the stable over its betas, but nothing older ever is', async () => {
  assert.equal(await offered({ from: '0.4.1', beta: true, feed: '0.5.0-beta.1' }), true)
  assert.equal(await offered({ from: '0.5.0-beta.1', beta: true, feed: '0.5.0-beta.2' }), true)
  assert.equal(await offered({ from: '0.5.0-beta.2', beta: true, feed: '0.5.0' }), true)
  assert.equal(await offered({ from: '0.5.0-beta.10', beta: true, feed: '0.5.0-beta.9' }), false, 'beta.10 is newer than beta.9')
  assert.equal(await offered({ from: '0.5.0-beta.2', beta: false, feed: '0.4.3' }), false, 'turning beta off never goes back to stable')
  assert.equal(await offered({ from: '0.5.0-beta.2', beta: false, feed: '0.5.0' }), true, 'the next newer stable is offered')
  assert.equal(await offered({ from: '0.5.0', beta: true, feed: '0.5.0-beta.2' }), false)
})

function publish({ version, beta }: { version: string; beta?: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'oh-r2-'))
  const bin = join(dir, 'bin')
  const files = join(dir, 'files')
  const put = join(dir, 'put')
  for (const each of [bin, files, put]) mkdirSync(each)
  writeFileSync(join(bin, 'npx'), '#!/bin/sh\nwhile [ "$1" != put ]; do shift; done\nkey=${2#*/}\ncp "$4" "$PUT/$(printf %s "$key" | tr / _)"\n')
  writeFileSync(join(bin, 'curl'), '#!/bin/sh\n[ -n "$BETA_FEED" ] || exit 22\nprintf "version: %s\\n" "$BETA_FEED"\n')
  for (const name of ['npx', 'curl']) chmodSync(join(bin, name), 0o755)
  for (const name of ['OpenHut-arm64.dmg', `OpenHut-${version}-arm64.zip`, `OpenHut-${version}-arm64.zip.blockmap`, 'OpenHut-x64.AppImage', 'openhut-x64.deb', 'OpenHut-Setup-x64.exe', 'OpenHut-Setup-x64.exe.blockmap']) writeFileSync(join(files, name), name)
  for (const name of ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']) writeFileSync(join(files, name), `version: ${version}\nfiles:\n  - url: OpenHut-${version}-arm64.zip\npath: OpenHut-${version}-arm64.zip\n`)
  execFileSync(join(root, 'scripts/r2.sh'), ['release', version, files], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PUT: put, BETA_FEED: beta ?? '' }, encoding: 'utf8' })
  const text = (name: string) => readFileSync(join(put, name), 'utf8')
  const feed = (name: string) => text(name).match(/^version: (.*)$/m)?.[1]
  return { put: readdirSync(put).filter((name) => !name.startsWith('v')).sort(), feed, text }
}

test('a beta tag moves only the beta feed; a stable moves latest, and the beta feed unless a newer beta leads it', () => {
  const beta = publish({ version: '0.5.0-beta.1' })
  assert.deepEqual(beta.put, ['beta-linux.yml', 'beta-mac.yml', 'beta.yml'])
  assert.match(beta.text('beta-mac.yml'), /^path: v0\.5\.0-beta\.1\/OpenHut-0\.5\.0-beta\.1-arm64\.zip$/m)

  const stable = publish({ version: '0.5.0', beta: '0.5.0-beta.3' })
  assert.deepEqual(stable.put, ['beta-linux.yml', 'beta-mac.yml', 'beta.yml', 'latest-linux.yml', 'latest-mac.yml', 'latest.yml', 'latest_OpenHut-Setup-x64.exe', 'latest_OpenHut-arm64.dmg', 'latest_OpenHut-x64.AppImage', 'latest_openhut-x64.deb'])
  assert.equal(stable.feed('beta-mac.yml'), '0.5.0')

  const hotfix = publish({ version: '0.4.3', beta: '0.5.0-beta.3' })
  assert.deepEqual(hotfix.put.filter((name) => name.startsWith('beta')), [], 'the 0.5.0 betas stay ahead of a 0.4.3 hotfix')
  assert.equal(hotfix.feed('latest-mac.yml'), '0.4.3')

  const pulled = publish({ version: '0.4.3', beta: '0.4.4' })
  assert.equal(pulled.feed('beta-mac.yml'), '0.4.3', 'a stable the beta feed only copied never holds it')
})
