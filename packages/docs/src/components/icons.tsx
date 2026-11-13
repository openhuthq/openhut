import { HugeiconsIcon } from '@hugeicons/react'
import { siClaude, siWhatsapp } from 'simple-icons'
import {
  ArrowRight01Icon, BookOpen01Icon, Brain02Icon, ChatGptIcon, CommandLineIcon, Database01Icon, Delete02Icon, Key01Icon, MessageMultiple01Icon,
  RefreshIcon, Robot01Icon, Rocket01Icon, Shield01Icon, SparklesIcon, UserGroupIcon,
} from '@hugeicons/core-free-icons'

const RED = '#dc2626', AMBER = '#d97706', VIOLET = '#7c3aed', BLUE = '#2563eb', TEAL = '#0f766e', PINK = '#db2777', INDIGO = '#4f46e5', GREEN = '#1a7f37'

const ICONS = {
  welcome: [SparklesIcon, AMBER], install: [Rocket01Icon, PINK], basics: [BookOpen01Icon, BLUE],
  agent: [Robot01Icon, VIOLET], learn: [Brain02Icon, PINK], chat: [MessageMultiple01Icon, BLUE], data: [Database01Icon, TEAL],
  key: [Key01Icon, AMBER], terminal: [CommandLineIcon, INDIGO], team: [UserGroupIcon, VIOLET],
  shield: [Shield01Icon, GREEN], upgrade: [RefreshIcon, BLUE], remove: [Delete02Icon, RED],
} as const

const SIMPLE = { claude: siClaude, whatsapp: siWhatsapp }

export type IcoName = keyof typeof ICONS

export const isIcoName = (name: string): name is IcoName => Object.hasOwn(ICONS, name)

export function Ico({ name, size = 16, tile = false }: { name: IcoName; size?: number; tile?: boolean }) {
  const [icon, color] = ICONS[name]
  return (
    <span className={tile ? 'ico tile' : 'ico'} style={{ color }}>
      <HugeiconsIcon icon={icon} size={size} color="currentColor" strokeWidth={1.5} />
    </span>
  )
}

export function Logo({ name, size = 38 }: { name: string; size?: number }) {
  if (!Object.hasOwn(SIMPLE, name)) return <img src={`/docs/logos/${name}.svg`} alt="" className="logo" style={{ width: size, height: size }} />
  const icon = SIMPLE[name as keyof typeof SIMPLE]
  return (
    <span className="logo grid place-items-center" style={{ width: size, height: size, background: `#${icon.hex}1a` }}>
      <svg viewBox="0 0 24 24" width={size / 2} height={size / 2} fill={`#${icon.hex}`} aria-hidden><path d={icon.path} /></svg>
    </span>
  )
}

export function Agents({ size = 16 }: { size?: number }) {
  return (
    <span className="agents" title="Claude or Codex">
      <svg viewBox="0 0 24 24" width={size} height={size} fill={`#${siClaude.hex}`} aria-label="Claude"><path d={siClaude.path} /></svg>
      <HugeiconsIcon icon={ChatGptIcon} size={size} color="currentColor" strokeWidth={1.5} aria-label="Codex" />
    </span>
  )
}

export function Arrow() {
  return <HugeiconsIcon icon={ArrowRight01Icon} size={16} color="currentColor" strokeWidth={1.5} className="arrow" />
}

export function PageIcon({ icon, big = false }: { icon: string; big?: boolean }) {
  if (icon.startsWith('logo:')) return <Logo name={icon.slice(5)} size={big ? 60 : 16} />
  return isIcoName(icon) ? <Ico name={icon} size={big ? 32 : 16} tile={big} /> : null
}
