import * as z from 'zod/mini'

export const FACE_SIZE = 64
export const FACE_MAX_BYTES = 20_000
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function isFacePng(bytes: Uint8Array): boolean {
  if (bytes.length < 24 || bytes.length > FACE_MAX_BYTES || PNG.some((byte, index) => bytes[index] !== byte)) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR' && view.getUint32(16) === FACE_SIZE && view.getUint32(20) === FACE_SIZE
}

export const AgentFace = z.object({
  object: z.literal('agent_face'),
  agentId: z.string(),
  sha256: z.nullable(z.string()),
})
export type AgentFace = z.infer<typeof AgentFace>

export const SaveAgentFace = z.object({
  png: z.string().check(z.maxLength(Math.ceil(FACE_MAX_BYTES / 3) * 4), z.regex(/^[A-Za-z0-9+/]+=*$/, 'Send the picture as base64.')),
})
export type SaveAgentFace = z.infer<typeof SaveAgentFace>
