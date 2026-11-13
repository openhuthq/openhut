import type { Agent } from '@fastmonkey/common/agents/agent.ts'
import type { Me } from '@fastmonkey/common/team/team.ts'
import { Avatar } from '@/components/avatar'
import { Glyph } from '@/components/glyph'
import { ICONS } from '@/components/icons'
import { Loaded } from '@/components/loaded'
import { Page } from '@/components/page'
import { AgentBadge } from '@/components/status-badge'
import { useAgents, useCreateAgent } from '@/features/agents/api'
import { modelLabel } from '@/features/agents/model-label'
import { copyText } from '@/lib/clipboard'
import { toastError } from '@/lib/toast'

const AI_LOGOS = [['claude', 'Claude'], ['cursor', 'Cursor'], ['copilot', 'GitHub Copilot'], ['gemini', 'Gemini'], ['windsurf', 'Windsurf'], ['zed', 'Zed'], ['mcp', 'Any MCP client']] as const

const NEW_NAME = 'New agent'

export function AgentsPage({ me }: { me: Me }) {
  const agents = useAgents()
  const createAgent = useCreateAgent()
  const actions = <button type="button" className="btn primary" disabled={createAgent.isPending} onClick={() => createAgent.mutate({ name: NEW_NAME }, { onError: toastError })}>
    {ICONS.plus}<span className="lbl">New agent</span>
  </button>
  return <Page title="Agents" actions={actions}>
    <div className="wrap">
      <section className="aihero" aria-labelledby="ya-h">
        <div className="aicopy"><h3 id="ya-h">Set up Fast Monkey from your agent</h3><p>Copy one prompt into the agent you already use. It connects here and sets things up with you.</p>
          <button type="button" className="btn primary" onClick={() => copyText(setupPrompt(me.publicUrl))}>{ICONS.copy}Copy prompt</button></div>
        <div className="ailogos" aria-hidden="true">{AI_LOGOS.map(([name, label]) => <span className="ailogo" title={label} key={name}><Glyph name={name} size={22} /></span>)}</div>
      </section>
      <Loaded query={agents}>{(list) => <AgentGrid agents={list} />}</Loaded>
    </div>
  </Page>
}

function AgentGrid({ agents }: { agents: Agent[] }) {
  if (!agents.length) return <div className="empty"><Avatar id="empty" about="support" size={96} /><div>No agents yet</div></div>
  return <div className="grid">{agents.map((agent) => <a className="card" href={`/agents/${agent.id}`} key={agent.id}>
    <div className="top"><Avatar id={agent.id} about={agent.instructions} size={44} /><div className="who"><div className="name ellip">{agent.name}</div><div className="mute">{modelLabel(agent.model)}</div></div><AgentBadge agent={agent} /></div>
    <div className="role">{agent.summary || 'No instructions yet'}</div>
  </a>)}</div>
}

function setupPrompt(publicUrl: string) {
  const url = `${publicUrl.replace(/\/+$/, '')}/mcp`
  return `Connect to my Fast Monkey and set it up with me.

Fast Monkey is a control MCP at ${url} (Streamable HTTP). Add it with no header, then I sign in to Fast Monkey in the browser when you ask.
- Claude Code: run  claude mcp add --transport http fastmonkey ${url}
- Codex, Cursor, VS Code, Windsurf, Gemini CLI, Zed: add it to your MCP config with that URL.

Then use its tools:
1. List my agents and connections so we both see what's there.
2. Ask what agent I want: what it does and which team data it needs.
3. Create it, write its instructions, and grant only the connections it needs.
4. Start it, then tell me what you set up and what I still do by hand.`
}
