export function Flag({ country }: { country: string }) {
  const emoji = [...country.toUpperCase()].map((letter) => String.fromCodePoint(0x1f1a5 + letter.charCodeAt(0))).join('')
  return <span role="img" aria-label={country}>{emoji}</span>
}
