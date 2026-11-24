import { toast as sonner } from 'sonner'

/** A success toast: a short outcome as the title, and an optional line that says what to do next. */
export function toast(title: string, note?: string) {
  sonner.success(title, { description: note })
}

export function toastInfo(title: string, note?: string) {
  sonner.info(title, { description: note })
}

/** Takes one argument on purpose: it is passed straight as `onError`, whose second argument is the mutation's variables. */
export function toastError(error: Error) {
  sonner.error(plainError(error.message))
}

export function toastFailed(title: string, note?: string) {
  sonner.error(title, { description: note })
}

export function plainError(message: string): string {
  try {
    const said = (JSON.parse(message) as { error?: { message?: unknown } } | null)?.error?.message
    return typeof said === 'string' ? said : message
  } catch {
    return message
  }
}
