import { fileInHome } from '@openhut/common/threads/thread.ts'

const BARE_PATH = /(?<=^|[\s(["'])(?:\/opt\/data\/home|~)\/[^\s"'`<>()[\]]*?\.[A-Za-z0-9]{1,10}(?=$|[\s)\]"',;:!?]|\.(?:\s|$))/g
const MAX_PATHS = 50

export const RASTER = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export type MdNode = { type: string; value?: string; url?: string; children?: MdNode[] }

export function homePathsIn(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(BARE_PATH), (match) => match[0]).filter((path) => fileInHome(path) !== undefined))].slice(0, MAX_PATHS)
}

export function linkHomeFiles(found: ReadonlySet<string>) {
  return () => (tree: MdNode) => visit({ node: tree, found })
}

function visit({ node, found }: { node: MdNode; found: ReadonlySet<string> }): void {
  if (!node.children || node.type === 'link' || node.type === 'linkReference') return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value) return linked({ text: child.value, found })
    visit({ node: child, found })
    return [child]
  })
}

function linked({ text, found }: { text: string; found: ReadonlySet<string> }): MdNode[] {
  const nodes: MdNode[] = []
  let at = 0
  for (const match of text.matchAll(BARE_PATH)) {
    if (!found.has(match[0])) continue
    if (match.index > at) nodes.push({ type: 'text', value: text.slice(at, match.index) })
    nodes.push({ type: 'link', url: match[0], children: [{ type: 'text', value: match[0] }] })
    at = match.index + match[0].length
  }
  if (at < text.length) nodes.push({ type: 'text', value: text.slice(at) })
  return nodes
}
