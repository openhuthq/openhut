export function byCreation<T extends { agent: { id: string; createdAt: string } }>(contacts: T[]): T[] {
  return [...contacts].sort((a, b) => Date.parse(a.agent.createdAt) - Date.parse(b.agent.createdAt) || a.agent.id.localeCompare(b.agent.id))
}
