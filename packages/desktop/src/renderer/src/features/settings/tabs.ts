import type { IconSvgElement } from '@hugeicons/react'
import { AiMagicIcon, CloudDownloadIcon, LaptopIcon, Settings02Icon, UserCircleIcon } from '@hugeicons/core-free-icons'

export type Tab = { slug: string; name: string; icon: IconSvgElement; hue: string }

const TABS: Tab[] = [
  { slug: 'account', name: 'Account', icon: UserCircleIcon, hue: 'text-hue-blue' },
  { slug: 'computers', name: 'Computers', icon: LaptopIcon, hue: 'text-hue-blue' },
  { slug: 'models', name: 'Models', icon: AiMagicIcon, hue: 'text-hue-violet' },
  { slug: 'general', name: 'General', icon: Settings02Icon, hue: 'text-hue-slate' },
  { slug: 'updates', name: 'Updates', icon: CloudDownloadIcon, hue: 'text-hue-sky' },
]

export function tabsFor({ desktop }: { desktop: boolean }): Tab[] {
  return TABS.filter(({ slug }) => desktop || slug !== 'updates')
}
