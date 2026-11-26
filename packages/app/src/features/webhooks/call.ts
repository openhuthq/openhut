import * as z from 'zod/mini'

const Called = z.object({ call: z.object({ webhookId: z.string(), label: z.optional(z.string()) }) })

export function callOf(metadata: unknown): { webhookId: string; label?: string } | undefined {
  return z.safeParse(Called, metadata).data?.call
}

export function payloadOf(text: string): string {
  const gap = text.indexOf('\n\n')
  return gap < 0 ? text : text.slice(gap + 2)
}
