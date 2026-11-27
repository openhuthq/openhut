import * as z from 'zod/mini'
import type * as Contract from '@openhut/common/artifacts.ts'

export const ArtifactAccess: z.ZodMiniType<Contract.ArtifactAccess> = z.enum(['private', 'team', 'link'])
export type ArtifactAccess = Contract.ArtifactAccess
export const ArtifactKind: z.ZodMiniType<Contract.ArtifactKind> = z.enum(['page', 'pdf', 'image', 'md', 'file'])
export type ArtifactKind = Contract.ArtifactKind

const CARD = { id: z.string(), title: z.string(), kind: ArtifactKind, access: ArtifactAccess, size: z.number() }
export const ArtifactCard: z.ZodMiniType<Contract.ArtifactCard> = z.object(CARD)
export type ArtifactCard = Contract.ArtifactCard

export const ArtifactView: z.ZodMiniType<Contract.ArtifactView> = z.object({
  ...CARD,
  agentId: z.string(),
  entry: z.string(),
  ver: z.number(),
  createdBy: z.string(),
  updatedAt: z.string(),
  src: z.string(),
  canManage: z.boolean(),
  people: z.array(z.string()),
  shareUrl: z.optional(z.string()),
})
export type ArtifactView = Contract.ArtifactView

export const SharedArtifact: z.ZodMiniType<Contract.SharedArtifact> = z.object({ id: z.string(), title: z.string(), kind: ArtifactKind, agentName: z.string(), src: z.string() })
export type SharedArtifact = Contract.SharedArtifact

export const MIN_CHAT = 420
export const MIN_PANE = 360
export const DOCK_FROM = 820

export function paneWidth({ total, fraction }: { total: number; fraction: number }) {
  return Math.round(Math.min(total - MIN_CHAT, Math.max(MIN_PANE, total * fraction)))
}

export function sizeOf(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')} MB`
}

const KIND_WORD: Record<ArtifactKind, string> = { page: 'Page', pdf: 'PDF', image: 'Image', md: 'Notes', file: 'File' }
export const ACCESS_WORD: Record<ArtifactAccess, string> = { private: 'Private', team: 'Team', link: 'Anyone with link' }

export function metaOf(card: Pick<ArtifactCard, 'title' | 'kind' | 'access' | 'size'>) {
  if (card.kind !== 'file') return `${KIND_WORD[card.kind]} · ${ACCESS_WORD[card.access]}`
  const ext = /\.([a-z0-9]{1,8})$/i.exec(card.title)?.[1]
  return `${ext ? ext.toUpperCase() : KIND_WORD.file} · ${sizeOf(card.size)}`
}
