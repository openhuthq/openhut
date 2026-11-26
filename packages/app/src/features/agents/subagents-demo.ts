import { useEffect, useState } from 'react'

export type Subagent = { id: string; title: string; status: 'queued' | 'working' | 'done' | 'failed'; gone: boolean }
export type SubagentBatch = { goal: string; children: Subagent[] }

const BATCHES = [
  { goal: 'Audit every customer account', titles: ['Check Acme', 'Check Globex', 'Check Initech', 'Check Umbrella', 'Check Hooli', 'Check Stark', 'Check Wayne', 'Check Wonka', 'Check Soylent', 'Check Tyrell', 'Check Cyberdyne', 'Check Oscorp'] },
  { goal: 'Prepare the launch brief', titles: ['Research competitors', 'Draft the onboarding email', 'Summarize last week’s feedback'] },
  { goal: 'Triage the overnight alerts', titles: ['Check yesterday’s errors', 'Find the slow queries'] },
  { goal: 'Get the pipeline review ready', titles: ['Pull open deals from the CRM', 'List stalled accounts', 'Draft the pipeline summary'] },
  { goal: 'Answer the refund backlog', titles: ['Look up the 12 open tickets', 'Check each order in the Orders DB', 'Draft the replies'] },
]

export const DEMO_THREADS = [
  { id: 'slack', kind: 'slack', title: 'Plan the launch', channel: '#launch', time: '2m', status: 'working', unread: false },
  { id: 'review', kind: 'slack', title: 'Refund for Acme', channel: '#support', time: '14m', status: 'review', unread: true },
  { id: 'routine', kind: 'routine', title: 'Morning digest', channel: '', time: '8:00', status: 'done', unread: false },
] as const

export function useDemoThreads() {
  return enabled() ? DEMO_THREADS : []
}

function enabled(): boolean {
  return new URLSearchParams(location.search).get('subagents') === 'demo'
}

export function useSubagents(agentId: string | undefined): SubagentBatch | undefined {
  const [batch, setBatch] = useState<SubagentBatch>()
  useEffect(() => {
    if (!agentId || !enabled()) return
    const timers: number[] = []
    const later = (ms: number, run: () => void) => timers.push(window.setTimeout(run, ms))
    const patch = (id: string, change: Partial<Subagent>) => setBatch((now) => now && { ...now, children: now.children.map((child) => (child.id === id ? { ...child, ...change } : child)) })
    let round = 0
    const start = () => {
      const pick = BATCHES[round++ % BATCHES.length]
      const children = pick.titles.map((title, i): Subagent => ({ id: `${round}-${i}`, title, status: i >= pick.titles.length - 2 ? 'queued' : 'working', gone: false }))
      setBatch({ goal: pick.goal, children })
      let last = 0
      later(3000, () => patch(children[children.length - 1].id, { status: 'working' }))
      children.forEach((child, i) => {
        const at = 8000 + Math.random() * 17000
        const failed = i === 2 && round % 3 === 0
        last = Math.max(last, at)
        later(at, () => patch(child.id, { status: failed ? 'failed' : 'done' }))
        if (!failed) later(at + 1500, () => patch(child.id, { gone: true }))
      })
      later(last + 6000, () => {
        setBatch(undefined)
        later(4000, start)
      })
    }
    start()
    return () => timers.forEach(clearTimeout)
  }, [agentId])
  return batch
}
