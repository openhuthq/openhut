import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const SCREENS = ['features', 'app'].map((dir) => new URL(`../src/${dir}/`, import.meta.url))
const RAW_CONTROL = /<(button|input|select|textarea|dialog)\b/
const DYNAMIC_STYLES = new Set(['background', 'borderColor', 'color', 'flexGrow', 'rotate', 'translate', 'left', 'top', "'--i'", "'--sx'", "'--sy'", "'--pw'", "'--ar'"])

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

test('no confirm floats in a popover: a popover never holds a Cancel button', () => {
  const dirs = ['features', 'app', 'components'].map((dir) => new URL(`../src/${dir}/`, import.meta.url))
  const files = dirs.flatMap((dir) => readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.tsx')).map((file) => ({ file, source: readFileSync(new URL(file, dir), 'utf8') })))
  assert.deepEqual(files.filter(({ source }) => source.includes('PopoverContent') && />Cancel</.test(source)).map(({ file }) => file), [])
})

test('a dialog family is one Dialog: moving between its views never closes and reopens it', () => {
  const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8')
  assert.equal(read('app/app.tsx').match(/<SettingsView\b/g)?.length, 1, 'Settings and /connections share one SettingsView')
})

test('a Back button inside a dialog carries data-back, so Esc steps back one view instead of closing the dialog', () => {
  const unmarked = screens().flatMap(({ file, source }) => [...source.matchAll(/<Button\b(?:(?!<Button\b)[^\n])*?>Back<\/Button>/g)].filter((match) => !match[0].includes('data-back')).map(() => file))
  assert.deepEqual(unmarked, [])
})
