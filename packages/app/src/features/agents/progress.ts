export type Progress = 'idle' | 'queued' | 'working' | 'review' | 'done' | 'failed'

export function summaryOf({ working, waiting, activity }: { working: number; waiting: number; activity: 'idle' | 'working' | 'waiting' }): Progress | undefined {
  if (waiting || activity === 'waiting') return 'review'
  if (working || activity === 'working') return 'working'
  return undefined
}
