import type { ComponentType } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Ask } from '@openhut/common/asks/ask.ts'

export type AskRow = ComponentType<{ agent: Agent; ask: Ask; compact: boolean }>
export type AskExtra = ComponentType<{ agent: Agent; ask: Ask }>

const found = import.meta.glob<{ rows?: Record<string, AskRow>; extras?: Record<string, AskExtra> }>('../*/asks.tsx', { eager: true })

export const custom: Record<string, AskRow | undefined> = Object.assign({}, ...Object.values(found).map((each) => each.rows))
export const extras: Record<string, AskExtra | undefined> = Object.assign({}, ...Object.values(found).map((each) => each.extras))
