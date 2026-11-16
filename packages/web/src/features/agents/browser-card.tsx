import type { Agent } from '@openhut/common/agents/agent.ts'
import { ICONS } from '@/components/icons'
import { useBrowser } from '@/features/agents/api'

export function BrowserCard({ agent }: { agent: Agent }) {
  const browser = useBrowser(agent.id, agent.browser && agent.canEdit)
  if (!agent.browser || !agent.canEdit) return null
  const page = browser.data
  return <section className="bcard">
    <div className="shead">
      <h3>Browser</h3>
      <a className="btn sm" href={`/agents/${encodeURIComponent(agent.id)}/browser`} target="_blank" rel="noopener">Watch live{ICONS.ext}</a>
    </div>
    <div className="box bmini">
      {page?.still ? <img src={page.still} alt={`A still picture of ${page.title || 'the page'} in ${agent.name}'s browser`} /> : <span className="bmini-empty" aria-hidden="true">{ICONS.ext}</span>}
      <div className="bmini-t">
        {page?.open ? <>
          <span className="mono ellip" title={page.url}>{page.url || 'about:blank'}</span>
          <span className="mute ellip">{page.heldBy ? `${page.heldBy} is using it` : page.title}</span>
        </> : <span className="mute">{browser.isPending ? 'Looking…' : `${agent.name} hasn't opened a page yet.`}</span>}
        <span className="mute bmini-n">A still picture, every 5 seconds while this page is open.</span>
        {agent.size === 'standard' && <span className="mute bmini-n">Pages use a lot of memory. Pick Large under Computer if {agent.name} browses busy sites.</span>}
      </div>
    </div>
  </section>
}
