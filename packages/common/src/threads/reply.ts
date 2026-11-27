export const STEP = 'data-step'

type Part = { type: string }

const textIn = (part: Part): string => part.type === 'text' && 'text' in part && typeof part.text === 'string' ? part.text : ''

export function replyOf<P extends Part>(parts: P[]): { notes: string[]; reply: P[] } {
  const at = parts.map((part) => part.type).lastIndexOf(STEP)
  return { notes: parts.slice(0, at + 1).map(textIn).filter((text) => text.trim()), reply: parts.slice(at + 1) }
}

export const replyText = (parts: Part[]): string => replyOf(parts).reply.map(textIn).join('')
