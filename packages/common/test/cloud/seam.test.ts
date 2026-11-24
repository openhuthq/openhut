import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const PACKAGES = new URL('../../../', import.meta.url)
const ROOTS = ['runtime/src', 'app/src', 'desktop/src', 'desktop/scripts', 'common/src']
const CLIENT = ['common/src/cloud/', 'common/src/tunnel/']
const RULES: [string, RegExp][] = [
  ['a Cloud URL', /(?<!common\/cloud)\/v1\/(teams|sessions|sign-ins|me|join-codes|watch|tunnels|relay|events|oauth-[a-z-]+|member-lists|letters|invites|join-requests|key-boxes|files|account|auth)\b/],
  ['a request signature', /\b(SIGNATURE_HEADER|signRequest|requestParts)\b/],
  ['a relay socket', /import\s*\{[^}]*\b(connect|serve)\b[^}]*\}\s*from\s*'[^']*tunnel\/index\.ts'/],
]

function sources(root: string): string[] {
  return readdirSync(new URL(root, PACKAGES), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(ts|tsx|mjs|cjs)$/.test(file) && !file.includes('node_modules'))
    .map((file) => `${root}/${file}`)
}

test('nothing outside common/cloud and its tunnel builds a Cloud URL, signs a Cloud request or opens a relay socket: every caller goes through openhutCloud', () => {
  const found = ROOTS.flatMap(sources).filter((file) => !CLIENT.some((each) => file.startsWith(each))).flatMap((file) => {
    const text = readFileSync(new URL(file, PACKAGES), 'utf8')
    return RULES.filter(([, rule]) => rule.test(text)).map(([what]) => `${file}: ${what}`)
  })
  assert.deepEqual(found, [])
})
