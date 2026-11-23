import type { IconSvgElement } from '@hugeicons/react'
import { AiMagicIcon, CloudDownloadIcon, LaptopIcon, PlugSocketIcon, Settings02Icon, UserCircleIcon, UserGroupIcon } from '@hugeicons/core-free-icons'

export type Tab = { slug: string; name: string; icon: IconSvgElement; hue: string }

const TABS: Tab[] = [
  { slug: 'account', name: 'Account', icon: UserCircleIcon, hue: 'text-hue-blue' },
  { slug: 'team', name: 'Team', icon: UserGroupIcon, hue: 'text-hue-green' },
  { slug: 'computers', name: 'Computers', icon: LaptopIcon, hue: 'text-hue-blue' },
  { slug: 'models', name: 'Models', icon: AiMagicIcon, hue: 'text-hue-violet' },
  { slug: 'mcp', name: 'MCP', icon: PlugSocketIcon, hue: 'text-hue-teal' },
  { slug: 'general', name: 'General', icon: Settings02Icon, hue: 'text-hue-slate' },
  { slug: 'updates', name: 'Updates', icon: CloudDownloadIcon, hue: 'text-hue-sky' },
]

export function tabsFor({ phone, desktop }: { phone: boolean; desktop: boolean }): Tab[] {
  return TABS.filter(({ slug }) => (!phone || slug !== 'mcp') && (desktop || slug !== 'updates'))
}
