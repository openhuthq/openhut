import type { ConnectionKind } from '@fastmonkey/common/connections/connection.ts'
import type { SetupIcon } from '@/components/icons'

export type CatalogName = ConnectionKind | 'tailscale'
export type Integration = { name: CatalogName; title: string; blurb: string; gets: string[]; safe: string[]; short: string; chips: [SetupIcon, string][]; safeLine: string; warn?: string; eta: string }

const SIGNED_IN = (service: string) => [
  `Agents act as the person who signs in, with their ${service} access`,
  'Only you can use it until you share it, and only agents you grant it to',
  'Tokens are sealed on this server and refreshed for you',
]

export const SHELVES: { shelf: string; items: Integration[] }[] = [
  { shelf: 'Data', items: [
    {
      name: 'postgres', short: 'Read-only access to a database.', chips: [['table', 'See every table'], ['search', 'Run read-only queries']], safeLine: 'Read-only. Agents never see the connection string.', eta: '2 minutes', title: 'Postgres', blurb: 'Read-only access to a Postgres database.',
      gets: ['tables: every table and its columns', 'query: one read-only SELECT, 15 s and 1000 rows at most'],
      safe: ['Every query runs in a read-only transaction', 'Superusers and roles that can run programs are refused', 'Agents never see the connection string'],
    },
    {
      name: 'convex', short: 'Tables, functions and logs of one deployment.', chips: [['table', 'Read tables'], ['play', 'Run functions'], ['file', 'Read logs']], safeLine: 'The deploy key is sealed on this server.', warn: 'Running functions can change data. Grant it only to agents you trust with writes.', eta: '1 minute', title: 'Convex', blurb: 'Tables, data, functions and logs from one deployment, through its deploy key.',
      gets: ['tables: the schema and the shapes Convex inferred', 'data: pages of documents from a table', 'functions: every query, mutation and action', 'run: call one function with JSON arguments', 'logs: recent runs, console lines and errors'],
      safe: ['run can change data: grant it only to agents you trust with writes', 'The deploy key is sealed on this server and never shown again'],
    },
    {
      name: 'posthog', short: 'Insights, events and flags, with your sign-in.', chips: [['chart', 'Insights & funnels'], ['search', 'HogQL queries'], ['flag', 'Feature flags']], safeLine: 'Agents act as you. Only you can use it until you share it.', eta: 'One approval', title: 'PostHog', blurb: "Events, insights and feature flags through PostHog's own MCP, with your sign-in.",
      gets: ['Insights, trends and funnels', 'HogQL queries over your events', 'Feature flags and experiments', 'Error tracking issues', 'Whatever else PostHog adds to its MCP server'],
      safe: SIGNED_IN('PostHog'),
    },
  ] },
  { shelf: 'Work', items: [
    {
      name: 'linear', short: 'Issues and projects, as the person who connects.', chips: [['search', 'Search issues'], ['pencil', 'File & update'], ['doc', 'Read docs']], safeLine: 'Agents act as you. Only you can use it until you share it.', eta: 'One approval', title: 'Linear', blurb: "Search, read and file issues through Linear's MCP, as the person who connects.",
      gets: ['Search and read issues, projects and cycles', 'File issues, update them and comment', 'Read documents, teams and people'],
      safe: SIGNED_IN('Linear'),
    },
    {
      name: 'github', short: 'A bot of your own that reads code, commits and opens pull requests.', chips: [['file', 'Read code'], ['pencil', 'Commit as the bot'], ['flag', 'Issues & pull requests'], ['tools', 'git clone & push']], safeLine: 'The bot reaches only the repositories you install it on.', warn: 'Agents can push commits and open pull requests in the repositories you pick, and clone them into their sandbox.', eta: 'Two approvals', title: 'GitHub', blurb: 'A GitHub App of your own: agents commit and open pull requests as the bot, through GitHub’s MCP or plain git.',
      gets: ['Read files, commits and branches', 'Create branches, commit files and open pull requests, as the bot', 'Search code, read and file issues, review pull requests', 'git_credentials: clone, pull and push from the agent’s terminal with a token that lasts an hour', "Whatever else GitHub adds to its MCP server"],
      safe: ['The bot is a GitHub App you own: it reaches only the repositories you install it on', 'Its private key is sealed on this server: agents get one-hour tokens, never the key', 'Commits show as the bot, not as a person'],
    },
    {
      name: 'gmail', short: 'Search, label and draft, never send.', chips: [['search', 'Search threads'], ['tag', 'Label'], ['draft', 'Write drafts']], safeLine: 'No tool sends mail. Agents leave drafts for you.', eta: 'One approval', title: 'Gmail', blurb: "Search, read, label and draft through Google's Gmail MCP.",
      gets: ['search_threads, get_thread and get_message', 'Labels: list, create, apply and remove', 'Drafts: create and read', 'Trash and spam, never a permanent delete'],
      safe: ['No tool sends mail: agents leave drafts for you', ...SIGNED_IN('Google')],
    },
    {
      name: 'drive', short: 'Search, read and create files.', chips: [['search', 'Search files'], ['file', 'Read content'], ['plus', 'Create files']], safeLine: 'Agents can change only files they created.', eta: 'One approval', title: 'Google Drive', blurb: "Search, read and create files through Google's Drive MCP, as the person who connects.",
      gets: ['search_files and list_recent_files', 'read_file_content and download_file_content', 'create_file and copy_file', 'File metadata and permissions'],
      safe: ['Agents can only change files they created', ...SIGNED_IN('Google')],
    },
    {
      name: 'google', short: 'Docs, Sheets, Slides and Calendar.', chips: [['doc', 'Docs'], ['sheet', 'Sheets'], ['slides', 'Slides'], ['calendar', 'Calendar']], safeLine: 'Agents act as you. Only you can use it until you share it.', eta: 'One approval', title: 'Google Workspace', blurb: "Docs, Sheets, Slides and Calendar through Google's own MCP servers.",
      gets: ['Docs: read_doc and update_doc', 'Sheets: get_values, update_values and update_formulas', 'Slides: read_presentation and update_presentation', 'Calendar: list_events, suggest_time and create_event'],
      safe: SIGNED_IN('Google'),
    },
  ] },
  { shelf: 'Network', items: [
    {
      name: 'tailscale', short: 'Let connections reach private hosts.', chips: [['network', 'Reach 100.x hosts'], ['globe', 'MagicDNS names']], safeLine: 'Agents stay off the tailnet. The key is used once and not kept.', eta: '1 minute', title: 'Tailscale', blurb: 'Joins this server to your tailnet so Postgres can reach private hosts. Owners and admins.',
      gets: ['This server joins your tailnet as fastmonkey', 'Postgres, Convex and MCP connections can reach 100.x addresses and MagicDNS names', 'Agents stay off the tailnet: their firewall drops it'],
      safe: ['Only owners and admins can join or leave', 'The auth key is used once and never stored', 'A server already on a tailnet is left as it is'],
    },
  ] },
  { shelf: 'Any MCP', items: [
    {
      name: 'mcp', short: 'Any remote MCP server.', chips: [['tools', 'Every tool it lists']], safeLine: 'Calls leave from this server, never from agents.', eta: '1 minute', title: 'Custom MCP', blurb: 'Any remote MCP server: a URL plus a header or OAuth. Shared and granted like the rest.',
      gets: ['Every tool the server lists, named mcp_<tool>', 'Described to agents by the server itself'],
      safe: ['Calls leave from this server, never from the agents', 'Loopback, link-local and agent addresses are refused', 'Headers and tokens are sealed on this server'],
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
