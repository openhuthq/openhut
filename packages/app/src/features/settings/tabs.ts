import type { IconSvgElement } from '@hugeicons/react'
import { DEVICE_HUE, DEVICE_ICONS } from '../../lib/computers.ts'
import { AiMagicIcon, CloudDownloadIcon, PlugSocketIcon, ShieldUserIcon, Settings02Icon, UserGroupIcon } from '@hugeicons/core-free-icons'

export type Tab = { slug: string; name: string; icon: IconSvgElement; hue: string; subtitle: string; href?: string }

const TABS: Tab[] = [
  { slug: 'general', name: 'General', icon: Settings02Icon, hue: 'text-hue-slate', subtitle: 'Your account' },
  { slug: 'people', name: 'People', icon: UserGroupIcon, hue: 'text-hue-amber', subtitle: 'Who’s on your team, and invite links' },
  { slug: 'computers', name: 'Computers', icon: DEVICE_ICONS.mac, hue: DEVICE_HUE, subtitle: 'Where your agents run' },
  { slug: 'models', name: 'Models', icon: AiMagicIcon, hue: 'text-hue-violet', subtitle: 'Connected once for the whole install. Each agent picks its own model' },
  { slug: 'apps', name: 'Apps', icon: PlugSocketIcon, hue: 'text-hue-red', subtitle: 'What your agents can read and use', href: '/connections' },
  { slug: 'updates', name: 'Updates', icon: CloudDownloadIcon, hue: 'text-hue-sky', subtitle: 'One update for the whole install' },
]
const ADMIN: Tab = { slug: 'admin', name: 'Admin', icon: ShieldUserIcon, hue: 'text-hue-green', subtitle: 'For the whole install' }

export function tabsFor({ admin = false }: { admin?: boolean } = {}): Tab[] {
  return admin ? [...TABS, ADMIN] : TABS
}
