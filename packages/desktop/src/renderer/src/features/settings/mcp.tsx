import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import type { BrandName } from '@/components/brand-icons'
import { PILL } from '@/components/kit'
import { useComputers } from '@/features/computers/api'
import { desktop } from '@/features/settings/desktop'
import { Command, Intro } from '@/features/settings/kit'
import { cn } from '@/lib/utils'

export function McpSettings() {
  const bridge = desktop?.mcp
  const names = useComputers().data?.map((computer) => computer.name) ?? []
  if (!bridge) return <ErrorNote message="Open the OpenHut app on this computer to see this." />
  const command = [/\s/.test(bridge.command) ? `"${bridge.command}"` : bridge.command, ...bridge.args].join(' ')
  return <>
    <Intro>Manage your agents from Claude Code, Codex or Cursor. One MCP reaches every computer you added.</Intro>
    <div className="flex flex-col gap-1">
      <Client brand="claude" name="Claude Code"><Command text={`claude mcp add openhut -- ${command}`} /></Client>
      <Client brand="codex" name="Codex"><Command text={`codex mcp add openhut -- ${command}`} /></Client>
      <Client brand="cursor" name="Cursor">
        <a href={cursorLink(bridge)} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary' }), PILL)}>Add to Cursor</a>
      </Client>
    </div>
    {names.length > 0 && <p className="m-0 px-2.5 text-[12px]/[16px] text-mute">Reaches {new Intl.ListFormat('en').format(names)} while OpenHut is open.</p>}
  </>
}

function Client({ brand, name, children }: { brand: BrandName; name: string; children: ReactNode }) {
  return <div className="flex items-center gap-4 px-2.5 py-1.5">
    <span className="flex w-32 shrink-0 items-center gap-2.5 text-[13px]/[18px]"><Glyph name={brand} size={18} />{name}</span>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
}

function cursorLink(bridge: { command: string; args: string[] }) {
  return `cursor://anysphere.cursor-deeplink/mcp/install?name=openhut&config=${encodeURIComponent(btoa(JSON.stringify(bridge)))}`
}
