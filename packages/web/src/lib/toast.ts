let timer: ReturnType<typeof setTimeout> | undefined

export function toast(message: string) {
  const element = document.querySelector<HTMLElement>('.toast') ?? createToast()
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
  element.className = 'toast'
  element.setAttribute('role', 'status')
  document.body.append(element)
  return element
}
