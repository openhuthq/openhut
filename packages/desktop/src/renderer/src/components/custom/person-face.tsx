const HUES: Record<string, string> = { Mo: '#ff7a59', Sara: '#b79cf2', Ana: '#19B3B1' }
const INK = '#0b0b0b'

export function PersonFace({ name, size = 36 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0" role="img" aria-label={name}>
    <circle cx={50} cy={50} r={46} fill={HUES[name] ?? '#f7c948'} stroke={INK} strokeWidth={size < 24 ? 8 : 6} />
    <ellipse cx={25} cy={62} rx={8} ry={5} fill="#EDB5AE" />
    <ellipse cx={75} cy={62} rx={8} ry={5} fill="#EDB5AE" />
    <circle cx={36} cy={50} r={6} fill={INK} />
    <circle cx={64} cy={50} r={6} fill={INK} />
    <path d="M41 62q9 9 18 0" stroke={INK} strokeWidth={5.5} fill="none" strokeLinecap="round" />
  </svg>
}

export function PersonFaces({ names, size = 24 }: { names: string[]; size?: number }) {
  return <span className="flex items-center">{names.map((name, index) => <span key={name} className="relative block shrink-0 rounded-full leading-none shadow-[0_0_0_2px_#fff]" style={{ width: size, height: size, marginLeft: index ? -size * 0.28 : 0, zIndex: names.length - index }}><PersonFace name={name} size={size} /></span>)}</span>
}
