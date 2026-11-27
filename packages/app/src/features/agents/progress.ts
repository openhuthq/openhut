export function summaryOf({ working, waiting, activity }: { working: number; waiting: number; activity: 'idle' | 'working' | 'waiting' }): 'waiting' | 'working' | undefined {
  if (waiting || activity === 'waiting') return 'waiting'
  if (working || activity === 'working') return 'working'
  return undefined
}
