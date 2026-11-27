import type { ToolCall, ToolProgress, Work } from '@openhut/common/threads/thread.ts'
import { connectionService, type AgentTool, type AppCall } from '../connections/connection-service.ts'
import type { ToolSpec } from '../integrations/connector.ts'
import { permissions } from '../permissions/permissions.ts'
import { redact } from '../connections/redact.ts'

const MAX_CALLS = 50
const MAX_INPUT = 1000
const MAX_OUTPUT = 2000
const HIDDEN = new Set(['get_self', 'list_tools', 'describe_tool'])
const ASKS = new Set(['update_self', 'add_channel', 'update_channel', 'remove_channel', 'connect_app', 'add_secret', 'add_webhook'])
type Kind = ToolCall['kind']
const BUILT_IN: Record<string, [string, string, Kind]> = {
  web_search: ['Search the web', 'Searched the web', 'read'],
  web_extract: ['Read a web page', 'Read a web page', 'read'],
  terminal: ['Run a command', 'Ran a command', 'other'],
  process: ['Check a command', 'Checked a command', 'other'],
  execute_code: ['Run code', 'Ran code', 'other'],
  read_file: ['Read a file', 'Read a file', 'read'],
  search_files: ['Search files', 'Searched files', 'read'],
  write_file: ['Write a file', 'Wrote a file', 'change'],
  patch: ['Edit a file', 'Edited a file', 'change'],
  vision_analyze: ['Look at an image', 'Looked at an image', 'read'],
  image_generate: ['Make an image', 'Made an image', 'change'],
  memory: ['Update its memory', 'Updated its memory', 'change'],
  skills_list: ['List skills', 'Listed skills', 'read'],
  skill_view: ['Read a skill', 'Read a skill', 'read'],
  skill_manage: ['Update a skill', 'Updated a skill', 'change'],
  todo: ['Update its plan', 'Updated its plan', 'other'],
  delegate_task: ['Hand off a task', 'Handed off a task', 'other'],
  send_message: ['Send a message', 'Sent a message', 'change'],
  connect_app: ['Ask to connect an app', 'Asked to connect an app', 'other'],
  update_self: ['Ask to change its instructions', 'Asked to change its instructions', 'change'],
  add_channel: ['Ask to add a channel', 'Asked to add a channel', 'change'],
  update_channel: ['Ask to change a channel', 'Asked to change a channel', 'change'],
  remove_channel: ['Ask to remove a channel', 'Asked to remove a channel', 'delete'],
  add_secret: ['Ask for a key', 'Asked for a key', 'other'],
  add_webhook: ['Ask for a webhook', 'Asked for a webhook', 'other'],
  schedule_routine: ['Schedule a follow-up', 'Scheduled a follow-up', 'change'],
  list_routines: ['List follow-ups', 'Listed follow-ups', 'read'],
  cancel_routine: ['Cancel a follow-up', 'Canceled a follow-up', 'delete'],
  run_routine: ['Run a follow-up now', 'Ran a follow-up', 'other'],
}
const VERBS: Record<string, string> = {
  query: 'Queried', list: 'Listed', get: 'Read', read: 'Read', search: 'Searched', find: 'Found', fetch: 'Fetched', check: 'Checked', describe: 'Described',
  create: 'Created', add: 'Added', update: 'Updated', edit: 'Edited', set: 'Set', write: 'Wrote', save: 'Saved', comment: 'Commented on', reply: 'Replied to',
  delete: 'Deleted', remove: 'Removed', cancel: 'Canceled', close: 'Closed', archive: 'Archived', merge: 'Merged', move: 'Moved', copy: 'Copied', assign: 'Assigned',
  run: 'Ran', execute: 'Ran', send: 'Sent', post: 'Posted', open: 'Opened', start: 'Started', stop: 'Stopped', restart: 'Restarted', deploy: 'Deployed', publish: 'Published',
  push: 'Pushed', upload: 'Uploaded', download: 'Downloaded', export: 'Exported', import: 'Imported', draw: 'Drew', generate: 'Generated', analyze: 'Analyzed',
  resize: 'Resized', invoke: 'Used', call: 'Used', use: 'Used',
}
const PRESENT: Record<string, string> = { invoke: 'use', call: 'use', execute: 'run', get: 'read', comment: 'comment on', reply: 'reply to' }
const FILLER = new Set(['mcp', 'tool', 'openhut', 'gateway'])

