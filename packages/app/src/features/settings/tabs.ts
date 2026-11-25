import type { IconSvgElement } from '@hugeicons/react'
import { DEVICE_HUE, DEVICE_ICONS } from '../../lib/computers.ts'
import { AiMagicIcon, PlugSocketIcon, Settings02Icon } from '@hugeicons/core-free-icons'

export type Tab = { slug: string; name: string; icon: IconSvgElement; hue: string; subtitle: string; href?: string }

const TABS: Tab[] = [
  { slug: 'general', name: 'General', icon: Settings02Icon, hue: 'text-hue-slate', subtitle: 'Your account' },
  { slug: 'computers', name: 'Computers', icon: DEVICE_ICONS.mac, hue: DEVICE_HUE, subtitle: 'Where your agents run' },
  { slug: 'models', name: 'Models', icon: AiMagicIcon, hue: 'text-hue-violet', subtitle: 'New agents use the first one connected, from top to bottom' },
  { slug: 'apps', name: 'Apps', icon: PlugSocketIcon, hue: 'text-hue-red', subtitle: 'What your agents can read and use', href: '/connections' },
]

export function tabsFor(): Tab[] {
  return TABS
}
