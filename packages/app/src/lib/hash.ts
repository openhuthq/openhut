export function hash(text: string) {
  let value = 2166136261
  for (const char of text) {
    value ^= char.charCodeAt(0)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}
