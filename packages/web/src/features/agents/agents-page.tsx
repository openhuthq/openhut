import type { CSSProperties } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Me } from '@openhut/common/team/team.ts'
import { Button } from '@/components/ui/button'
import { cardVariants } from '@/components/ui/card'
import { Empty } from '@/components/ui/empty'
import { Creature } from '@/components/creature'
import { CopyButton } from '@/components/copy-button'
import { Glyph } from '@/components/glyph'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { ButtonLabel, Page } from '@/components/page'
import { AgentBadge } from '@/components/status-badge'
import { useAgents, useCreateAgent } from '@/features/agents/api'
import { modelLabel } from '@/features/agents/model-label'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const AI_LOGOS = [['claude', 'Claude'], ['cursor', 'Cursor'], ['copilot', 'GitHub Copilot'], ['gemini', 'Gemini'], ['windsurf', 'Windsurf'], ['zed', 'Zed'], ['mcp', 'Any MCP client']] as const

const NEW_NAME = 'New agent'
const HERO = 'relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-6 overflow-hidden p-7 before:pointer-events-none before:absolute before:inset-0 before:bg-[radial-gradient(oklch(0%_0_0/.09)_1px,transparent_1.2px)] before:bg-size-[12px_12px] before:[mask-image:linear-gradient(90deg,transparent_35%,#000_75%)] narrow:grid-cols-[minmax(0,1fr)] narrow:before:[mask-image:linear-gradient(180deg,transparent_40%,#000_90%)]'
const LOGO = 'grid size-[52px] place-items-center rounded-xl bg-card shadow-[0_0_0_.5px_oklch(0%_0_0/.11),0_4px_12px_oklch(0%_0_0/.05),0_1px_1px_oklch(0%_0_0/.04)] [transform:translateY(calc(sin(var(--i)_*_1.1rad)_*_8px))_rotate(calc((var(--i)_-_3)_*_2deg))]'

export function AgentsPage({ me }: { me: Me }) {
  const agents = useAgents()
  const createAgent = useCreateAgent()
  const actions = <Button type="button" variant="primary" disabled={createAgent.isPending} onClick={() => createAgent.mutate({ name: NEW_NAME }, { onError: toastError })}>
    {ICONS.plus}<ButtonLabel>New agent</ButtonLabel>
  </Button>
  return <Page title="Agents" actions={actions}>
    <div className="mx-auto flex max-w-[1152px] flex-col gap-8">
      <section className={cn(cardVariants({ variant: 'ring' }), HERO)} aria-labelledby="ya-h">
        <div className="relative flex flex-col items-start gap-2.5"><h3 id="ya-h" className="m-0 text-[18px] font-medium tracking-[-.2px]">Set up OpenHut from your agent</h3><p className="m-0 max-w-[44ch] text-mute">Copy one prompt into the agent you already use. It connects here and sets things up with you.</p>
          <CopyButton size="default" text={setupPrompt(me.publicUrl)} label="Copy prompt" /></div>
        <div className="relative flex flex-wrap justify-center gap-3 p-2" aria-hidden="true">{AI_LOGOS.map(([name, label], index) => <span className={LOGO} style={{ '--i': index } as CSSProperties} title={label} key={name}><Glyph name={name} size={22} /></span>)}</div>
      </section>
      <Loaded query={agents}>{(list) => <AgentGrid agents={list} />}</Loaded>
    </div>
  </Page>
}

function AgentGrid({ agents }: { agents: Agent[] }) {
  if (!agents.length) return <Empty><Creature id="empty" about="support" size={96} /><div>No agents yet</div></Empty>
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">{agents.map((agent) => <a className={cardVariants({ variant: 'tile' })} href={`/agents/${agent.id}`} key={agent.id}>
    <div className="flex items-center gap-3"><Creature id={agent.id} about={agent.instructions} size={44} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{agent.name}</div><div className="text-mute">{modelLabel(agent.model)}</div></div><AgentBadge agent={agent} /></div>
    <div className="line-clamp-2 min-h-[3em] text-mute">{agent.summary || 'No instructions yet'}</div>
  </a>)}</div>
}

function setupPrompt(publicUrl: string) {
  const url = `${publicUrl.replace(/\/+$/, '')}/mcp`
  return `Connect to my OpenHut and set it up with me.

OpenHut is a control MCP at ${url} (Streamable HTTP). Add it with no header, then I sign in to OpenHut in the browser when you ask.
- Claude Code: run  claude mcp add --transport http openhut ${url}
- Codex, Cursor, VS Code, Windsurf, Gemini CLI, Zed: add it to your MCP config with that URL.

Then use its tools:
1. List my agents and connections so we both see what's there.
2. Ask what agent I want: what it does and which team data it needs.
3. Create it, write its instructions, and grant only the connections it needs.
4. Start it, then tell me what you set up and what I still do by hand.`
}
