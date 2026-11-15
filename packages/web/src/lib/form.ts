import type { FormEvent } from 'react'

export function formValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault()
  const data = new FormData(event.currentTarget)
  return (name: string) => {
    const value = data.get(name)
    return typeof value === 'string' ? value : ''
  }
}
