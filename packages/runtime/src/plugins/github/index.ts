import { definePlugin } from '../../core/plugin.ts'
import { connectionService } from '../../server/connections/connection-service.ts'
import { db } from '../../server/platform/db.ts'
import { log } from '../../server/platform/events.ts'
import { settings } from '../../server/platform/settings.ts'
import { messageOf } from '../../server/platform/http-error.ts'
import { faceController, faceService } from './faces.ts'
import { serverAppController } from './server-app.ts'
import { installWaits } from './waits.ts'
import { BODY_TOOLS, signed, signingOf, threadOf } from './sign.ts'
import { createTables } from './tables.ts'

export const github = definePlugin({
  name: 'github',
  migrate: createTables,
  routes: () => ({ '/api/agent-faces': faceController, '/api/github-app': serverAppController }),
  hermes: ({ agent, connections }) => ({ prompt: connections.some(({ kind }) => kind === 'github') ? trailerNote(agent.name) : '' }),
  connectorCall: async ({ agentId, kind, tool, args }) => {
    if (kind !== 'github' || !settings.githubFooter()) return args
    const signing = signingOf({ tool, args })
    if (signing === 'leave') return args
    if (signing === 'first_comment') {
      const first = await db.insertInto('github_thread').values({ agent_id: agentId, thread: threadOf(args) }).onConflict((conflict) => conflict.doNothing()).returning('thread').executeTakeFirst()
      if (!first) return args
    }
    const agent = await db.selectFrom('agent').select('name').where('id', '=', agentId).executeTakeFirst()
    if (!agent) return args
    return { ...args, body: signed({ body: typeof args.body === 'string' ? args.body : '', name: agent.name, face: await faceService.publicUrl({ agentId }) }) }
  },
  start: () => {
    void checkTools()
    installWaits.start()
  },
})

function trailerNote(name: string): string {
  return `## Git commits

End every commit you make with the trailer OpenHut-Agent: ${name}, so people can tell which agent wrote it: \`git commit --trailer "OpenHut-Agent: ${name}" -m "..."\`.`
}

async function checkTools(): Promise<void> {
  const found = await db.selectFrom('connection').select(['id', 'kind']).where('kind', '=', 'github').orderBy('created_at').executeTakeFirst()
  if (!found) return
  const names = await connectionService.toolsOf(found).then((tools) => tools.map((tool) => tool.name), (err: unknown) => {
    log.warn({ event: 'github.tools_unchecked', error: messageOf(err) })
    return undefined
  })
  const missing = names && BODY_TOOLS.filter((name) => !names.includes(name))
  if (missing?.length) log.warn({ event: 'github.body_tools_missing', missing, message: `GitHub's MCP server no longer has ${missing.join(', ')}, so agents' work there goes unsigned.` })
}
