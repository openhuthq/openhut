import { toast as sonner } from 'sonner'

export function toast(message: string) {
  sonner(message)
}

export function toastError(error: Error) {
  sonner.error(plainError(error.message))
}

export function plainError(message: string): string {
  try {
    const said = (JSON.parse(message) as { error?: { message?: unknown } } | null)?.error?.message
    return typeof said === 'string' ? said : message
  } catch {
    return message
  }
}
