import { closeSync, constants, existsSync, fstatSync, openSync, readdirSync, readlinkSync, readSync, realpathSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const SEGMENT = /^[A-Za-z0-9][\w.-]{0,63}$/
const SKILL_FILE = 'SKILL.md'
const MANIFEST = '.bundled_manifest'
const MAX_DEPTH = 3
const MAX_SKILLS = 300
const HEAD_BYTES = 4096
const MANIFEST_BYTES = 64_000
export const MAX_SKILL_BYTES = 400_000

type SkillHead = { path: string; head: string }

export function isSkillPath(value: unknown): value is string {
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

export function readInside({ root, file, limit }: { root: string; file: string; limit: number }): string | undefined {
  const fd = openInside({ root, file, flags: constants.O_RDONLY })
  if (fd === undefined) return undefined
  try {
    const buffer = Buffer.alloc(limit)
    return buffer.toString('utf8', 0, readSync(fd, buffer, 0, limit, 0))
  } finally {
    closeSync(fd)
  }
}

export function openInside({ root, file, flags }: { root: string; file: string; flags: number }): number | undefined {
  const fd = openQuietly(`${root}/${file}`, flags | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  if (fd === undefined) return undefined
  const stat = fstatSync(fd)
  if (stat.isFile() && stat.nlink === 1 && openedPath({ fd, path: `${root}/${file}`, ino: stat.ino }) === resolve(root, file)) return fd
  closeSync(fd)
  return undefined
}

function openedPath({ fd, path, ino }: { fd: number; path: string; ino: number }): string | undefined {
  if (existsSync('/proc/self/fd')) return readlinkSync(`/proc/self/fd/${fd}`)
  const real = realpathSync(path)
  return statSync(real).ino === ino ? real : undefined
}

function openQuietly(path: string, flags: number): number | undefined {
  try {
    return openSync(path, flags)
  } catch {
    return undefined
  }
}
