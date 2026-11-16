let timer: ReturnType<typeof setTimeout> | undefined

const TOAST = 'fixed bottom-[calc(24px+env(safe-area-inset-bottom,0px))] left-1/2 z-20 w-max max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-lg border border-mid bg-card px-3.5 py-2 shadow-menu'

export function toast(message: string) {
  const element = document.querySelector<HTMLElement>('[data-toast]') ?? createToast()
  element.textContent = message
  element.hidden = false
  clearTimeout(timer)
  timer = setTimeout(() => { element.hidden = true }, 2600)
}

export function toastError(error: Error) {
  toast(error.message)
}

function createToast() {
  const element = document.createElement('div')
  element.dataset.toast = ''
  element.className = TOAST
  element.setAttribute('role', 'status')
  document.body.append(element)
  return element
}
