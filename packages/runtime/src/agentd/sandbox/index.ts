import { docker } from './docker.ts'
import { memory } from './memory.ts'
import type { Sandboxes } from './sandbox.ts'
import { config } from '../config.ts'

export const sandboxes: Sandboxes = config.fakeSandbox ? memory : docker
