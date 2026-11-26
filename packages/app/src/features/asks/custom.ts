import type { ComponentType } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Ask } from '@openhut/common/asks/ask.ts'

export type AskRow = ComponentType<{ agent: Agent; ask: Ask; compact: boolean }>

const found = import.meta.glob<{ rows: Record<string, AskRow> }>('../*/asks.tsx', { eager: true })

export const custom: Record<string, AskRow | undefined> = Object.assign({}, ...Object.values(found).map((each) => each.rows))
