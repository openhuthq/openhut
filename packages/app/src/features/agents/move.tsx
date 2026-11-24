import { useState } from 'react'
import type { OpenHutAgent } from '@/lib/openhut'
import { useMoveAgent } from '@/features/agents/api'
import { nameOf, useComputers } from '@/features/computers/api'

export function useMove(agent: OpenHutAgent | undefined) {
  const move = useMoveAgent()
  const computers = useComputers().data
  const [line, setLine] = useState('')
  const from = agent?.computer ?? 'local'
  const go = (to: string) => {
    if (!agent) return
    setLine('')
    move.mutate({ id: agent.id, to }, {
      onError: (error) => setLine(`${error.message} It's back on ${nameOf({ computers, id: from })}.`),
    })
  }
  const targets = (computers ?? []).filter((computer) => computer.online && computer.id !== from)
  const going = move.isPending ? nameOf({ computers, id: move.variables.to }) : undefined
  return { go, line, going, targets }
}
