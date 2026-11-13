#!/usr/bin/env node
import { existsSync, rmSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { Admin } from '@jakebox/common/admin/admin.ts'
import { Agent, type Wanted } from '@jakebox/common/agents/agent.ts'
import { List } from '@jakebox/common/api.ts'
import { Invite, Me } from '@jakebox/common/team/team.ts'
import { api } from './api.ts'
import { CREDENTIALS_FILE, save, stored, type Credentials } from './credentials.ts'
import { signIn } from './oauth.ts'

const HELP = `Manage a JakeBox server from your terminal.

Usage: jakebox <command>

Commands:
  login <url>          Sign in to a JakeBox server through your browser
  status               Show the server's health, version and running agents, and who you are
  agents               List the agents with their status, model and owner
  agents start <name>  Start an agent
  agents stop <name>   Stop an agent
  invite [--admin]     Print a one-time invite link for a teammate, as a member or with --admin as an admin
  logout               Forget the sign-in on this computer

Options:
  -h, --help           Show this help`
const Agents = List(Agent)
const WANTED = { start: 'running', stop: 'stopped' } as const satisfies Record<string, Wanted>

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { admin: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } })
  const [command, ...rest] = positionals
  if (values.help || !command) return console.log(HELP)
  switch (command) {
    case 'login': return login(rest[0])
    case 'status': return status()
    case 'agents': return agents(rest)
    case 'invite': return invite(values.admin === true)
    case 'logout': return logout()
    default: throw new Error(`There's no jakebox ${command}. Run jakebox --help to see the commands.`)
  }
}

async function login(address: string | undefined): Promise<void> {
  const parsed = URL.parse(address ?? '')
  if (!parsed || !/^https?:$/.test(parsed.protocol)) throw new Error('Give the address of your JakeBox server, like jakebox login https://jakebox.example.com.')
  const credentials = await signIn(parsed.origin)
  save(credentials)
  const me = await api({ path: '/api/me', schema: Me })
  console.log(`Signed in to ${credentials.url} as ${me.user.username}.`)
}

async function status(): Promise<void> {
  const admin = await api({ path: '/api/admin', schema: Admin })
  const me = await api({ path: '/api/me', schema: Me })
  const health = admin.server.healthy ? 'healthy' : 'unhealthy, open Admin in the dashboard to see why'
  console.log(`Server  ${admin.publicUrl} · ${health} · version ${admin.server.version} (${admin.server.build})`)
  console.log(`Agents  ${admin.server.running} of ${admin.server.total} running`)
  console.log(`You     ${me.user.username} (${me.user.role})`)
}

async function agents([action, ...words]: string[]): Promise<void> {
  switch (action) {
    case undefined: return listAgents()
    case 'start':
    case 'stop': return setWanted(action, words.join(' '))
    default: throw new Error(`jakebox agents takes start <name> or stop <name>. Run jakebox --help to see how.`)
  }
}

async function listAgents(): Promise<void> {
  const { data } = await api({ path: '/api/agents', schema: Agents })
  if (!data.length) return console.log('No agents yet. Create one in the JakeBox dashboard.')
  const rows = [['NAME', 'STATUS', 'MODEL', 'OWNER'], ...data.map((agent) => [agent.name, agent.status, agent.model, agent.ownerName])]
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)) + 2)
  for (const row of rows) console.log(row.map((cell, column) => cell.padEnd(widths[column])).join('').trimEnd())
}

async function setWanted(action: keyof typeof WANTED, name: string): Promise<void> {
  if (!name) throw new Error(`Name the agent, like jakebox agents ${action} support-bot.`)
  const { data } = await api({ path: '/api/agents', schema: Agents })
  const matches = data.filter((agent) => agent.name === name || agent.id === name)
  if (!matches.length) throw new Error(`There's no agent named ${name}. Run jakebox agents to see their names.`)
  if (matches.length > 1) throw new Error(`${matches.length} agents are named ${name}. Pick one by id: ${matches.map((agent) => agent.id).join(', ')}.`)
  const agent = await api({ path: `/api/agents/${matches[0].id}`, schema: Agent, method: 'PATCH', body: { wanted: WANTED[action] } })
  console.log(`${agent.name} is ${agent.status}.`)
}

async function invite(asAdmin: boolean): Promise<void> {
  const created = await api({ path: '/api/invites', schema: Invite, method: 'POST', body: { role: asAdmin ? 'admin' : 'member' } })
  const expires = new Date(created.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  console.log(created.link)
  console.log(`Send this link to your teammate. It works once, joins them as ${created.role}, and expires ${expires}.`)
}

async function logout(): Promise<void> {
  if (!existsSync(CREDENTIALS_FILE)) return console.log('You\'re not signed in on this computer.')
  const credentials = stored()
  const revoked = credentials ? await revoke(credentials) : false
  rmSync(CREDENTIALS_FILE, { force: true })
  console.log(revoked ? 'Signed out: JakeBox disconnected this sign-in and this computer forgot it.' : 'Signed out on this computer. JakeBox couldn\'t disconnect this sign-in, so disconnect the app on Admin too.')
}

async function revoke({ url, refreshToken }: Credentials): Promise<boolean> {
  const res = await fetch(`${url}/api/oauth/revocations`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refreshToken }) })
    .catch(() => undefined)
  return res?.ok === true
}
