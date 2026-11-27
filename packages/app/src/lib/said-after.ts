type Said = { role: string; parts: readonly { type: string; text?: string }[] }

export function saidAfter(messages: readonly Said[]): (index: number, text: string) => boolean {
  const last = new Map<string, number>()
  messages.forEach((message, index) => {
    if (message.role === 'user') last.set(message.parts.map((part) => part.type === 'text' ? part.text : '').join(''), index)
  })
  return (index, text) => (last.get(text) ?? -1) > index
}
