import { isRecord, jsonOrUndefined } from './util.ts'

export const POLICY_FILE = 'browser-policy.json'
export const FREE_POLICY = `${JSON.stringify({ default: 'allow' })}\n`
export const HELD_POLICY = `${JSON.stringify({ default: 'deny', allow: ['snapshot', 'url', 'title', 'gettext', 'screenshot', 'tab_list', 'stream_status', 'wait'] })}\n`
export const CLOSED: BrowserStill = { open: false, url: '', title: '', data: '' }

const MAX_INPUT_LINE = 2048
const MAX_FRAME = 4 << 20
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const INPUT_TYPES = new Set(['input_mouse', 'input_keyboard', 'ping'])

export function stillAfter(still: BrowserStill, line: string): BrowserStill {
  const message = parse(line)
  switch (message?.type) {
    case 'frame': return typeof message.data === 'string' && message.data.length <= MAX_FRAME && BASE64.test(message.data) ? { ...still, open: true, data: message.data } : still
    case 'tabs': return { ...still, open: true, ...activeTab(message.tabs) }
    case 'url': return { ...still, open: true, url: text(message.url, 2048) }
    case 'closed': return CLOSED
    default: return still
  }
}

export function isInputLine(line: string): boolean {
  if (line.length > MAX_INPUT_LINE) return false
  const message = parse(line)
  return !!message && typeof message.type === 'string' && INPUT_TYPES.has(message.type)
}

function parse(line: string): Record<string, unknown> | undefined {
  const value = jsonOrUndefined(line)
  return isRecord(value) ? value : undefined
}

function activeTab(tabs: unknown): { url: string; title: string } {
  const list = Array.isArray(tabs) ? tabs.map((tab: unknown) => (isRecord(tab) ? tab : {})) : []
  const tab = list.find((each) => each.active === true) ?? list[0]
  return { url: text(tab?.url, 2048), title: text(tab?.title, 300) }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export type BrowserStill = { open: boolean; url: string; title: string; data: string }
