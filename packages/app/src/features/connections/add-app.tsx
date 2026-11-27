import { useState } from 'react'
import { Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Glyph } from '@/components/glyph'
import { I } from '@/components/kit'
import { useConnections } from '@/features/connections/api'
import { INTEGRATIONS, type Integration } from '@/features/connections/catalog'
import { ConnectSheet, useQuickConnect } from '@/features/connections/connect-sheets'
import { useMe } from '@/features/people/api'

export function AddAppDialog({ onClose }: { onClose: () => void }) {
  const connected = new Set((useConnections().data ?? []).map((connection) => connection.kind))
  const quick = useQuickConnect()
  const me = useMe().data
  const [query, setQuery] = useState('')
  const [connecting, setConnecting] = useState<Integration>()
  const words = query.trim().toLowerCase()
  const items = INTEGRATIONS.filter((item) => (item.name === 'mcp' || !connected.has(item.name)) && `${item.title} ${item.short}`.toLowerCase().includes(words))
  const connect = (item: Integration) => quick.direct(item) ? quick.connect(item) : setConnecting(item)
  return <Dialog size="narrow" nested label="Add an app" onClose={onClose} className="flex h-[min(500px,calc(100vh-48px))] w-[min(440px,calc(100vw-32px))] flex-col px-6 pt-5">
    <div className="flex h-8 shrink-0 items-center justify-between">
      <DialogTitle className="text-[17px]/[24px] font-semibold">Add an app</DialogTitle>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close (Esc)" className="-mr-1.5 size-7" onClick={onClose}><I icon={Cancel01Icon} size={16} /></Button>
    </div>
    <label className="mt-4 mb-2 flex h-10 shrink-0 items-center gap-2.5 rounded-[10px] bg-soft px-3 text-mute">
      <I icon={Search01Icon} size={16} />
      <Input type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search apps" aria-label="Search apps" className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 text-[14px] focus:border-0" />
    </label>
    <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pb-6 [mask-image:linear-gradient(to_bottom,#000_calc(100%-32px),transparent)]">
      {items.map((item) => <div key={item.name} className="flex min-h-[54px] items-center gap-3.5">
        <Glyph name={item.name} size={28} />
        <span className="grid min-w-0 flex-1 gap-0.5"><b className="truncate text-[14px] font-medium">{item.title}</b><small className="truncate text-[12.5px] text-mute">{item.short}</small></span>
        <Button type="button" variant="ghost" className="h-[30px] rounded-lg px-3 text-[13px] font-medium" disabled={quick.pending} onClick={() => connect(item)}>Connect</Button>
      </div>)}
      {!items.length && <p className="m-0 py-6 text-center text-[13px] text-mute">No app matches “{query.trim()}”.</p>}
    </div>
    {connecting && me && <ConnectSheet me={me} item={connecting} onClose={() => setConnecting(undefined)} />}
  </Dialog>
}
