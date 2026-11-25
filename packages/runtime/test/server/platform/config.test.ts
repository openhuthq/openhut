import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const ROOT = new URL('../../../../../', import.meta.url)
const CONFIGS = ['packages/runtime/src/server/platform/config.ts', 'packages/runtime/src/agentd/config.ts']

test('only the config files read environment variables; everything else forwards the whole environment at most', () => {
  const files = ['packages/runtime/src'].flatMap((dir) => readdirSync(new URL(dir, ROOT), { recursive: true, encoding: 'utf8' }).map((file) => `${dir}/${file}`))
  const found = files.filter((file) => /\.(ts|mjs|cjs)$/.test(file) && !CONFIGS.includes(file) && /process\.env\s*[.[]/.test(readFileSync(new URL(file, ROOT), 'utf8')))
  assert.deepEqual(found, [])
})
