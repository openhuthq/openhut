export const POLICY_FILE = 'browser-policy.json'
export const FREE_POLICY = `${JSON.stringify({ default: 'allow' })}\n`
export const HELD_POLICY = `${JSON.stringify({ default: 'deny', allow: ['snapshot', 'url', 'title', 'gettext', 'screenshot', 'tab_list', 'stream_status', 'wait'] })}\n`
export const CLOSED: BrowserStill = { open: false, url: '', title: '', data: '' }

const MAX_INPUT_LINE = 2048
const MAX_FRAME = 4 << 20
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const INPUT_TYPES = new Set(['input_mouse', 'input_keyboard', 'ping'])

export function stillOf(stdout: string): BrowserStill {
  const line = stdout.split('\n').find((each) => each.startsWith('{'))
  const message = parse(line ?? '')
  if (!message || message.type !== 'still') return CLOSED
  const data = typeof message.data === 'string' && message.data.length <= MAX_FRAME && BASE64.test(message.data) ? message.data : ''
  return { open: true, url: text(message.url, 2048), title: text(message.title, 300), data }
}

export function isInputLine(line: string): boolean {
  if (line.length > MAX_INPUT_LINE) return false
  const message = parse(line)
  return !!message && typeof message.type === 'string' && INPUT_TYPES.has(message.type)
}

function parse(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
  } catch {
    return undefined
  }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export type BrowserStill = { open: boolean; url: string; title: string; data: string }
