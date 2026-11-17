import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const SCREENS = ['features', 'app'].map((dir) => new URL(`../src/${dir}/`, import.meta.url))
const RAW_CONTROL = /<(button|input|select|textarea|dialog)\b/
const DYNAMIC_STYLES = new Set(['background', 'flexGrow', 'rotate', 'translate', 'left', 'top', "'--i'", "'--sx'", "'--sy'", "'--pw'", "'--ar'"])

function screens() {
  return SCREENS.flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => ({ file, source: readFileSync(new URL(file, dir), 'utf8') })))
}

test('screens use the ui/ components, not raw form controls or dialogs', () => {
  const raw = screens().filter(({ source }) => RAW_CONTROL.test(source)).map(({ file }) => file)
  assert.deepEqual(raw, [])
})

test('screens set inline styles only for values computed at runtime', () => {
  const styles = screens().flatMap(({ file, source }) => [...source.matchAll(/style=\{\{([^}]*)\}/g)]
    .flatMap((match) => [...match[1].matchAll(/([\w'-]+):/g)].map((key) => `${file} ${key[1]}`)))
  assert.deepEqual(styles.filter((style) => !DYNAMIC_STYLES.has(style.split(' ')[1])), [])
})
