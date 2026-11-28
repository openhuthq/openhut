export function runsOnChoices<T extends { online: boolean }>(computers: T[] | undefined): T[] {
  return computers?.filter((computer) => computer.online) ?? []
}

export function nameProblem(name: string): string {
  const bad = [...new Set(name.match(/[^\w .-]/g))]
  if (!bad.length) return ''
  return `Names can’t have ${bad.join(' ')}. Remove ${bad.length > 1 ? 'them' : 'it'} to save.`
}

export function checkName(input: HTMLInputElement): void {
  input.setCustomValidity(nameProblem(input.value))
  if (!input.validity.valid) input.reportValidity()
}
