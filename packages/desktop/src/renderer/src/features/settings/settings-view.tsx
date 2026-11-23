import { AccountSettings } from '@/features/cloud/cloud'
import { TeamSettings } from '@/features/people/workspace'
import { ComputersSettings } from '@/features/settings/computers'
import { GeneralSettings } from '@/features/settings/general'
import { leave, ModelsSettings, ModelsStep, stepOf } from '@/features/settings/models'
import { McpSettings } from '@/features/settings/mcp'
import { UpdatesSettings } from '@/features/settings/updates'
import { desktop } from '@/features/settings/desktop'
import { tabsFor } from '@/features/settings/tabs'
import { AppWindow, HOVER, I, PICKED } from '@/components/kit'
import { isPhone } from '@/lib/native'
import { navigate, useOpen } from '@/lib/router'
import { cn } from '@/lib/utils'

const MOVED: Record<string, string> = { devices: 'computers', cloud: 'account', backup: 'account', people: 'team' }

export function SettingsView({ tab: asked, onClose }: { tab: string; onClose: () => void }) {
  const tab = MOVED[asked] ?? asked
  const tabs = tabsFor({ phone: isPhone(), desktop: !!desktop })
  const name = tabs.find(({ slug }) => slug === tab)?.name ?? 'General'
  const nav = <nav aria-label="Settings" className="no-scrollbar flex w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto px-3 py-4">
    {tabs.map(({ slug, name, icon, hue }) => <a key={slug} href={`/settings/${slug}`} aria-current={slug === tab ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(`/settings/${slug}`, true) }}
      className={cn('flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-[13px]/[18px] text-ink no-underline', HOVER, slug === tab && PICKED)}><I icon={icon} size={18} className={hue} /><span className="truncate">{name}</span></a>)}
  </nav>
  const opened = useOpen()
  const step = tab === 'models' ? stepOf(opened) : undefined
  return <AppWindow label="Settings" nav={nav} onClose={onClose} onEscape={step ? () => leave(step) : undefined}>
    {step ? <ModelsStep id={step} /> : <>
      <h2 className="m-0 shrink-0 pt-[26px] pr-[52px] pb-1.5 pl-[34px] text-[15px]/[22px] font-medium phone:hidden">{name}</h2>
      <div key={tab} className="no-scrollbar fade-b flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-[18px] pb-10">
        <div className="flex flex-col gap-9"><Tab tab={tab} /></div>
      </div>
    </>}
  </AppWindow>
}

function Tab({ tab }: { tab: string }) {
  switch (tab) {
    case 'account': return <AccountSettings />
    case 'team': return <TeamSettings />
    case 'computers': return <ComputersSettings />
    case 'models': return <ModelsSettings />
    case 'mcp': return <McpSettings />
    case 'updates': return <UpdatesSettings />
    default: return <GeneralSettings />
  }
}
