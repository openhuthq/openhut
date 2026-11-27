import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const SRC = new URL('../src/', import.meta.url)
const ALLOWED = new Set<string>([
  'features/agents/access.tsx -> features/models/model-picker',
  'features/agents/access.tsx -> features/people/api',
  'features/agents/activity-dialog.tsx -> features/connections/api',
  'features/agents/activity-dialog.tsx -> features/connections/catalog',
  'features/agents/agent-view.tsx -> features/connections/add-app',
  'features/agents/agent-view.tsx -> features/routines/routines-dialog',
  'features/agents/agent-view.tsx -> features/threads/chat',
  'features/agents/agent-view.tsx -> features/threads/thread-list',
  'features/agents/agent-view.tsx -> features/threads/threads-dialog',
  'features/agents/agent-view.tsx -> features/webhooks/webhooks-dialog',
  'features/agents/asks.tsx -> features/asks/custom',
  'features/agents/asks.tsx -> features/asks/extras',
  'features/agents/model-rows.tsx -> features/models/api',
  'features/agents/model-rows.tsx -> features/models/labels',
  'features/agents/model-rows.tsx -> features/models/model-picker',
  'features/agents/move.tsx -> features/computers/api',
  'features/agents/move.tsx -> features/settings/computers',
  'features/agents/new-agent.tsx -> features/computers/api',
  'features/agents/new-agent.tsx -> features/models/api',
  'features/agents/new-agent.tsx -> features/models/model-picker',
  'features/agents/new-agent.tsx -> features/people/api',
  'features/agents/new-agent.tsx -> features/settings/api',
  'features/agents/new-agent.tsx -> features/settings/models',
  'features/agents/notify.tsx -> features/models/model-picker',
  'features/agents/notify.tsx -> features/routines/target-picker',
  'features/agents/notify.tsx -> features/threads/places',
  'features/agents/panel.tsx -> features/threads/thread-list',
  'features/agents/setup-dialog.tsx -> features/computers/api',
  'features/agents/setup-dialog.tsx -> features/connections/api',
  'features/agents/setup-dialog.tsx -> features/connections/catalog',
  'features/agents/setup-dialog.tsx -> features/routines/api',
  'features/agents/setup-dialog.tsx -> features/routines/when',
  'features/agents/setup-dialog.tsx -> features/threads/places',
  'features/agents/setup-dialog.tsx -> features/webhooks/api',
  'features/agents/sidebar.tsx -> features/auth/api',
  'features/agents/sidebar.tsx -> features/connections/api',
  'features/agents/sidebar.tsx -> features/connections/catalog',
  'features/agents/sidebar.tsx -> features/people/api',
  'features/agents/sidebar.tsx -> features/settings/update-pill',
  'features/agents/sidebar.tsx -> features/threads/places',
  'features/agents/sidebar.tsx -> features/threads/thread-list',
  'features/agents/tool-permissions.tsx -> features/connections/api',
  'features/agents/tool-permissions.tsx -> features/connections/catalog',
  'features/agents/tool-permissions.tsx -> features/connections/permissions',
  'features/asks/card.tsx -> features/agents/face',
  'features/asks/card.tsx -> features/agents/request-card',
  'features/asks/card.tsx -> features/connections/asks',
  'features/asks/card.tsx -> features/connections/catalog',
  'features/connections/add-app.tsx -> features/people/api',
  'features/connections/asks.tsx -> features/agents/api',
  'features/connections/asks.tsx -> features/agents/request-card',
  'features/connections/asks.tsx -> features/asks/api',
  'features/connections/asks.tsx -> features/asks/custom',
  'features/connections/asks.tsx -> features/asks/extras',
  'features/connections/connect-sheets.tsx -> features/people/api',
  'features/connections/connect-sheets.tsx -> features/settings/admin',
  'features/connections/connect-sheets.tsx -> features/settings/github-app',
  'features/connections/connect-sheets.tsx -> features/settings/github-setup',
  'features/connections/connections-view.tsx -> features/people/api',
  'features/connections/connections-view.tsx -> features/settings/kit',
  'features/connections/github-access.tsx -> features/asks/api',
  'features/connections/github-access.tsx -> features/people/api',
  'features/connections/github-access.tsx -> features/settings/github-app',
  'features/connections/github-access.tsx -> features/settings/kit',
  'features/connections/manage-sheets.tsx -> features/agents/api',
  'features/connections/manage-sheets.tsx -> features/agents/face',
  'features/connections/manage-sheets.tsx -> features/settings/kit',
  'features/people/people.tsx -> features/settings/kit',
  'features/routines/routines-dialog.tsx -> features/agents/face',
  'features/routines/target-picker.tsx -> features/models/model-picker',
  'features/settings/admin.tsx -> features/connections/google-client',
  'features/settings/admin.tsx -> features/connections/sheet',
  'features/settings/computers.tsx -> features/computers/api',
  'features/settings/computers.tsx -> features/people/api',
  'features/settings/github-app.tsx -> features/connections/sheet',
  'features/settings/kit.tsx -> features/agents/face',
  'features/settings/models.tsx -> features/agents/api',
  'features/settings/models.tsx -> features/agents/face',
  'features/settings/models.tsx -> features/agents/form',
  'features/settings/models.tsx -> features/models/api',
  'features/settings/models.tsx -> features/models/labels',
  'features/settings/settings-view.tsx -> features/connections/connections-view',
  'features/settings/settings-view.tsx -> features/people/api',
  'features/settings/settings-view.tsx -> features/people/people',
  'features/settings/update-pill.tsx -> features/computers/api',
  'features/settings/updates.tsx -> features/computers/api',
  'features/threads/card.tsx -> features/connections/catalog',
  'features/threads/chat.tsx -> app/phone-page',
  'features/threads/chat.tsx -> features/agents/api',
  'features/threads/chat.tsx -> features/agents/face',
  'features/threads/chat.tsx -> features/agents/sidebar',
  'features/threads/chat.tsx -> features/agents/status',
  'features/threads/chat.tsx -> features/asks/card',
  'features/threads/chat.tsx -> features/people/api',
  'features/threads/chat.tsx -> features/routines/target-picker',
  'features/threads/chat.tsx -> features/webhooks/call',
  'features/threads/chat.tsx -> features/webhooks/call-card',
  'features/threads/chat.tsx -> features/webhooks/message',
  'features/threads/chat.tsx -> features/webhooks/setup-card',
  'features/threads/live.tsx -> features/agents/face',
  'features/threads/live.tsx -> features/people/api',
  'features/threads/work.tsx -> features/connections/api',
  'features/threads/work.tsx -> features/connections/catalog',
  'features/webhooks/asks.tsx -> features/agents/request-card',
  'features/webhooks/asks.tsx -> features/asks/custom',
  'features/webhooks/asks.tsx -> features/asks/extras',
  'features/webhooks/setup-card.tsx -> features/threads/card',
  'features/webhooks/webhooks-dialog.tsx -> features/agents/notify',
  'features/webhooks/webhooks-dialog.tsx -> features/agents/request-card',
  'features/webhooks/webhooks-dialog.tsx -> features/models/model-picker',
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
