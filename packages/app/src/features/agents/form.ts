import { HIDDEN_CHARACTERS } from '@openhut/common/agents/agent.ts'
export function runsOnChoices<T extends { online: boolean }>(computers: T[] | undefined): T[] {
  return computers?.filter((computer) => computer.online) ?? []
}

export function nameProblem(name: string): string {
  return name.match(HIDDEN_CHARACTERS) ? 'This name has hidden characters. Retype it to save.' : ''
}

export function checkName(input: HTMLInputElement): void {
  input.setCustomValidity(nameProblem(input.value))
  if (!input.validity.valid) input.reportValidity()
}
