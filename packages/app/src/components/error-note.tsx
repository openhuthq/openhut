import { Alert } from '@/components/ui/alert'
import { CloudPaused, NoComputer } from '@/lib/remote'

// What a failed read shows: nothing while Cloud is paused (sending wakes it) or not made yet.
export function shownError(error: Error | null | undefined): string | undefined {
  return error instanceof CloudPaused || error instanceof NoComputer ? undefined : error?.message
}

export function ErrorNote({ message, className }: { message?: string; className?: string }) {
  if (!message) return null
  return <Alert role="alert" data-error className={className}>{message}</Alert>
}
