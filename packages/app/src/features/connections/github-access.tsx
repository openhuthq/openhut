import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { List } from '@openhut/common/api.ts'
import { Connection, type Permission, type ProposedGroup, type ToolGroup } from '@openhut/common/connections/connection.ts'
import { GithubInstallation, type CreateGithubConnection } from '@openhut/common/connections/github-app.ts'
import { Button } from '@/components/ui/button'
import { Busy, SetupSheet } from '@/components/kit'
import { GroupIcon, PermissionPicker } from '@/features/connections/permissions'
import { Check } from '@/features/settings/kit'
import { Avatar, useGithubApp } from '@/features/settings/github-app'
import { copyText } from '@/lib/clipboard'
import { formError, request } from '@/lib/api-client'
import { toast } from '@/lib/toast'

const SHOWN = 5
const GROUPS: { group: ToolGroup; label: string; permission: Permission }[] = [
  { group: 'read', label: 'Read code', permission: 'allow' },
  { group: 'create', label: 'Open pull requests', permission: 'ask' },
  { group: 'update', label: 'Merge', permission: 'deny' },
]

export function useGithubInstallations() {
  return useQuery({ queryKey: ['github-installations'], queryFn: () => request({ schema: List(GithubInstallation), path: '/api/github-app/installations' }) })
}

export function GiveGitHubDialog({ agentName, onGive, onClose }: { agentName: string; onGive: (x: { connectionId: string; groups: ProposedGroup[] }) => Promise<unknown>; onClose: () => void }) {
  const app = useGithubApp().data?.app
  const installations = useGithubInstallations().data?.data
  const [account, setAccount] = useState<string>()
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [more, setMore] = useState(false)
  const [groups, setGroups] = useState(GROUPS)
  const give = useMutation({
    mutationFn: async (body: CreateGithubConnection) => {
      const connection = await request({ schema: Connection, path: '/api/github-app/connections', method: 'POST', body })
      await onGive({ connectionId: connection.id, groups: groups.map(({ group, label, permission }) => ({ group, label, permission })) })
    },
    onSuccess: onClose,
  })
  if (!app || !installations) return null
  const installation = installations.find((each) => each.account.login === account) ?? installations[0]
  if (!installation) return <InstallFirst agentName={agentName} installUrl={app.installUrl} onClose={onClose} />
  const shown = more ? installation.repositories : installation.repositories.slice(0, SHOWN)
  const toggle = (repo: string) => setPicked((now) => { const next = new Set(now); if (!next.delete(repo)) next.add(repo); return next })
  const org = installation.account.type === 'Organization'
  return <SetupSheet modal brand="github" title={`Give ${agentName} access to GitHub`} blurb={`${app.name} is installed on ${installation.account.login}. No sign-in needed.`} onClose={onClose}
    error={formError(give.error, ['repositories', 'installationId'])} safe={`${agentName} opens pull requests as ${app.slug}[bot].`}
    foot={<><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>{give.isPending ? <Busy label="Giving access…" /> : <Button type="button" variant="primary" disabled={!picked.size} onClick={() => give.mutate({ installationId: installation.installationId, repositories: [...picked] })}>Give access</Button>}</>}>
    {installations.length > 1 && <div className="flex flex-wrap gap-1.5">{installations.map((each) => <Button key={each.installationId} type="button" variant={each === installation ? 'secondary' : 'ghost'} size="sm" onClick={() => { setAccount(each.account.login); setPicked(new Set()); setMore(false) }}>
      <Avatar url={each.account.avatarUrl} name={each.account.login} org={each.account.type === 'Organization'} size={20} />{each.account.login}</Button>)}</div>}
    <div className="flex flex-col gap-1">
      <span className="flex items-center text-xs font-medium text-mute">Repositories<span className="ml-auto font-normal">{picked.size} of {installation.total}</span></span>
      <div className="-mx-2 flex flex-col">{shown.map((repo) => <Check key={repo} checked={picked.has(repo)} onChange={() => toggle(repo)}>
        <Avatar url={installation.account.avatarUrl} name={installation.account.login} org={org} size={20} /><span className="font-mono text-[12.5px] text-ink">{installation.account.login}/{repo}</span>
      </Check>)}</div>
      {!more && installation.repositories.length > SHOWN && <Button type="button" variant="text" className="w-fit text-[12.5px] font-normal text-mute" onClick={() => setMore(true)}>Show {installation.repositories.length - SHOWN} more</Button>}
    </div>
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-mute">{agentName} will be able to:</span>
      {groups.map((each) => <div key={each.group} className="flex h-9 items-center gap-2.5">
        <GroupIcon group={each.group} />
        <span className="flex-1 text-[13px] text-ink">{each.label}</span>
        <PermissionPicker value={each.permission} label={each.label} onPick={(permission) => setGroups(groups.map((one) => one === each ? { ...one, permission } : one))} />
      </div>)}
    </div>
  </SetupSheet>
}

function InstallFirst({ agentName, installUrl, onClose }: { agentName: string; installUrl: string; onClose: () => void }) {
  return <SetupSheet modal brand="github" title={`Give ${agentName} access to GitHub`} blurb="This server’s GitHub App isn’t installed anywhere yet. Install it on the account that has the repositories." onClose={onClose}
    safe="If you aren’t an owner there, GitHub sends the owner a request. Or copy the link and send it to them."
    foot={<><Button type="button" variant="secondary" onClick={() => void copyText(installUrl).then(() => toast('Link copied'))}>Copy link</Button><Button type="button" variant="primary" onClick={() => window.open(installUrl, '_blank', 'noreferrer')}>Install on GitHub</Button></>} />
}
