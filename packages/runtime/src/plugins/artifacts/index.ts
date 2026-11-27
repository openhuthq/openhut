import * as z from 'zod'
import { ArtifactAccess } from '@openhut/common/artifacts.ts'
import { definePlugin, defineTool } from '../../core/plugin.ts'
import { publicAddress } from '../../server/platform/address.ts'
import { createTables } from './tables.ts'
import { artifactController, fileController, shareController } from './routes.ts'
import { artifactService, MAX_FILES } from './service.ts'

const ID = z.string().max(60).describe('The artifact\'s id, like art_k3m9x2.')
const EMAILS = z.array(z.email().max(200)).max(50)
const ACCESS = z.enum(ArtifactAccess.options)

const pageOf = ({ agentId, id }: { agentId: string; id: string }): string => `${publicAddress()}/agents/${agentId}/a/${id}`

export const artifacts = definePlugin({
  name: 'artifacts',
  migrate: createTables,
  routes: () => ({ '/api/artifacts': artifactController, '/api/share': shareController, '/a': fileController }),
  agent: () => ({ instructions: 'To show someone a page, chart, report, PDF, image or document, publish it with publish_artifact instead of pasting it into the chat. It opens beside the chat in OpenHut. To change one, read it with read_artifact, then publish it again with its id and ver.' }),
  afterTurn: async (input) => artifactService.card(input),
  tools: {
    publish_artifact: defineTool({
      description: `Publish a web page, PDF, image, Markdown note or other file that people open beside the chat. Send artifact to update one of yours: the files you send replace those paths and remove deletes paths. A new artifact needs an index.html (plus any assets it loads by relative path), or exactly one file, which is what opens. At most ${MAX_FILES} files and 10 MB. Only people who can use you can open it until someone asks you to share it. In the app chat it shows as a card, so don't paste its contents or link as well.`,
      input: {
        artifact: ID.optional().describe('Leave out to create a new artifact.'),
        title: z.string().trim().min(1).max(80).optional().describe('Plain words, like "Order sync failures". Defaults to the page\'s <title>.'),
        files: z.array(z.object({
          path: z.string().min(1).max(200).describe('Like index.html or assets/chart.js.'),
          text: z.string().optional().describe('The file as text, for HTML, CSS, JavaScript, Markdown, SVG or CSV.'),
          base64: z.string().optional().describe('The file as base64, for a PDF, image or other binary file.'),
        })).max(MAX_FILES),
        remove: z.array(z.string().max(200)).max(MAX_FILES).optional().describe('Paths to delete from an existing artifact.'),
        ver: z.number().int().optional().describe('The ver you last read. If it changed since, nothing is saved.'),
      },
      run: async (input, { agent }) => {
        const published = await artifactService.publish({ agentId: agent.id, createdBy: agent.owner_id, ...input })
        return `Published "${published.title}" (${published.id}, ver ${published.ver}, ${published.access}). It opens at ${pageOf({ agentId: agent.id, id: published.id })}.`
      },
    }),
    read_artifact: defineTool({
      description: 'Read one of your artifacts. Without path you get its title, ver, access and files; with path you get that file\'s text (up to 400 KB) to change and publish again.',
      input: { artifact: ID, path: z.string().max(200).optional() },
      run: (input, { agent }) => artifactService.read({ agentId: agent.id, ...input }),
    }),
    list_artifacts: defineTool({
      description: 'List your artifacts, newest change first: id, title, ver, access and when each changed.',
      input: {},
      run: async (_, { agent }) => {
        const list = await artifactService.listForAgent({ agentId: agent.id })
        return list.length ? list.map((item) => `${item.id} · ${item.title} · ver ${item.ver} · ${item.access} · changed ${item.updatedAt}`).join('\n') : 'You have no artifacts yet.'
      },
    }),
    share_artifact: defineTool({
      description: 'Use this only when someone in the chat asks you to share an artifact. Adds or removes people by email (they can view it) and sets who else can open it: private (only people who can use you), team (anyone on the team) or link (anyone with the link, no sign-in).',
      input: { artifact: ID, access: ACCESS.optional(), add: EMAILS.optional(), remove: EMAILS.optional() },
      run: async (input, { agent }) => {
        const row = await artifactService.shareAsAgent({ agentId: agent.id, ...input })
        const people = row.people.length ? ` Also shared with ${row.people.join(', ')}.` : ''
        if (row.access === 'link' && row.share_token) return `Anyone with this link can open it: ${publicAddress()}/share/${row.share_token}.${people}`
        return `${row.access === 'team' ? 'Anyone on the team' : 'Only people who can use you'} can open it.${people}`
      },
    }),
  },
})
