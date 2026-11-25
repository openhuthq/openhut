import { Alert } from '@/components/ui/alert'
import { CloudPaused } from '@/lib/remote'

// What a failed read shows: nothing while Cloud is paused (sending wakes it).
export function shownError(error: Error | null | undefined): string | undefined {
  return error instanceof CloudPaused ? undefined : error?.message
}

export function ErrorNote({ message, className }: { message?: string; className?: string }) {
  if (!message) return null
  return <Alert role="alert" data-error className={className}>{message}</Alert>
}
