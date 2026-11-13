import { toast } from '@/lib/toast'

export function copyText(text: string) {
  void Promise.resolve()
    .then(() => navigator.clipboard.writeText(text))
    .then(() => toast('Copied'), () => toast("Couldn't copy here. Select the text and copy it yourself."))
}
