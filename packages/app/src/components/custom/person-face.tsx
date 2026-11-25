const HUES = ['#ff7a59', '#b79cf2', '#19B3B1', '#f7c948', '#3d8fdc']
const INK = '#0b0b0b'

function hueOf(email: string): string {
  return HUES[[...email].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length] ?? '#ff7a59'
}

export function PersonFace({ name, email, size = 36 }: { name: string; email: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0" role="img" aria-label={name}>
    <circle cx={50} cy={50} r={46} fill={hueOf(email)} stroke={INK} strokeWidth={size < 24 ? 8 : 6} />
    <ellipse cx={25} cy={62} rx={8} ry={5} fill="#EDB5AE" />
    <ellipse cx={75} cy={62} rx={8} ry={5} fill="#EDB5AE" />
    <circle cx={36} cy={50} r={6} fill={INK} />
    <circle cx={64} cy={50} r={6} fill={INK} />
    <path d="M41 62q9 9 18 0" stroke={INK} strokeWidth={5.5} fill="none" strokeLinecap="round" />
  </svg>
}
