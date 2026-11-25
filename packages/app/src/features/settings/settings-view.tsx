import { ComputersSettings } from '@/features/settings/computers'
import { ModelsSettings, ModelsStep, stepOf } from '@/features/settings/models'
import { AdminSettings } from '@/features/settings/admin'
import { PeopleSettings } from '@/features/people/people'
import { AppsSettings, AppsSheet } from '@/features/connections/connections-view'
import { tabsFor } from '@/features/settings/tabs'
import { useIsAdmin } from '@/features/people/api'
import { UpdatesSettings } from '@/features/settings/updates'
import { AppWindow, HOVER, I, PICKED } from '@/components/kit'
import { navigate, useOpen, usePath } from '@/lib/router'
import { cn } from '@/lib/utils'

export function SettingsView({ tab: asked, onClose }: { tab: string; onClose: () => void }) {
  const tab = asked
  const tabs = tabsFor({ admin: useIsAdmin() })
  const current = tabs.find(({ slug }) => slug === tab) ?? tabs[0]
  const nav = <nav aria-label="Settings" className="no-scrollbar flex w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto px-3 py-4">
    {tabs.map(({ slug, name, icon, hue, href = `/settings/${slug}` }) => <a key={slug} href={href} aria-current={slug === tab ? 'page' : undefined} onClick={(event) => { event.preventDefault(); navigate(href, true) }}
      className={cn('flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-[13px]/[18px] text-ink no-underline', HOVER, slug === tab && PICKED)}><I icon={icon} size={18} className={hue} /><span className="truncate">{name}</span></a>)}
  </nav>
  const opened = useOpen()
  const step = tab === 'models' ? stepOf(opened) : undefined
  const [section, sheet] = usePath().split('/').slice(1)
  const apps = section === 'connections' && Boolean(sheet)
  return <AppWindow label="Settings" nav={nav} onClose={onClose}>
    {step && <ModelsStep id={step} />}
    {!step && apps && <AppsSheet />}
    {!step && !apps && <>
      <div className="shrink-0 pt-[26px] pr-[52px] pb-1.5 pl-[34px] phone:hidden">
        <h2 className="m-0 text-[15px]/[22px] font-medium">{current?.name}</h2>
        <p className="m-0 text-[12.5px]/[18px] text-mute">{current?.subtitle}</p>
      </div>
      <div key={tab} className="no-scrollbar fade-b flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-[18px] pb-10">
        <div className="flex flex-col gap-9"><Tab tab={tab} /></div>
      </div>
    </>}
  </AppWindow>
}

function Tab({ tab }: { tab: string }) {
  switch (tab) {
    case 'admin': return <AdminSettings />
    case 'computers': return <ComputersSettings />
    case 'models': return <ModelsSettings />
    case 'apps': return <AppsSettings />
    case 'updates': return <UpdatesSettings />
    default: return <PeopleSettings />
  }
}
