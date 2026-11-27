import type { AutonomousAgent, ContentRef } from '../../core/agent.ts'
import { agentd, containerStates, forgetStates, liveBrowser, pairWhatsapp } from '../../server/platform/agentd.ts'
import { db } from '../../server/platform/db.ts'
import { chat } from './chat.ts'
import { pathOf, refOf, removable } from './content.ts'
import { emit, handlers } from './events.ts'
import { render } from './render.ts'

const souls = new Map<string, string>()

export const hermes = {
  async setup({ ctx, on, browser, running, restart = true }) {
    const files = render(ctx)
    const { change } = await agentd.apply({ id: ctx.agent.id, on, net: ctx.agent.net, files, browser, running, restart })
    forgetStates()
    const before = souls.get(ctx.agent.id)
    souls.set(ctx.agent.id, files['SOUL.md'])
    if (before !== undefined && before !== files['SOUL.md']) await written({ id: ctx.agent.id, ref: { kind: 'instructions', name: 'SOUL' }, by: 'person' })
    return change
  },

  async stop(id, { on } = {}) {
    await agentd.stop({ id, on })
    forgetStates()
  },

  async remove(id, { on, keep = false } = {}) {
    await agentd.remove({ id, on, trash: keep })
    souls.delete(id)
    forgetStates()
  },

  status: ({ on } = {}) => on ? agentd.ps({ on }).then((reply) => reply.states) : containerStates(),

  chat,

  content: {
    async list(id) {
      const { skills, bundled } = await agentd.skills({ id })
      return { items: skills.map(({ path, head }) => ({ name: path, head })), bundled }
    },
    read: (id, ref) => agentd.read({ id, path: pathOf(ref) }),
    async write({ id, ref, body, by, create, replace }) {
      const { path } = await agentd.write({ id, path: pathOf(ref), body, create, replace })
      const saved = refOf(path)
      await written({ id, ref: saved, by })
      return saved
    },
    async remove(id, refs) {
      const { removed } = await agentd.delete({ id, paths: refs.map(removable) })
      return removed.map(refOf)
    },
    async stat(id, refs) {
      const { files } = await agentd.stat({ id, paths: refs.map(pathOf) })
      return files.map(({ path, size }) => ({ ref: refOf(path), size }))
    },
  },

  activity: async (since) => ({ cost: (await agentd.usage({ since })).usage }),

  get on() {
    return handlers()
  },

  attach: ({ id, what, fps = 30, onLine, onEnd }) => what === 'browser' ? liveBrowser({ id, fps, onLine, onEnd }) : pairWhatsapp({ id, onLine, onEnd }),
} satisfies AutonomousAgent

async function written({ id, ref, by }: { id: string; ref: ContentRef; by: 'person' | 'agent' }): Promise<void> {
  if (!handlers()['content.written'].length) return
  const agent = await db.selectFrom('agent').select(['id', 'owner_id', 'net']).where('id', '=', id).executeTakeFirst()
  if (agent) await emit({ agent, event: 'content.written', payload: { ref, by } })
}
