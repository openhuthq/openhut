import * as z from 'zod/mini'

export const ArtifactAccess = z.enum(['private', 'team', 'link'])
export type ArtifactAccess = z.infer<typeof ArtifactAccess>

export const ArtifactKind = z.enum(['page', 'pdf', 'image', 'md', 'file'])
export type ArtifactKind = z.infer<typeof ArtifactKind>

export type ArtifactCard = { id: string; title: string; kind: ArtifactKind; access: ArtifactAccess; size: number }

export type Artifact = ArtifactCard & { agentId: string; entry: string; ver: number; createdBy: string; updatedAt: string }

export type ArtifactView = Artifact & { src: string; canManage: boolean; people: string[]; shareUrl?: string }

export type SharedArtifact = { id: string; title: string; kind: ArtifactKind; agentName: string; src: string }

export const UpdateArtifact = z.object({
  access: z.optional(ArtifactAccess),
  add: z.optional(z.array(z.email()).check(z.maxLength(50))),
  remove: z.optional(z.array(z.string()).check(z.maxLength(50))),
})
export type UpdateArtifact = z.infer<typeof UpdateArtifact>
