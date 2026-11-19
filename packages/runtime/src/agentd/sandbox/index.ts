import { gvisor } from './gvisor.ts'
import { memory } from './memory.ts'
import type { Sandboxes } from './sandbox.ts'

export async function sandboxes(): Promise<Sandboxes> {
  const name = process.env.OPENHUT_SANDBOX || 'gvisor'
  switch (name) {
    case 'gvisor': return gvisor
    case 'memory': return memory
    case 'microsandbox': return (await import('./microsandbox.ts')).microsandbox
    case 'native': return (await import('./native.ts')).native
    default: throw new Error(`unknown OPENHUT_SANDBOX ${name}; use gvisor, native, microsandbox or memory`)
  }
}
