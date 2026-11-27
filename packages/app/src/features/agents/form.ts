export function runsOnChoices<T extends { online: boolean }>(computers: T[] | undefined): T[] {
  return computers?.filter((computer) => computer.online) ?? []
}
