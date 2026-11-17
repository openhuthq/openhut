export type Failure = { kind: 'busy' | 'approve' | 'unreachable' | 'key' | 'timeout' | 'other'; sentence: string }
export type StepState = 'done' | 'now' | 'next' | 'failed'

export const STEPS = ['Connect over Tailscale', 'Install OpenHut', 'Sandbox (gVisor)', 'Claude Code', 'Start', 'Pair'] as const

export function clean(line: string) {
  return line.replace(/\x1b\[[0-9;]*m/g, '').replace(/\[[0-9;]*m/g, '').replace(/^(The install stopped: )?openhut: /, '').trim()
}

export function stepsOf({ lines, failed }: { lines: string[]; failed: boolean }) {
  let at = 0
  const details: string[] = []
  for (const line of lines.map(clean)) {
    const head = /^==>\s*(.*)$/.exec(line)?.[1] ?? ''
    if (/^gVisor/i.test(head)) { at = Math.max(at, 2); details[2] = head }
    else if (/^(Claude Code|agent-browser)/i.test(head)) { at = Math.max(at, 3); details[3] ??= head }
    else if (/^Starting/i.test(head)) at = Math.max(at, 4)
    else if (head) at = Math.max(at, 1)
    else if (/^Waiting for https?:/.test(line)) at = Math.max(at, 5)
  }
  return STEPS.map((label, index) => {
    const state: StepState = index < at ? 'done' : index === at ? (failed ? 'failed' : 'now') : 'next'
    return { label, detail: details[index], state }
  })
}

export function failureOf({ error, url, name, here }: { error: string; url: string | null; name: string; here: string }): Failure {
  const text = clean(error)
  if (/another install or update is already running/i.test(text)) return { kind: 'busy', sentence: `${name} is already installing or updating. Try again in a few minutes.` }
  if (url || /login\.tailscale\.com|tailscale (ssh )?(check|auth)/i.test(text)) return { kind: 'approve', sentence: 'Approve the Tailscale sign-in in your browser.' }
  if (/refused|unreachable|no route to host|could not resolve|timed out|exited with 255/i.test(text)) return { kind: 'unreachable', sentence: `Can't reach ${name} over Tailscale. Is it on and signed in to Tailscale?` }
  if (/no app key|didn't accept|answered 401|\b401\b/i.test(text)) return { kind: 'key', sentence: `OpenHut is on ${name}, but it didn't accept this ${here}'s key.` }
  if (/didn't answer within/i.test(text)) return { kind: 'timeout', sentence: `OpenHut is installed on ${name} but didn't start within 2 minutes.` }
  return { kind: 'other', sentence: `Couldn't add ${name}.` }
}
