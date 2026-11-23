import { toast as sonner } from 'sonner'

export function toast(message: string) {
  sonner(message)
}

export function toastError(error: Error) {
  sonner.error(error.message)
}
