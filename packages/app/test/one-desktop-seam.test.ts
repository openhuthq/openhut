import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const SRC = new URL('../src/', import.meta.url)

test('the dashboard reaches the desktop app only through lib/desktop.ts, so the web app and the desktop app differ in one file', () => {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file) && file !== 'lib/desktop.ts')
  const found = files.filter((file) => /['"]openhut['"]\s+in\s+window|Reflect\.get\((window|globalThis),\s*['"]openhut['"]\)|window\.openhut/.test(readFileSync(new URL(file, SRC), 'utf8')))
  assert.deepEqual(found, [])
})
