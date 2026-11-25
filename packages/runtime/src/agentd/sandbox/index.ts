import { gvisor } from './gvisor.ts'
import { memory } from './memory.ts'
import type { Sandboxes } from './sandbox.ts'
import { config } from '../config.ts'

export async function sandboxes(): Promise<Sandboxes> {
  switch (config.sandbox) {
    case 'gvisor': return gvisor
    case 'memory': return memory
    case 'native': return (await import('./native.ts')).native
  }
}
