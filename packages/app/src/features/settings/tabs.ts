import type { IconSvgElement } from '@hugeicons/react'
import { AiMagicIcon, CloudDownloadIcon, LaptopIcon, Settings02Icon, SmartPhone01Icon, UserGroupIcon } from '@hugeicons/core-free-icons'

export type Tab = { slug: string; name: string; icon: IconSvgElement; hue: string; soon?: true }

const TABS: Tab[] = [
  { slug: 'general', name: 'General', icon: Settings02Icon, hue: 'text-hue-slate' },
  { slug: 'people', name: 'People', icon: UserGroupIcon, hue: 'text-hue-amber' },
  { slug: 'computers', name: 'Computers', icon: LaptopIcon, hue: 'text-hue-blue' },
  { slug: 'phones', name: 'Phones', icon: SmartPhone01Icon, hue: 'text-hue-green', soon: true },
  { slug: 'models', name: 'Models', icon: AiMagicIcon, hue: 'text-hue-violet' },
  { slug: 'updates', name: 'Updates', icon: CloudDownloadIcon, hue: 'text-hue-sky' },
]

export function tabsFor(): Tab[] {
  return TABS
}
