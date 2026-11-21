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
  }
  return phase
}

const STAGES: Record<string, { at: number; line: string }> = {
  'Connecting…': { at: 12, line: 'Knocking on the door' },
  'Installing…': { at: 45, line: 'Unpacking a few things' },
  'Starting…': { at: 75, line: 'Turning on the lights' },
  'Almost ready…': { at: 92, line: 'Almost settled in' },
}

export function stageOf(lines: string[]) {
  return STAGES[phaseOf(lines)]
}

export function failureOf({ error, url, name }: { error: string; url: string | null; name: string }): Failure {
  const text = clean(error)
  if (/another install or update is already running/i.test(text)) return { kind: 'busy', sentence: `${name} is already installing or updating. Try again in a few minutes.` }
  if (url || /login\.tailscale\.com|tailscale (ssh )?(check|auth)/i.test(text)) return { kind: 'approve', sentence: 'Approve the Tailscale sign-in in your browser, then try again.' }
  if (/refused|unreachable|no route to host|could not resolve|timed out|exited with 255/i.test(text)) return { kind: 'unreachable', sentence: `Can't reach ${name} over Tailscale. Check it's on.` }
  if (/can't reach port|port \d+ is taken|too old to share|didn't open port|didn't say its key|can't find .* on your tailnet/i.test(text)) return { kind: 'other', sentence: sentenceOf(text) }
  if (/didn't answer within/i.test(text)) return { kind: 'silent', sentence: `OpenHut is running on ${name} but it never asked to join. Try again, or copy the details for us.` }
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
