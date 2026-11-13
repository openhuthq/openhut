import { hash } from '@/lib/hash'

const BACKGROUNDS = ['#26262b', '#3f5a7a', '#2f6b5b', '#5b4f8a', '#8a5a2b']

export function Initial({ id, email, size = 24 }: { id: string; email: string; size?: number }) {
  return <span className="initial" style={{ background: BACKGROUNDS[hash(id) % BACKGROUNDS.length], width: size, height: size }} aria-hidden="true">{email.charAt(0).toUpperCase()}</span>
}