export function labelOf({ name, app, title }: { name: string; app?: string | null; title?: string }): { label: string; past: string } {
  const source = title?.trim() || name
  const words = source.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_.-]+/).filter((word) => word && !FILLER.has(word.toLowerCase()) && word.toLowerCase() !== app?.toLowerCase()).map((word) => /^[A-Z][a-z]+$/.test(word) ? word.toLowerCase() : word)
  const at = words.findIndex((word) => Object.hasOwn(VERBS, word.toLowerCase()))
  const object = words.filter((_, index) => index !== at).join(' ')
  const where = app ? (object ? ` in ${app}` : ` ${app}`) : ''
  if (at < 0) return { label: `Use ${[app, object].filter(Boolean).join(' ')}`, past: `Used ${[app, object].filter(Boolean).join(' ')}` }
  const verb = words[at].toLowerCase()
  const present = PRESENT[verb] ?? verb
  return { label: capital(`${present}${object ? ` ${object}` : ''}${where}`), past: `${VERBS[verb]}${object ? ` ${object}` : ''}${where}` }
}

export function kindOf(spec: ToolSpec): Kind {
  const group = permissions.groupOf(spec)
  if (group === 'create' || group === 'update') return 'change'
  return group
}

export function builtIn({ name, input }: { name: string; input?: string }): Omit<ToolCall, 'id' | 'status' | 'ms'> {
  const known = BUILT_IN[name] ?? (name.startsWith('browser_') ? ['Use the browser', 'Used the browser', 'other'] as const : undefined)
  const [label, past, kind] = known ?? [labelOf({ name }).label, labelOf({ name }).past, 'other' as const]
  return { tool: name, app: null, kind, label, past, ...input && input !== name && { input: clip(input, MAX_INPUT) } }
}

export function appCall(call: AppCall): Omit<ToolCall, 'id'> {
  const spec = call.action?.spec ?? call.spec
  const status = ({ allowed: 'done', asked: 'asked', denied: 'blocked', failed: 'failed' } as const)[call.outcome]
  const input = Object.keys(call.args).length ? clip(redact(JSON.stringify(call.args, null, 2)), MAX_INPUT) : undefined
  return {
    tool: spec?.name ?? call.name, app: call.app, ...call.connectionId && { connectionId: call.connectionId },
    kind: spec ? kindOf(spec) : 'other', ...labelOf({ name: spec?.name ?? call.name, app: call.app, title: call.action?.label ?? spec?.annotations?.title }),
    ...input && { input }, ...call.output && { output: clip(call.output, MAX_OUTPUT) }, ...call.error && { error: clip(call.error, MAX_OUTPUT) },
    ms: call.ms, status,
  }
}

export function joinCalls({ chips, records }: { chips: Chip[]; records: AppCall[] }): ToolCall[] {
  const free = [...records]
  const calls = chips.map((chip): ToolCall => {
    const index = chip.app ? free.findIndex((record) => record.name === chip.name) : -1
    if (index < 0) return chip.call
    const [record] = free.splice(index, 1)
    return { ...appCall(record), id: chip.call.id }
  })
  return [...calls, ...free.map((record, index) => ({ ...appCall(record), id: `call${index}` }))].slice(0, MAX_CALLS)
}

export function turnWork({ agent, started }: { agent: { id: string; owner_id: string }; started: number }) {
  const chips: Chip[] = []
  let tools: Promise<AgentTool[]> | undefined
  const view = (error?: string): Work => {
    const calls = joinCalls({ chips, records: connectionService.callsSince({ agentId: agent.id, since: started }) })
    const settled = error === undefined ? calls : calls.map((call) => call.status === 'running' ? { ...call, status: 'failed' as const } : call)
    return { calls: settled, ms: Date.now() - started, ...error !== undefined && { error } }
  }
  return {
    async tool(progress: ToolProgress): Promise<Work | undefined> {
      const tool = progress.tool ?? progress.name
      const short = tool?.split('__').at(-1)
      if (!short || HIDDEN.has(short)) return undefined
      const id = typeof progress.toolCallId === 'string' ? progress.toolCallId : `t${chips.length}`
      const known = chips.find((chip) => chip.call.id === id)
      const done = progress.status === 'completed'
      if (known) {
        if (done) known.call = { ...known.call, status: ASKS.has(short) ? 'asked' : 'done', ms: Date.now() - known.start }
        return view()
      }
      const label = progress.label?.trim()
      if (short === 'call_tool' && label) {
        tools ??= connectionService.tools({ agent }).catch(() => [])
        const found = (await tools).find((each) => each.name === label)
        const base = found ? { tool: found.spec.name, app: found.connection.name, connectionId: found.connection.id, kind: kindOf(found.spec), ...labelOf({ name: found.spec.name, app: found.connection.name, title: found.spec.annotations?.title }) } : builtIn({ name: label })
        chips.push({ start: Date.now(), name: label, app: true, call: { ...base, id, ms: 0, status: done ? 'done' : 'running' } })
      } else chips.push({ start: Date.now(), name: short, app: false, call: { ...builtIn({ name: short, input: label }), id, ms: 0, status: done ? 'done' : 'running' } })
      return view()
    },

    done({ error }: { error?: string }): Work | undefined {
      const work = view(error)
      return work.calls.length ? work : undefined
    },
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

type Chip = { start: number; name: string; app: boolean; call: ToolCall }
