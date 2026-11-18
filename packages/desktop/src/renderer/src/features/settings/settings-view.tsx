import type { IconSvgElement } from '@hugeicons/react'
import { AiMagicIcon, LaptopIcon, PlugSocketIcon, Settings02Icon, SmartPhone01Icon } from '@hugeicons/core-free-icons'
import { ComputersSettings } from '@/features/settings/computers'
import { DevicesSettings } from '@/features/settings/devices'
import { GeneralSettings } from '@/features/settings/general'
import { leave, ModelsSettings, ModelsStep, stepOf } from '@/features/settings/models'
import { McpSettings } from '@/features/settings/mcp'
import { AppWindow, HOVER, I, PICKED } from '@/components/kit'
import { navigate, useOpen } from '@/lib/router'
import { cn } from '@/lib/utils'

const TABS: [string, string, IconSvgElement, string][] = [
  ['general', 'General', Settings02Icon, 'text-hue-slate'],
  ['computers', 'Computers', LaptopIcon, 'text-hue-blue'],
  ['devices', 'Devices', SmartPhone01Icon, 'text-hue-green'],
  ['models', 'Models', AiMagicIcon, 'text-hue-violet'],
  ['mcp', 'MCP', PlugSocketIcon, 'text-hue-teal'],
]

export function SettingsView({ tab, onClose }: { tab: string; onClose: () => void }) {
  const name = TABS.find(([slug]) => slug === tab)?.[1] ?? 'General'
  const nav = <nav aria-label="Settings" className="no-scrollbar flex w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto px-3 py-4">
    {TABS.map(([slug, name, icon, hue]) => <a key={slug} href={`/settings/${slug}`} aria-current={slug === tab ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(`/settings/${slug}`, true) }}
      className={cn('flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-[13px]/[18px] text-ink no-underline', HOVER, slug === tab && PICKED)}><I icon={icon} size={18} className={hue} />{name}</a>)}
  </nav>
  const opened = useOpen()
  const step = tab === 'models' ? stepOf(opened) : undefined
  return <AppWindow label="Settings" nav={nav} onClose={onClose} onEscape={step ? () => leave(step) : undefined}>
    {step ? <ModelsStep id={step} /> : <>
      <h2 className="m-0 shrink-0 pt-[26px] pr-[52px] pb-1.5 pl-[34px] text-[15px]/[22px] font-medium">{name}</h2>
      <div key={tab} className="no-scrollbar fade-b flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-[18px] pb-10">
        <div className="flex flex-col gap-9"><Tab tab={tab} /></div>
      </div>
    </>}
  </AppWindow>
}

function Tab({ tab }: { tab: string }) {
  switch (tab) {
    case 'computers': return <ComputersSettings />
    case 'devices': return <DevicesSettings />
    case 'models': return <ModelsSettings />
    case 'mcp': return <McpSettings />
    default: return <GeneralSettings />
  }
}
