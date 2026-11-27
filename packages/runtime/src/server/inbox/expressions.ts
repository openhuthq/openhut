import ivm from 'isolated-vm'

const MEMORY_MB = 8
const TIMEOUT_MS = 50
const PAYLOAD_MAX = 256 * 1024
const RESULT_MAX = 4 * 1024

let shared: ivm.Isolate | undefined

export type Evaluated = { value?: unknown; error?: string }

export async function attempt({ source, payload }: { source: string; payload: unknown }): Promise<Evaluated> {
  const input = JSON.stringify(payload ?? null)
  if (input.length > PAYLOAD_MAX) return { error: 'The payload is over 256 KB, so functions don\'t run on it.' }
  if (!shared || shared.isDisposed) shared = new ivm.Isolate({ memoryLimit: MEMORY_MB })
  const context = await shared.createContext()
  try {
    await context.global.set('input', input)
    const output: unknown = await context.eval(`JSON.stringify((${source})(JSON.parse(input)))`, { timeout: TIMEOUT_MS })
    if (typeof output !== 'string') return {}
    if (output.length > RESULT_MAX) return { error: 'The result is over 4 KB.' }
    return { value: JSON.parse(output) }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  } finally {
    context.release()
  }
}

export async function evaluate(source: string, payload: unknown): Promise<unknown> {
  return (await attempt({ source, payload })).value
}
