import * as z from 'zod'
import { HttpError } from '../server/platform/http-error.ts'
import type { Wake } from './plugin.ts'
import { plugins } from './plugins.ts'

const Report = z.object({ picked: z.literal(true).optional(), said: z.string().max(200_000).optional() })
const nudged: ((agentId: string) => void)[] = []

export const wakes = {
  async due({ agentId }: { agentId: string }): Promise<Wake[]> {
    const found = await Promise.all(plugins().map(async (plugin) => (await plugin.wakes?.due({ agentId }) ?? []).map((wake) => ({
      id: `${plugin.name}:${wake.id}`,
      text: `[OpenHut ${plugin.name}:${wake.id}] ${wake.text}`,
      origin: wake.origin,
    }))))
    return found.flat()
  },

  async report({ agentId, id, body }: { agentId: string; id: string; body: unknown }): Promise<{ object: 'wake'; id: string }> {
    const parsed = Report.safeParse(body)
    if (!parsed.success || (!parsed.data.picked && parsed.data.said === undefined)) throw new HttpError(400, 'Send picked: true, or said with the reply.')
    const [name, inner] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]
    const owner = plugins().find((plugin) => plugin.name === name)?.wakes
    if (!owner || !inner) throw new HttpError(404, `No wake ${id}.`)
    if (parsed.data.picked) await owner.picked({ agentId, id: inner })
    if (parsed.data.said !== undefined) await owner.said?.({ agentId, id: inner, reply: parsed.data.said })
    return { object: 'wake', id }
  },

  nudge(agentId: string): void {
    for (const listener of nudged) listener(agentId)
  },

  onNudge(listener: (agentId: string) => void): void {
    nudged.push(listener)
  },
}
