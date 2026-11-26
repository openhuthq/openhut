import type { Connection, ConnectionKind } from '@openhut/common/connections/connection.ts'
import type { BrandName } from '@/components/brand-icons'

export type CatalogName = ConnectionKind
export type Integration = { name: CatalogName; title: string; blurb: string; gets: string[]; safe: string[]; short: string; safeLine: string; warn?: string; eta: string }

const SIGNED_IN = (service: string) => [
  `Agents act as the person who signs in, with their ${service} access.`,
  'Only agents you pick can use it.',
  'Your sign-in is stored safely on this computer and refreshed for you.',
]

export const SHELVES: { shelf: string; items: Integration[] }[] = [
  { shelf: 'Data', items: [
    {
      name: 'postgres', short: 'Read-only database access', safeLine: 'Read-only. Agents never see the connection string.', eta: '2 minutes', title: 'Postgres', blurb: 'Read-only access to a Postgres database.',
      gets: ['tables: every table and its columns', 'query: one read-only SELECT, 15 s and 1000 rows at most', 'explain: a query\'s plan, without running it'],
      safe: ['Every query runs in a read-only transaction.', 'Superusers and roles that can run programs are refused.', 'Agents never see the connection string.'],
    },
    {
      name: 'convex', short: 'Tables, functions and logs', safeLine: 'The deploy key is stored safely on this computer.', warn: 'Running functions can change data. Let only agents you trust with writes use it.', eta: '1 minute', title: 'Convex', blurb: 'Convex’s official MCP server for one deployment, through its deploy key.',
      gets: ['tables and data: the schema and pages of documents', 'functionSpec and run: every function, and calling one', 'runOneoffQuery: a read-only query you write', 'logs: recent runs, console lines and errors', 'Whatever else Convex adds to its MCP server'],
      safe: ['run can change data: let only agents you trust with writes use it.', 'Environment-variable tools are off, so agents never see the deployment’s secrets.', 'The server runs on this computer; the deploy key is stored safely here and never shown again.'],
    },
    {
      name: 'posthog', short: 'Insights, events and flags', safeLine: 'Agents act as you.', eta: 'One approval', title: 'PostHog', blurb: 'Events, insights and feature flags, with your sign-in.',
      gets: ['Insights, trends and funnels', 'HogQL queries over your events', 'Feature flags and experiments', 'Error tracking issues', 'Whatever else PostHog adds to its MCP server'],
      safe: SIGNED_IN('PostHog'),
    },
  ] },
  { shelf: 'Work', items: [
    {
      name: 'linear', short: 'Issues and projects', safeLine: 'Agents act as you.', eta: 'One approval', title: 'Linear', blurb: 'Search, read and file issues as the person who connects.',
      gets: ['Search and read issues, projects and cycles', 'File issues, update them and comment', 'Read documents, teams and people'],
      safe: SIGNED_IN('Linear'),
    },
    {
      name: 'github', short: 'Code, commits and pull requests', safeLine: 'The bot reaches only the repositories you install it on.', warn: 'Agents can push commits and open pull requests in the repositories you pick, and clone them.', eta: 'Two approvals', title: 'GitHub', blurb: 'A GitHub App of your own: agents commit and open pull requests as the bot.',
      gets: ['Read files, commits and branches', 'Create branches, commit files and open pull requests, as the bot', 'Search code, read and file issues, review pull requests', 'git_credentials: clone, pull and push from the agent’s terminal, through OpenHut, which adds the key', "Whatever else GitHub adds to its MCP server"],
      safe: ['The bot is a GitHub App you own: it reaches only the repositories you install it on.', 'Agents never see its private key or a token: git goes through OpenHut, which adds it.', 'Commits show as the bot, not as a person.'],
    },
    {
      name: 'excalidraw', short: 'Diagrams shared as a link', safeLine: 'Drawings live on excalidraw.com. Anyone with the link can open them.', eta: 'One click', title: 'Excalidraw', blurb: 'Excalidraw’s official MCP server: agents draw a diagram and send a link that opens it. No account or key.',
      gets: ['read_me: how to draw a hand-drawn diagram', 'export_to_excalidraw: a link that opens it on excalidraw.com, where people can edit it'],
      safe: ['Anyone with the link can open the drawing, so leave secrets out.', 'There is no account or key to leak.'],
    },
    {
      name: 'gmail', short: 'Mail, labels and drafts', safeLine: 'No tool sends mail. Agents leave drafts for you.', eta: 'One approval', title: 'Gmail', blurb: 'Search, read, label and draft mail.',
      gets: ['search_threads, get_thread and get_message', 'Labels: list, create, apply and remove', 'Drafts: create and read', 'Trash and spam, never a permanent delete'],
      safe: ['No tool sends mail: agents leave drafts for you.', ...SIGNED_IN('Google')],
    },
    {
      name: 'drive', short: 'Files and folders', safeLine: 'Agents can change only files they created.', eta: 'One approval', title: 'Google Drive', blurb: 'Search, read and create files as the person who connects.',
      gets: ['search_files and list_recent_files', 'read_file_content and download_file_content', 'create_file and copy_file', 'File metadata and permissions'],
      safe: ['Agents can only change files they created.', ...SIGNED_IN('Google')],
    },
    {
      name: 'google', short: 'Docs, Sheets, Slides and Calendar', safeLine: 'Agents act as you.', eta: 'One approval', title: 'Google Workspace', blurb: 'Docs, Sheets, Slides and Calendar.',
      gets: ['Docs: read_doc and update_doc', 'Sheets: get_values, update_values and update_formulas', 'Slides: read_presentation and update_presentation', 'Calendar: list_events, suggest_time and create_event'],
      safe: SIGNED_IN('Google'),
    },
    {
      name: 'google_chat', short: 'Spaces and messages', safeLine: 'Agents act as you.', eta: 'One approval', title: 'Google Chat', blurb: 'Read spaces and messages and post as you.',
      gets: ['Search and read spaces, members and messages', 'Post messages as the person who connects'],
      safe: SIGNED_IN('Google'),
    },
    {
      name: 'google_contacts', short: 'Contacts and directory', safeLine: 'Read-only.', eta: 'One approval', title: 'Google Contacts', blurb: "Look people up in your contacts and your organization's directory.",
      gets: ['Search contacts and the directory', 'Read profiles: names, emails and phone numbers'],
      safe: ['Read-only: agents can’t add or change contacts.', ...SIGNED_IN('Google')],
    },
  ] },
  { shelf: 'Any MCP', items: [
    {
      name: 'mcp', short: 'Any remote MCP server', safeLine: 'Calls leave from this computer, never from agents.', eta: '1 minute', title: 'Custom MCP', blurb: 'Any remote MCP server: a URL plus a header or OAuth. Shared and granted like the rest.',
      gets: ['Every tool the server lists, named mcp_<tool>', 'Described to agents by the server itself'],
      safe: ['Calls leave from this computer, never from the agents.', 'Loopback, link-local and agent addresses are refused.', 'Headers and tokens are sealed on this server.'],
    },
  ] },
]

