import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FACE_SIZE } from '@openhut/common/agents/face.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { slackIcon } from '@/components/agent-face'
import { agentFaceQuery, saveAgentFace } from '@/features/agents/api/agents'

export function useGitHubFace(agent: Agent) {
  const client = useQueryClient()
  const face = agentFaceQuery(agent.id)
  const saved = useQuery(face).data
  useEffect(() => {
    if (!saved) return
    let gone = false
    void slackIcon(agent, FACE_SIZE).then(async (png) => {
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(atob(png), (char) => char.charCodeAt(0))))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
      if (gone || sha === saved.sha256) return
      client.setQueryData(face.queryKey, await saveAgentFace({ agentId: agent.id, png }))
    }).catch(() => undefined)
    return () => { gone = true }
  }, [saved?.sha256, agent.id, agent.face, agent.instructions])
}
