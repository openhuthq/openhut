import { toast } from '@/lib/toast'

export function copyText(text: string): Promise<boolean> {
  return Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(() => true, () => {
      toast("Couldn't copy here. Select the text and copy it yourself.")
      return false
    })
}

export async function copySecret(text: string): Promise<boolean> {
  if (!await copyText(text)) return false
  setTimeout(() => void navigator.clipboard.readText().then((now) => now === text ? navigator.clipboard.writeText('') : undefined).catch(() => undefined), 60_000)
  return true
}
