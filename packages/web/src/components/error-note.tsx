import { Alert } from '@/components/ui/alert'

export function ErrorNote({ message, className }: { message?: string; className?: string }) {
  if (!message) return null
  return <Alert role="alert" data-error className={className}>{message}</Alert>
}
