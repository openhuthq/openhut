import { ComputersSettings } from '@/features/settings/computers'
import { GeneralSettings } from '@/features/settings/general'
import { PeopleSettings } from '@/features/people/workspace'
import { leave, ModelsSettings, ModelsStep, stepOf } from '@/features/settings/models'
import { UpdatesSettings } from '@/features/settings/updates'
import { tabsFor } from '@/features/settings/tabs'
import { SmartPhone01Icon } from '@hugeicons/core-free-icons'
import { AppWindow, HOVER, I, PICKED } from '@/components/kit'
import { navigate, useOpen } from '@/lib/router'
import { cn } from '@/lib/utils'

const MOVED: Record<string, string> = { devices: 'computers', cloud: 'general', backup: 'general', account: 'general', team: 'general', mcp: 'general' }

export function SettingsView({ tab: asked, onClose }: { tab: string; onClose: () => void }) {
  const tab = MOVED[asked] ?? asked
  const tabs = tabsFor()
  const name = tabs.find(({ slug }) => slug === tab)?.name ?? 'General'
  const nav = <nav aria-label="Settings" className="no-scrollbar flex w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto px-3 py-4">
    {tabs.map(({ slug, name, icon, hue, soon }) => <a key={slug} href={`/settings/${slug}`} aria-current={slug === tab ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(`/settings/${slug}`, true) }}
      className={cn('flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-[13px]/[18px] text-ink no-underline', HOVER, slug === tab && PICKED)}><I icon={icon} size={18} className={hue} /><span className="truncate">{name}</span>{soon && <span className="ml-auto rounded-full bg-soft px-1.5 py-px text-[10.5px] font-medium text-mute">Soon</span>}</a>)}
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
    case 'people': return <PeopleSettings />
    case 'computers': return <ComputersSettings />
    case 'phones': return <PhonesSoon />
    case 'models': return <ModelsSettings />
    case 'updates': return <UpdatesSettings />
    default: return <GeneralSettings />
  }
}

function PhonesSoon() {
  return <div className="flex flex-col items-center gap-3 px-6 pt-10 text-center">
    <span className="grid size-14 place-items-center rounded-2xl bg-soft"><I icon={SmartPhone01Icon} size={26} className="text-hue-green" /></span>
    <span className="text-[18px]/[1.3] font-semibold tracking-[-.01em]">Phones are coming soon</span>
    <p className="m-0 max-w-[420px] text-[13.5px]/[20px] text-body">Chat with your agents from your phone. It arrives in an update.</p>
  </div>
}
