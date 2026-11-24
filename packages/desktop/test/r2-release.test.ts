import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '../../..')

test('a shell release moves the latest feeds and installers, and never writes a beta feed', () => {
  const version = '0.5.0'
  const dir = mkdtempSync(join(tmpdir(), 'oh-r2-'))
  const [bin, files, put] = ['bin', 'files', 'put'].map((name) => join(dir, name))
  for (const each of [bin, files, put]) mkdirSync(each)
  writeFileSync(join(bin, 'npx'), '#!/bin/sh\nwhile [ "$1" != put ]; do shift; done\nkey=${2#*/}\ncp "$4" "$PUT/$(printf %s "$key" | tr / _)"\n')
  chmodSync(join(bin, 'npx'), 0o755)
  for (const name of ['OpenHut-arm64.dmg', `OpenHut-${version}-arm64.zip`, `OpenHut-${version}-arm64.zip.blockmap`, 'OpenHut-x64.AppImage', 'openhut-x64.deb', 'OpenHut-Setup-x64.exe', 'OpenHut-Setup-x64.exe.blockmap']) writeFileSync(join(files, name), name)
  for (const name of ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']) writeFileSync(join(files, name), `version: ${version}\nfiles:\n  - url: OpenHut-${version}-arm64.zip\npath: OpenHut-${version}-arm64.zip\n`)
  execFileSync(join(root, 'scripts/r2.sh'), ['release', version, files], { env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PUT: put }, encoding: 'utf8' })
  assert.deepEqual(readdirSync(put).filter((name) => !name.startsWith('v')).sort(), ['latest-linux.yml', 'latest-mac.yml', 'latest.yml', 'latest_OpenHut-Setup-x64.exe', 'latest_OpenHut-arm64.dmg', 'latest_OpenHut-x64.AppImage', 'latest_openhut-x64.deb'])
  assert.match(readFileSync(join(put, 'latest-mac.yml'), 'utf8'), /^path: v0\.5\.0\/OpenHut-0\.5\.0-arm64\.zip$/m)
})
