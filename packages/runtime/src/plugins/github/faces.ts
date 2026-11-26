import { createHash } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod/mini'
import { isFacePng, SaveAgentFace, type AgentFace } from '@openhut/common/agents/face.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import { config } from '../../server/platform/config.ts'
import { db } from '../../server/platform/db.ts'
import { log } from '../../server/platform/events.ts'
import { HttpError, messageOf } from '../../server/platform/http-error.ts'
import { who, type Caller } from '../../server/team/identity.ts'

const Uploaded = z.object({ url: z.string() })

export const faceService = {
  async get({ actor, agentId }: { actor: Caller; agentId: string }): Promise<AgentFace> {
    await agentService.requireVisible({ actor, id: agentId })
    const row = await db.selectFrom('github_face').select('sha256').where('agent_id', '=', agentId).executeTakeFirst()
    return { object: 'agent_face', agentId, sha256: row?.sha256 ?? null }
  },

  async save({ actor, agentId, png }: { actor: Caller; agentId: string; png: string }): Promise<AgentFace> {
    await agentService.requireVisible({ actor, id: agentId })
    const bytes = Buffer.from(png, 'base64')
    if (!isFacePng(bytes)) throw new HttpError(400, 'Send a 64×64 PNG under 20 KB.', { param: 'png' })
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await db.insertInto('github_face').values({ agent_id: agentId, sha256, png, url: null })
      .onConflict((conflict) => conflict.column('agent_id').doUpdateSet({ sha256, png, url: null }).where('github_face.sha256', '!=', sha256)).execute()
    return { object: 'agent_face', agentId, sha256 }
  },

  async publicUrl({ agentId }: { agentId: string }): Promise<string | null> {
    const row = await db.selectFrom('github_face').selectAll().where('agent_id', '=', agentId).executeTakeFirst()
    if (!row) return null
    if (row.url) return row.url
    const url = await upload(row).catch((err: unknown) => {
      log.warn({ event: 'github.face_upload_failed', agent: agentId, error: messageOf(err) })
      return null
    })
    if (url) await db.updateTable('github_face').set({ url }).where('agent_id', '=', agentId).where('sha256', '=', row.sha256).execute()
    return url
  },
}

async function upload({ sha256, png }: { sha256: string; png: string }): Promise<string> {
  const res = await fetch(config.facesUrl, { method: 'POST', headers: { 'content-type': 'image/png' }, body: Buffer.from(png, 'base64'), signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`openhut.dev answered ${res.status}`)
  const { url } = z.parse(Uploaded, await res.json())
  if (!url.startsWith('https://') || !url.endsWith(`/a/${sha256}.png`)) throw new Error(`openhut.dev answered with an unexpected address ${url.slice(0, 100)}`)
  return url
}

export const faceController: FastifyPluginAsyncZod = async (app) => {
  app.get('/:agentId', GetRequest, async (req) => faceService.get({ actor: await who(req), agentId: req.params.agentId }))

  app.put('/:agentId', SaveRequest, async (req) => faceService.save({ actor: await who(req), agentId: req.params.agentId, png: req.body.png }))
}

const AgentParams = z.object({ agentId: z.string().check(z.maxLength(40)) })
const GetRequest = { schema: { params: AgentParams } }
const SaveRequest = { schema: { params: AgentParams, body: SaveAgentFace } }
