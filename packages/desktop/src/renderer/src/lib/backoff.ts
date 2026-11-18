export type Failed = { since: number; tries: number }

export function mayRetry({ now, failed }: { now: number; failed: Failed | undefined }): boolean {
  if (!failed) return true
  return now - failed.since >= Math.min(600_000, 60_000 * 2 ** (failed.tries - 1))
}
