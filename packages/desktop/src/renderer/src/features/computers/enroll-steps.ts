export type Failure = { kind: 'busy' | 'approve' | 'unreachable' | 'silent' | 'timeout' | 'other'; sentence: string }

export function clean(line: string) {
  return line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[[0-9;]*m/g, '').replace(/^(The install stopped: )?openhut: /, '').trim()
}

export function phaseOf(lines: string[]) {
  let phase = 'Connecting…'
  for (const line of lines.map(clean)) {
    const head = /^==>\s*(.*)$/.exec(line)?.[1] ?? ''
    if (/^Starting/i.test(head)) phase = 'Starting…'
    else if (head) phase = 'Installing…'
    else if (/^Waiting for /.test(line)) phase = 'Almost ready…'
    else if (/^Asking to join/.test(line)) phase = 'Asking…'
  }
  return phase
}

const STAGES: Record<string, { at: number; line: string }> = {
  'Connecting…': { at: 12, line: 'Connecting' },
  'Installing…': { at: 45, line: 'Installing OpenHut' },
  'Starting…': { at: 75, line: 'Starting' },
  'Almost ready…': { at: 92, line: 'Almost ready' },
  'Asking…': { at: 96, line: 'Asking to join. Close this and press Review on it' },
}

export function stageOf(lines: string[]) {
  const faces = lines.map(clean).filter((line) => line.startsWith('In OpenHut, tap these two faces')).at(-1)
  const stage = STAGES[phaseOf(lines)]
  return faces ? { ...stage, line: faces.replace(/\.$/, '') } : stage
}

export function failureOf({ error, url, name }: { error: string; url: string | null; name: string }): Failure {
  const text = clean(error)
  if (/another install or update is already running/i.test(text)) return { kind: 'busy', sentence: `${name} is already installing or updating. Try again in a few minutes.` }
  if (url || /login\.tailscale\.com|tailscale (ssh )?(check|auth)/i.test(text)) return { kind: 'approve', sentence: 'Approve the Tailscale sign-in in your browser, then try again.' }
  if (/refused|unreachable|no route to host|could not resolve|timed out|exited with 255/i.test(text)) return { kind: 'unreachable', sentence: `Can't reach ${name} over Tailscale. Check it's on.` }
  if (/can't reach port|port \d+ is taken|too old to share|didn't open port|didn't say its key|can't find .* on your Tailscale/i.test(text)) return { kind: 'other', sentence: sentenceOf(text) }
  if (/didn't answer within/i.test(text)) return { kind: 'silent', sentence: `OpenHut is installed on ${name}, but it didn't connect. Try again, or copy the details and send them to us.` }
  if (/join code expired|used already/i.test(text)) return { kind: 'timeout', sentence: `The join code ran out before ${name} used it. Try again.` }
  if (/turned down/i.test(text)) return { kind: 'other', sentence: `${name} was turned down, so it didn't join. Try again to add it.` }
  if (/code expired/i.test(text)) return { kind: 'timeout', sentence: `OpenHut didn't start on ${name}. Try again.` }
  return { kind: 'other', sentence: "Couldn't install OpenHut. Check the computer is on and try again." }
}

const WAIT_MS = 120_000

export function percentOf({ lines, waitingAt, now }: { lines: string[]; waitingAt?: number | null; now: number }) {
  const phase = phaseOf(lines)
  const at = STAGES[phase].at
  if (phase === 'Installing…') return Math.min(74, at + 3 * lines.map(clean).filter((line) => /^==>/.test(line)).length)
  if (phase === 'Almost ready…' && waitingAt) return Math.min(99, at + Math.floor(7 * Math.max(0, now - waitingAt) / WAIT_MS))
  return at
}

export function detailsOf({ enrollment, version }: { enrollment: { peer: { name: string; dns: string }; lines: string[]; error: string; log?: string }; version: string }) {
  const log = enrollment.log ? ['', `${enrollment.peer.name}'s log:`, enrollment.log] : []
  return [`OpenHut ${version} adding ${enrollment.peer.dns}`, ...enrollment.lines.map(clean), enrollment.error, ...log].join('\n')
}

function sentenceOf(text: string) {
  const line = text.replace(/^The install stopped: /, '')
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}`
}
