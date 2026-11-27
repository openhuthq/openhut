export function summaryOf({ working, waiting, activity }: { working: number; waiting: number; activity: 'idle' | 'working' | 'waiting' }): 'waiting' | 'working' | undefined {
  if (waiting || activity === 'waiting') return 'waiting'
  if (working || activity === 'working') return 'working'
  return undefined
}

export function previewOf({ agentId, summary, threads }: { agentId: string; summary: string; threads: { id: string; title: string; preview: string; updatedAt: string }[] }): { text: string; at: string | undefined } {
  const newest = threads.reduce<typeof threads[number] | undefined>((best, each) => !best || Date.parse(each.updatedAt) > Date.parse(best.updatedAt) ? each : best, undefined)
  const text = newest?.preview || (newest && newest.id !== agentId ? newest.title : summary || 'Say hello')
  return { text, at: newest?.updatedAt }
}
