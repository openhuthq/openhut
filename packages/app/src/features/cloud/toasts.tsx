import { useEffect, useRef, useState } from 'react'
import { Alert02Icon } from '@hugeicons/core-free-icons'
import { useQueryClient } from '@tanstack/react-query'
import type { Cloud } from '@openhut/common/cloud/cloud.ts'
import { agentPath } from '@/app/routes'
import { DeviceIcon } from '@/components/custom/device'
import { PersonFace } from '@/components/custom/person-face'
import { AMBER, notify, Tinted } from '@/components/custom/toast'
import { nameOf, useCloud, useRemoveMac } from '@/features/cloud/api'
import { chooseWorkspace } from '@/features/cloud/workspaces'
import { Mismatch } from '@/features/cloud/presence'
import { dismissGone, goneKey, goneNotice, knownDevices, newDevices, rememberDevices } from '@/features/cloud/seen'
import { navigate } from '@/lib/router'

export function CloudToasts() {
  const cloud = useCloud().data
  const queries = useQueryClient()
  const [landing, setLanding] = useState(false)
  const restoring = cloud?.backup.state === 'restoring'
  const agent = cloud?.backup.agent
  const problem = cloud?.backup.problem
  useEffect(() => {
    if (restoring) return setLanding(true)
    if (!landing) return
    setLanding(false)
    void queries.invalidateQueries()
    notify(problem ? { lead: <Tinted icon={Alert02Icon} hue={AMBER} />, title: 'Not everything came back', note: problem } : { title: 'Agents and chats restored' })
    navigate(agent ? agentPath({ agentId: agent }) : '/', true)
  }, [restoring, landing, agent, problem, queries])
  if (!cloud) return null
  return <><Mismatch /><GoneNotice cloud={cloud} /><Joins cloud={cloud} /><SelfJoins cloud={cloud} /></>
}

function Joins({ cloud }: { cloud: Cloud }) {
  const known = useRef<Map<string, string[]> | null>(null)
  useEffect(() => {
    const now = new Map(cloud.workspaces.map((workspace) => [workspace.id, workspace.members.map((member) => member.email)]))
    const before = known.current
    known.current = now
    if (!before) return
    for (const workspace of cloud.workspaces) {
      const was = before.get(workspace.id)
      for (const email of was ? workspace.members.map((member) => member.email).filter((each) => !was.includes(each) && each !== cloud.email) : []) notify({ lead: <PersonFace name={nameOf(email)} email={email} size={26} />, title: `${nameOf(email)} joined ${workspace.name}`, note: email })
    }
  }, [cloud.workspaces, cloud.email])
  return null
}

const OS_WAIT_MS = 20_000

function SelfJoins({ cloud }: { cloud: Cloud }) {
  const remove = useRemoveMac()
  useEffect(() => {
    if (cloud.status !== 'on') return
    const fresh = newDevices({ devices: cloud.devices, known: knownDevices() })
    const waiting = fresh.filter((device) => !device.os && Date.now() - Date.parse(device.addedAt ?? '') < OS_WAIT_MS)
    rememberDevices(cloud.devices.filter((device) => !waiting.includes(device)).map((device) => device.key))
    for (const device of fresh.filter((each) => !waiting.includes(each))) {
      const kind = device.os ?? (device.kind === 'server' ? 'Linux server' : 'Computer')
      notify({ lead: <DeviceIcon kind={device.kind} />, title: `${device.name ?? 'A new computer'} joined`, note: `${[kind, device.addedAt && askedAgo(device.addedAt)].filter(Boolean).join(' · ')}. Not you? Remove and lock it out.`, action: { label: 'Remove', onClick: () => remove.mutate({ key: device.key, lost: true }) } })
    }
  }, [cloud.devices, cloud.status, cloud.email, remove])
  return null
}

function GoneNotice({ cloud }: { cloud: Cloud }) {
  const seen = useRef(cloud.gone.length)
  useEffect(() => {
    const fresh = cloud.gone.slice(seen.current)
    seen.current = cloud.gone.length
    const last = fresh.at(-1)
    if (!last) return
    const home = cloud.workspaces.find((each) => each.home)
    if (home) chooseWorkspace(home.id)
    navigate('/', true)
    notify({ lead: <Tinted icon={Alert02Icon} hue={AMBER} />, ...goneNotice(last), onDismiss: () => dismissGone(goneKey(last)) })
  }, [cloud.gone, cloud.workspaces])
  return null
}

function askedAgo(at: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 1000))
  if (seconds < 60) return 'just now'
  return `${Math.round(seconds / 60)} min ago`
}
