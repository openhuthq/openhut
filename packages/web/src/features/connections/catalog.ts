import type { ConnectionKind } from '@fastmonkey/common/connections/connection.ts'

export type CatalogName = ConnectionKind | 'tailscale'
export type Integration = { name: CatalogName; title: string; blurb: string; gets: string[]; safe: string[] }

const SIGNED_IN = (service: string) => [
  `Agents act as the person who signs in, with their ${service} access`,
  'Only you can use it until you share it, and only agents you grant it to',
  'Tokens are sealed on this server and refreshed for you',
]

export const SHELVES: { shelf: string; items: Integration[] }[] = [
  { shelf: 'Data', items: [
    {
      name: 'postgres', title: 'Postgres', blurb: 'Read-only access to a Postgres database.',
      gets: ['tables: every table and its columns', 'query: one read-only SELECT, 15 s and 1000 rows at most'],
      safe: ['Every query runs in a read-only transaction', 'Superusers and roles that can run programs are refused', 'Agents never see the connection string'],
    },
    {
      name: 'convex', title: 'Convex', blurb: 'Tables, data, functions and logs from one deployment, through its deploy key.',
      gets: ['tables: the schema and the shapes Convex inferred', 'data: pages of documents from a table', 'functions: every query, mutation and action', 'run: call one function with JSON arguments', 'logs: recent runs, console lines and errors'],
      safe: ['run can change data: grant it only to agents you trust with writes', 'The deploy key is sealed on this server and never shown again'],
    },
    {
      name: 'posthog', title: 'PostHog', blurb: "Events, insights and feature flags through PostHog's own MCP, with your sign-in.",
      gets: ['Insights, trends and funnels', 'HogQL queries over your events', 'Feature flags and experiments', 'Error tracking issues', 'Whatever else PostHog adds to its MCP server'],
      safe: SIGNED_IN('PostHog'),
    },
  ] },
  { shelf: 'Work', items: [
    {
      name: 'linear', title: 'Linear', blurb: "Search, read and file issues through Linear's MCP, as the person who connects.",
      gets: ['Search and read issues, projects and cycles', 'File issues, update them and comment', 'Read documents, teams and people'],
      safe: SIGNED_IN('Linear'),
    },
    {
      name: 'gmail', title: 'Gmail', blurb: "Search, read, label and draft through Google's Gmail MCP.",
      gets: ['search_threads, get_thread and get_message', 'Labels: list, create, apply and remove', 'Drafts: create and read', 'Trash and spam, never a permanent delete'],
      safe: ['No tool sends mail: agents leave drafts for you', ...SIGNED_IN('Google')],
    },
    {
      name: 'drive', title: 'Google Drive', blurb: "Search, read and create files through Google's Drive MCP, as the person who connects.",
      gets: ['search_files and list_recent_files', 'read_file_content and download_file_content', 'create_file and copy_file', 'File metadata and permissions'],
      safe: ['Agents can only change files Fast Monkey created', ...SIGNED_IN('Google')],
    },
    {
      name: 'google', title: 'Google Workspace', blurb: "Docs, Sheets, Slides and Calendar through Google's own MCP servers.",
      gets: ['Docs: read_doc and update_doc', 'Sheets: get_values, update_values and update_formulas', 'Slides: read_presentation and update_presentation', 'Calendar: list_events, suggest_time and create_event'],
      safe: SIGNED_IN('Google'),
    },
  ] },
  { shelf: 'Network', items: [
    {
      name: 'tailscale', title: 'Tailscale', blurb: 'Joins this server to your tailnet so Postgres can reach private hosts. Owners and admins.',
      gets: ['This server joins your tailnet as fastmonkey', 'Postgres, Convex and MCP connections can reach 100.x addresses and MagicDNS names', 'Agents stay off the tailnet: their firewall drops it'],
      safe: ['Only owners and admins can join or leave', 'The auth key is used once and never stored', 'A server already on a tailnet is left as it is'],
    },
  ] },
  { shelf: 'Any MCP', items: [
    {
      name: 'mcp', title: 'Custom MCP', blurb: 'Any remote MCP server: a URL plus a header or OAuth. Shared and granted like the rest.',
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
