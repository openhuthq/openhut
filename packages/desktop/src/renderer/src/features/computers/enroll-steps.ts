export type Failure = { kind: 'busy' | 'approve' | 'unreachable' | 'timeout' | 'other'; sentence: string }

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
  if (/didn't answer within|code expired/i.test(text)) return { kind: 'timeout', sentence: `OpenHut didn't start on ${name}. Try again.` }
  return { kind: 'other', sentence: "Couldn't install OpenHut. Check the computer is on and try again." }
}
