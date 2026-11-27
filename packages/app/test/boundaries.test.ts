import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const SRC = new URL('../src/', import.meta.url)
const ALLOWED = new Set<string>([
  'features/agents/agent-view.tsx -> features/connections/add-app',
  'features/agents/agent-view.tsx -> features/connections/tool-permissions',
  'features/agents/agent-view.tsx -> features/routines/routines-dialog',
  'features/agents/agent-view.tsx -> features/threads/chat',
  'features/agents/agent-view.tsx -> features/threads/thread-list',
  'features/agents/agent-view.tsx -> features/threads/threads-dialog',
  'features/agents/agent-view.tsx -> features/webhooks/webhooks-dialog',
  'features/agents/new-agent.tsx -> features/models/api',
  'features/agents/new-agent.tsx -> features/models/models-settings',
  'features/agents/panel.tsx -> features/threads/thread-list',
  'features/agents/sidebar.tsx -> features/auth/api',
  'features/agents/sidebar.tsx -> features/settings/update-pill',
  'features/agents/sidebar.tsx -> features/threads/thread-list',
  'features/settings/admin.tsx -> features/connections/github-app',
  'features/settings/settings-view.tsx -> features/connections/connections-view',
  'features/settings/settings-view.tsx -> features/models/models-settings',
  'features/settings/settings-view.tsx -> features/people/people',
  'features/threads/chat.tsx -> app/phone-page',
  'features/threads/chat.tsx -> features/agents/sidebar',
  'features/threads/chat.tsx -> features/asks/card',
  'features/webhooks/webhooks-dialog.tsx -> features/agents/notify',
])

function zoneOf(file: string) {
  const [top, feature] = file.split('/')
  if (top === 'features') return `features/${feature}`
  if (top === 'app' || top === 'main.tsx') return 'app'
  return 'shared'
}

function importsOf(file: string) {
  const source = readFileSync(new URL(file, SRC), 'utf8')
  return [...source.matchAll(/(?:from\s+|import\(\s*)'([^']+)'/g)].map((match) => match[1]).flatMap((spec) => {
    if (spec.startsWith('@/')) return [spec.slice(2)]
    if (spec.startsWith('.')) return [normalize(join(dirname(file), spec))]
    return []
  })
}

function crossings() {
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter((file) => /\.tsx?$/.test(file))
  return files.flatMap((file) => {
    const zone = zoneOf(file)
    return importsOf(file).filter((target) => {
      const to = zoneOf(target)
      if (zone === 'shared') return to !== 'shared'
      if (zone.startsWith('features/')) return to === 'app' || (to.startsWith('features/') && to !== zone)
      return false
    }).map((target) => `${file} -> ${target.replace(/\.tsx?$/, '')}`)
  }).sort()
}

test('shared code imports no feature or app, and a feature imports no app or other feature', () => {
  assert.deepEqual(crossings().filter((crossing) => !ALLOWED.has(crossing)), [])
})

test('the allowlist holds only crossings that still exist', () => {
  const found = new Set(crossings())
  assert.deepEqual([...ALLOWED].filter((crossing) => !found.has(crossing)), [])
})
