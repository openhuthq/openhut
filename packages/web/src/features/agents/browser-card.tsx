import type { Agent } from '@openhut/common/agents/agent.ts'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ICONS } from '@/components/icons'
import { SectionHead } from '@/components/section-head'
import { useBrowser } from '@/features/agents/api'
import { cn } from '@/lib/utils'

const THUMB = 'aspect-[16/10] w-28 shrink-0 rounded-md border border-hair bg-tint object-cover object-top'

export function BrowserCard({ agent }: { agent: Agent }) {
  const browser = useBrowser(agent.id, agent.browser && agent.canEdit)
  if (!agent.browser || !agent.canEdit) return null
  const page = browser.data
  return <section className="mt-4">
    <SectionHead title="Browser" action={<a className={buttonVariants({ size: 'sm' })} href={`/agents/${encodeURIComponent(agent.id)}/browser`} target="_blank" rel="noopener">Watch live{ICONS.ext}</a>} />
    <Card className="flex min-w-0 items-center gap-3 p-2.5">
      {page?.still ? <img className={THUMB} src={page.still} alt={`A still picture of ${page.title || 'the page'} in ${agent.name}'s browser`} /> : <span className={cn(THUMB, 'grid place-items-center text-mute-2')} aria-hidden="true">{ICONS.ext}</span>}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[12.5px]">
        {page?.open ? <>
          <span className="truncate font-mono text-xs" title={page.url}>{page.url || 'about:blank'}</span>
          <span className="truncate text-mute">{page.heldBy ? `${page.heldBy} is using it` : page.title}</span>
        </> : <span className="text-mute">{browser.isPending ? 'Looking…' : `${agent.name} hasn't opened a page yet.`}</span>}
        <span className="text-[11.5px] text-mute">A still picture, every 5 seconds while this page is open.</span>
        <span className="text-[11.5px] text-mute">With Browser on, {agent.name} can use up to 4 GB of memory.</span>
      </div>
    </Card>
  </section>
}
