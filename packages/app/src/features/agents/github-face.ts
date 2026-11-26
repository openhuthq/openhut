import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AgentFace, FACE_SIZE } from '@openhut/common/agents/face.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { slackIcon } from '@/features/agents/face'
import { request } from '@/lib/api-client'

export function useGitHubFace(agent: Agent) {
  const client = useQueryClient()
  const key = ['agent-face', agent.id]
  const saved = useQuery({ queryKey: key, queryFn: () => request({ schema: AgentFace, path: `/api/agent-faces/${agent.id}` }), staleTime: Infinity }).data
  useEffect(() => {
    if (!saved) return
    let gone = false
    void slackIcon(agent, FACE_SIZE).then(async (png) => {
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(atob(png), (char) => char.charCodeAt(0))))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      if (gone || sha === saved.sha256) return
      client.setQueryData(key, await request({ schema: AgentFace, path: `/api/agent-faces/${agent.id}`, method: 'PUT', body: { png } }))
    }).catch(() => undefined)
    return () => { gone = true }
  }, [saved?.sha256, agent.id, agent.face, agent.instructions])
}
