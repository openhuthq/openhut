import { ConnectionKind } from '../connections/connection.ts'

export const OPEN_PAGE = 'https://openhut.dev/open'
export const ASKABLE = ConnectionKind.options

const TITLES: Record<ConnectionKind, string> = {
  postgres: 'Postgres', convex: 'Convex', posthog: 'PostHog', linear: 'Linear', github: 'GitHub', gmail: 'Gmail', drive: 'Google Drive',
  google: 'Google Workspace', google_chat: 'Google Chat', google_contacts: 'Google Contacts', google_search: 'Google Search', excalidraw: 'Excalidraw', mcp: 'MCP server',
}
export const MCP_AUTH = ['header', 'sign_in', 'public'] as const
export type McpAuth = typeof MCP_AUTH[number]
const BRANDED_HOSTS = ['cloudflare', 'digitalocean']
const ASKED = /^\/connections\/new\/([a-z_]+)\?[^#]*$/

export type Ask = { agentId: string; app: ConnectionKind; url?: string; name?: string; auth?: McpAuth }

export function askPath({ agentId, app, url, name, auth }: Ask): string {
  return `/connections/new/${app}?${new URLSearchParams({ for: agentId, ...(url && { url }), ...(name && { name }), ...(auth && { auth }) })}`
}

export function askedPath(link: string): string | undefined {
  const hash = link.startsWith(`${OPEN_PAGE}#`) ? link.slice(OPEN_PAGE.length + 1) : undefined
  const kind = hash && ASKED.exec(hash)?.[1]
  return kind && ASKABLE.some((each) => each === kind) ? hash : undefined
}

export function askCard({ app, url, name, auth, why, agentId }: Ask & { why: string }): string {
  const host = url ? new URL(url).hostname : undefined
  const brand = app === 'mcp' ? BRANDED_HOSTS.find((each) => host?.endsWith(`${each}.com`)) ?? 'mcp' : app
  const link = `${OPEN_PAGE}#${askPath({ agentId, app, url, name, auth })}`
  const patch = [
    { op: 'add', path: '/root', value: 'ask' },
    { op: 'add', path: '/elements/ask', value: { type: 'Card', props: { title: name ?? TITLES[app], brand, ...(host && { subtitle: host }) }, children: ['why', 'acts'] } },
    { op: 'add', path: '/elements/why', value: { type: 'Text', props: { content: why } } },
    { op: 'add', path: '/elements/acts', value: { type: 'Actions', props: {}, children: ['go'] } },
    { op: 'add', path: '/elements/go', value: { type: 'LinkButton', props: { label: `Connect ${name ?? TITLES[app]}`, url: link } } },
  ]
  return `\`\`\`spec\n${patch.map((line) => JSON.stringify(line)).join('\n')}\n\`\`\``
}

export const ASK_PROMPT = `
## Getting access

You decide what you need for a job, and how to set it up. When you need an app you can't reach yet (a database, GitHub, an MCP server), call ask_to_connect, one app at a time, and put the card it gives you in your reply. The person connects it in OpenHut and tells you when it's done. Never ask for a password, key or token in chat.
`
