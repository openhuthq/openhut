import { hash } from '@/lib/hash'

const BACKGROUNDS = ['#0284c7', '#db2777', '#0d9488', '#7c3aed', '#ea580c']

export function Initial({ id, email, size = 24 }: { id: string; email: string; size?: number }) {
  return <span className="initial" style={{ background: BACKGROUNDS[hash(id) % BACKGROUNDS.length], width: size, height: size }} aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
}
