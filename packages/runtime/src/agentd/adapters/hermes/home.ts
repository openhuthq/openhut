import { closeSync, constants, ftruncateSync, readdirSync, writeSync } from 'node:fs'
import { config } from '../../config.ts'
import { openInside, readInside } from '../../home/safe-fs.ts'
import { isHomePath, isUploadName, readHomeFile, removeUploads, replaceUpload, saveNew, saveUpload, statHomeFiles } from '../../home/uploads.ts'
import { AGENT_OWNER, realHome } from '../../host.ts'

const MEMORY_FILES = new Set(['MEMORY.md', 'USER.md'])
const MAX_MEMORY_BYTES = 64_000
const SESSION = 'platforms/whatsapp/session'
const SEGMENT = /^[A-Za-z0-9][\w.-]{0,63}$/
const SKILL_FILE = 'SKILL.md'
const MANIFEST = '.bundled_manifest'
const MAX_DEPTH = 3
const MAX_SKILLS = 300
const HEAD_BYTES = 4096
const MANIFEST_BYTES = 64_000
const MAX_SKILL_BYTES = 400_000

export const agentHome = {
  kindOf(path: unknown): Kind | undefined {
    if (typeof path !== 'string') return undefined
    if (path === SESSION) return 'session'
    const [top, ...rest] = path.split('/')
    const inner = rest.join('/')
    if (top === 'memories') return MEMORY_FILES.has(inner) ? 'memory' : undefined
    if (top === 'skills') {
      if (inner.endsWith('/SKILL.md') && isSkillPath(inner.slice(0, -'/SKILL.md'.length))) return 'skill'
      return isSkillPath(inner) ? 'skill-folder' : undefined
    }
    if (top !== 'home' || !isHomePath(inner)) return undefined
    return rest.length === 2 && rest[0] === 'uploads' && isUploadName(rest[1]) ? 'upload' : 'file'
  },

  skills(id: string) {
    return listSkills(`${realHome(id)}/skills`)
  },

  read({ id, path }: { id: string; path: string }): Buffer | null {
    const root = realHome(id)
    switch (agentHome.kindOf(path)) {
      case 'skill': {
        const body = readInside({ root, file: path, limit: MAX_SKILL_BYTES + 1 })
        if (body !== undefined && Buffer.byteLength(body) > MAX_SKILL_BYTES) throw new Error('that skill is too large to open here')
        return body === undefined ? null : Buffer.from(body)
      }
      case 'memory': {
        const body = readInside({ root, file: path, limit: MAX_MEMORY_BYTES })
        return body === undefined ? null : Buffer.from(body)
      }
      case 'file':
      case 'upload':
        return readHomeFile({ home: `${root}/home`, path: inHome(path) }) ?? null
      default:
        throw new Error('that path can\'t be read')
    }
  },

  write({ id, path, body, create = false, replace = false }: { id: string; path: string; body: Buffer; create?: boolean; replace?: boolean }): string {
    const root = realHome(id)
    switch (agentHome.kindOf(path)) {
      case 'skill':
        if (!body.length || body.length > MAX_SKILL_BYTES) throw new Error('missing or oversized skill body')
        overwrite({ root, path, body, gone: 'that skill is gone' })
        return path
      case 'memory':
        if (body.length > MAX_MEMORY_BYTES) throw new Error('oversized memory')
        if (create && saveNew({ root, dir: 'memories', names: [path.slice('memories/'.length)], body, owner: AGENT_OWNER })) return path
        overwrite({ root, path, body, gone: 'the agent has not saved that memory yet' })
        return path
      case 'upload':
        if (replace) return `home/${replaceUpload({ home: `${root}/home`, name: path.split('/').at(-1) ?? '', body, owner: AGENT_OWNER, trash: `${config.data}/trash/${Date.now()}-${id}/home/uploads` })}`
        return `home/${saveUpload({ home: `${root}/home`, name: path.split('/').at(-1) ?? '', body, owner: AGENT_OWNER })}`
      default:
        throw new Error('that path can\'t be written')
    }
  },

  stat({ id, paths }: { id: string; paths: string[] }): { path: string; size: number }[] {
    return statHomeFiles({ home: `${realHome(id)}/home`, paths: paths.map(inHome) }).map((file) => ({ ...file, path: `home/${file.path}` }))
  },

  removeUploads({ id, paths }: { id: string; paths: string[] }): string[] {
    return removeUploads({ home: `${realHome(id)}/home`, names: paths.map((path) => path.split('/').at(-1) ?? '') }).map((name) => `home/uploads/${name}`)
  },
}

function inHome(path: string): string {
  return path.slice('home/'.length)
}

function overwrite({ root, path, body, gone }: { root: string; path: string; body: Buffer; gone: string }): void {
  const fd = openInside({ root, file: path, flags: constants.O_WRONLY })
  if (fd === undefined) throw new Error(gone)
  try {
    ftruncateSync(fd, 0)
    writeSync(fd, body, 0)
  } finally {
    closeSync(fd)
  }
}

type SkillHead = { path: string; head: string }

function isSkillPath(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const segments = value.split('/')
  return segments.length <= MAX_DEPTH && segments.every((segment) => SEGMENT.test(segment))
}

export function listSkills(root: string): { skills: SkillHead[]; bundled: string } {
  const skills: SkillHead[] = []
  walk({ root, dir: '', depth: 1, skills })
  return { skills, bundled: readInside({ root, file: MANIFEST, limit: MANIFEST_BYTES }) ?? '' }
}

function walk({ root, dir, depth, skills }: { root: string; dir: string; depth: number; skills: SkillHead[] }): void {
  for (const entry of entriesOf(`${root}/${dir}`)) {
    if (skills.length >= MAX_SKILLS) return
    if (!entry.isDirectory() || !SEGMENT.test(entry.name)) continue
    const path = dir ? `${dir}/${entry.name}` : entry.name
    const head = readInside({ root, file: `${path}/${SKILL_FILE}`, limit: HEAD_BYTES })
    if (head !== undefined) skills.push({ path, head })
    else if (depth < MAX_DEPTH) walk({ root, dir: path, depth: depth + 1, skills })
  }
}

function entriesOf(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  } catch {
    return []
  }
}

export type Kind = 'skill' | 'skill-folder' | 'memory' | 'file' | 'upload' | 'session'
