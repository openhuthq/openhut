export function previewOf({ agent, threads }: { agent: { id: string; name: string; instructions: string }; threads: { id: string; title: string; preview: string; updatedAt: string }[] }): { text: string; at: string | undefined } {
  const newest = threads.reduce<typeof threads[number] | undefined>((best, each) => !best || Date.parse(each.updatedAt) > Date.parse(best.updatedAt) ? each : best, undefined)
  if (!newest) return { text: plainText({ text: agent.instructions, name: agent.name }) || 'Say hello', at: undefined }
  return { text: plainText({ text: newest.preview, name: agent.name }) || (newest.id === agent.id ? 'Main thread' : newest.title), at: newest.updatedAt }
}

export function plainText({ text, name }: { text: string; name: string }): string {
  return text.split('\n')
    .map((line) => line.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]/g, '').trim())
    .filter((line) => line && line.toLowerCase() !== name.trim().toLowerCase())
    .join(' ').replace(/\s+/g, ' ').trim()
}

export function byCreation<T extends { agent: { id: string; createdAt: string } }>(contacts: T[]): T[] {
  return [...contacts].sort((a, b) => Date.parse(a.agent.createdAt) - Date.parse(b.agent.createdAt) || a.agent.id.localeCompare(b.agent.id))
}
