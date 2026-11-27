import * as z from 'zod/mini'

export const CallCard = z.object({
  title: z.string(),
  status: z.optional(z.string()),
  details: z.optional(z.string()),
  link: z.optional(z.string()),
  icon: z.optional(z.object({ path: z.string(), hex: z.string() })),
})
export type CallCard = z.infer<typeof CallCard>

const CallRow = z.object({ status: z.string(), details: z.string(), at: z.string(), seen: z.optional(z.number()) })
export type CallRow = z.infer<typeof CallRow>

const Call = z.object({
  webhookId: z.string(),
  label: z.optional(z.string()),
  card: z.optional(CallCard),
  calls: z.optional(z.array(CallRow)),
  seen: z.optional(z.number()),
})
export type Call = z.infer<typeof Call>

const Called = z.object({ call: Call })

export function callOf(metadata: unknown): Call | undefined {
  return z.safeParse(Called, metadata).data?.call
}

export function pretty(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2)
  } catch {
    return payload
  }
}

export function payloadOf(text: string): string {
  const gap = text.indexOf('\n\n')
  return gap < 0 ? text : text.slice(gap + 2)
}

export type Tone = 'green' | 'red' | 'amber' | 'grey'

const TONES: Record<string, Tone> = {
  success: 'green', completed: 'green', resolved: 'green', passed: 'green', recovered: 'green',
  failure: 'red', failed: 'red', error: 'red', alert: 'red', triggered: 'red', critical: 'red',
  in_progress: 'amber', queued: 'amber', pending: 'amber',
}

export function toneOf(status: string): Tone {
  return TONES[status.trim().toLowerCase().replace(/[\s-]+/g, '_')] ?? 'grey'
}

export function statusLabel(status: string): string {
  const words = status.trim().replace(/_/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function brandColor(hex: string): string | undefined {
  const clean = hex.replace(/^#/, '')
  return /^[0-9a-f]{6}$/i.test(clean) ? `#${clean.toLowerCase()}` : undefined
}

export function tileOf(color: string): string {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16) / 255)
  const light = 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
  return light < 0.15 ? '#f3f3f4' : `color-mix(in srgb, ${color} 10%, white)`
}

export function clockOf(at: string): string {
  return new Date(at).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false })
}