export const INTEGRATIONS = SHELVES.flatMap((shelf) => shelf.items)

export function integration(name: string): Integration | undefined {
  return INTEGRATIONS.find((each) => each.name === name)
}

export function titleOf(kind: CatalogName): string {
  return integration(kind)?.title ?? kind
}

export function uniqueName({ title, taken }: { title: string; taken: string[] }) {
  if (!taken.includes(title)) return title
  let n = 2
  while (taken.includes(`${title} ${n}`)) n += 1
  return `${title} ${n}`
}

export function connectedFirst({ items, kinds }: { items: Integration[]; kinds: string[] }): Integration[] {
  return [...items.filter((item) => kinds.includes(item.name)), ...items.filter((item) => !kinds.includes(item.name))]
}

export function chipMarks<T extends string>(kinds: T[]): { shown: T[]; more: number } {
  const unique = [...new Set(kinds)]
  return { shown: unique.slice(0, 3), more: Math.max(0, unique.length - 3) }
}

const BRANDED_HOSTS: BrandName[] = ['digitalocean', 'cloudflare']

export function connectionBrand(connection: Pick<Connection, 'kind' | 'account'>): BrandName {
  if (connection.kind !== 'mcp') return connection.kind
  const host = connection.account.split(' · ')[0] ?? ''
  return BRANDED_HOSTS.find((brand) => host === `${brand}.com` || host.endsWith(`.${brand}.com`)) ?? 'mcp'
}
