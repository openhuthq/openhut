import { toast } from '@/lib/toast'

export function copyText(text: string): Promise<boolean> {
  return Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(() => true, () => {
      toast("Couldn't copy here. Select the text and copy it yourself.")
      return false
    })
}
