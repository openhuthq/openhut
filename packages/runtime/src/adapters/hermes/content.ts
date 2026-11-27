import type { ContentRef } from '../../core/agent.ts'
import { HttpError } from '../../server/platform/http-error.ts'

export function pathOf(ref: ContentRef): string {
  switch (ref.kind) {
    case 'memory': return `memories/${ref.name}.md`
    case 'skill': return `skills/${ref.name}/SKILL.md`
    case 'file': return `home/${ref.name}`
    case 'upload': return `home/uploads/${ref.name}`
    case 'session': return `platforms/${ref.name}/session`
    case 'instructions': throw new HttpError(400, 'Instructions change through the agent\'s settings.')
  }
}

export function removable(ref: ContentRef): string {
  return ref.kind === 'skill' ? `skills/${ref.name}` : pathOf(ref)
}

export function refOf(path: string): ContentRef {
  if (path.startsWith('home/')) return { kind: 'file', name: path.slice('home/'.length) }
  if (path.startsWith('memories/')) return { kind: 'memory', name: path.slice('memories/'.length, -'.md'.length) }
  if (path.startsWith('platforms/')) return { kind: 'session', name: path.split('/')[1] }
  return { kind: 'skill', name: path.slice('skills/'.length).replace(/\/SKILL\.md$/, '') }
}
