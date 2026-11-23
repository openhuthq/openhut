import { CONNECTION_TITLES, ConnectionKind } from '../connections/connection.ts'

export const OPEN_PAGE = 'https://openhut.dev/open'
export const MCP_AUTH = ['header', 'sign_in', 'public'] as const
export type McpAuth = typeof MCP_AUTH[number]
const BRANDED_HOSTS = ['cloudflare', 'digitalocean']
const ASKED = /^\/connections\/new\/([a-z_]+)\?([^#]*)$/

export type Ask = { agentId: string; app: ConnectionKind; url?: string; name?: string; auth?: McpAuth }

export function askPath({ agentId, app, url, name, auth }: Ask): string {
  return `/connections/new/${app}?${new URLSearchParams({ for: agentId, ...(url && { url }), ...(name && { name }), ...(auth && { auth }) })}`
}

export function askedPath(link: string): string | undefined {
  const hash = link.startsWith(`${OPEN_PAGE}#`) ? link.slice(OPEN_PAGE.length + 1) : undefined
  const [, kind, query] = (hash && ASKED.exec(hash)) || []
  return hash && ConnectionKind.safeParse(kind).success && !new URLSearchParams(query).has('error') ? hash : undefined
}

export function askCard({ app, url, name, auth, why, agentId }: Ask & { why: string }): string {
  const host = url ? new URL(url).hostname : undefined
  const brand = app === 'mcp' ? BRANDED_HOSTS.find((each) => host === `${each}.com` || host?.endsWith(`.${each}.com`)) ?? 'mcp' : app
  const link = `${OPEN_PAGE}#${askPath({ agentId, app, url, name, auth })}`
  const patch = [
    { op: 'add', path: '/root', value: 'ask' },
    { op: 'add', path: '/elements/ask', value: { type: 'Card', props: { title: name ?? CONNECTION_TITLES[app], brand, ...(host && { subtitle: host }) }, children: ['why', 'acts'] } },
    { op: 'add', path: '/elements/why', value: { type: 'Text', props: { content: why } } },
    { op: 'add', path: '/elements/acts', value: { type: 'Actions', props: {}, children: ['go'] } },
    { op: 'add', path: '/elements/go', value: { type: 'LinkButton', props: { label: 'Connect', url: link } } },
  ]
  return `\`\`\`spec\n${patch.map((line) => JSON.stringify(line)).join('\n')}\n\`\`\``
}

export const ASK_PROMPT = `
## Getting access

You decide what a job needs and how to set it up. When you need an app you can't reach yet, ask with ask_to_connect. Never ask for a password, key or token in chat.
`
