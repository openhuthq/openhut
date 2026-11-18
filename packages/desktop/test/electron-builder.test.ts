import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const desktop = join(import.meta.dirname, '..')

test('every main-process module the app imports is packed into the app', () => {
  const config = readFileSync(join(desktop, 'electron-builder.yml'), 'utf8')
  const packed = config.match(/^files: \[(.*)\]$/m)?.[1].split(',').map((each) => each.trim()) ?? []
  const modules = readdirSync(join(desktop, 'src')).filter((name) => /\.(mjs|cjs)$/.test(name)).map((name) => `src/${name}`)
  assert.deepEqual(modules.filter((each) => !packed.includes(each)), [])
})
