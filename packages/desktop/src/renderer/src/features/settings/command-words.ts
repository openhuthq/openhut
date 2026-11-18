export function wordsOf(command: string) {
  const parts = command.match(/"[^"]*"|\S+/g) ?? []
  const words: string[] = []
  for (const part of parts) {
    const last = words.at(-1)
    if (last && (last === '--' || /^--\w/.test(last)) && !last.includes(' ') && !part.startsWith('-')) words[words.length - 1] = `${last} ${part}`
    else words.push(part)
  }
  return words
}
