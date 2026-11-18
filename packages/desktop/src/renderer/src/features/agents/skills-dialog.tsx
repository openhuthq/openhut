import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowLeft01Icon, Cancel01Icon, Delete02Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { SKILL_MAX_LENGTH, type Skill } from '@openhut/common/agents/skill.ts'
import { BRAND_ICONS, type BrandName } from '@/components/brand-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip } from '@/components/ui/tooltip'
import { ConfirmIcon } from '@/components/confirm-button'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { skillIcon } from '@/components/icons'
import { DialogCard, I, Loading, SPLIT_DIALOG } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { useDeleteSkill, useSkill, useSkills, useUpdateSkill } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { readable } from '@/features/agents/skill-text'
import { PHONE, useMedia } from '@/lib/media'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'learned' | 'builtIn'
type View = 'rendered' | 'source'
type Drafts = Record<string, string>

const FILTERS: [Filter, string][] = [['all', 'All'], ['learned', 'Learned'], ['builtIn', 'Built in']]
const VIEWS: [View, string][] = [['rendered', 'Rendered'], ['source', 'Source']]
const PROSE = 'msg-t [&_:is(h1,h2,h3,h4)]:mt-5 [&_:is(h1,h2,h3,h4)]:mb-2 [&_:is(h1,h2,h3,h4)]:leading-snug [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_:is(h3,h4)]:text-[14px] [&_:is(h3,h4)]:font-semibold'

export function SkillsDialog({ agent, open, onClose }: { agent: Agent; open: string | undefined; onClose: () => void }) {
  const skills = useSkills(agent.id)
  const [filter, setFilter] = useState<Filter>('learned')
  const [drafts, setDrafts] = useState<Drafts>({})
  const all = skills.data ?? []
  const counts: Record<Filter, number> = { all: all.length, learned: all.filter((skill) => !skill.builtIn).length, builtIn: all.filter((skill) => skill.builtIn).length }
  const shown = all.filter((skill) => (filter === 'all' || skill.builtIn === (filter === 'builtIn')))
  const slug = (skill: Skill) => skill.id.slice(agent.id.length + 1)
  const phone = useMedia(PHONE)
  const selected = open ?? (phone ? undefined : shown[0] && slug(shown[0]))
  const toList = () => navigate(agentPath({ agentId: agent.id, dialog: 'skills' }))
  const setDraft = (skillId: string, body: string | undefined) => setDrafts(({ [skillId]: _, ...rest }) => body === undefined ? rest : { ...rest, [skillId]: body })
  return <DialogCard onClose={onClose} className={cn(SPLIT_DIALOG, 'flex-row')}>
    <aside className={cn('flex w-[300px] shrink-0 flex-col gap-3 border-r border-hair bg-sidebar p-4', phone && (selected ? 'hidden' : '!max-h-none flex-1 !border-b-0'))}>
      <div className="flex items-center gap-2.5">
        <Face agent={agent} size={32} />
        <div className="grid min-w-0 flex-1"><DialogTitle className="truncate text-[15px]/[20px] font-medium">{agent.name}'s skills</DialogTitle><span className="text-[12px] text-mute">{counts.learned} learned · {counts.builtIn} built in</span></div>
        {phone && <CloseButton onClose={onClose} />}
      </div>
      <ToggleGroup aria-label="Which skills" value={filter} onPick={(value) => setFilter(FILTERS.find(([id]) => id === value)?.[0] ?? filter)}>
        {FILTERS.map(([id, label]) => <ToggleGroupItem key={id} value={id}>{label}<span className="font-mono text-xs text-mute">{counts[id]}</span></ToggleGroupItem>)}
      </ToggleGroup>
      <ErrorNote message={skills.error?.message} />
      <nav aria-label="Skills" className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-1">
        {shown.map((skill) => <Button key={skill.id} type="button" variant="bare" aria-current={slug(skill) === selected || undefined}
          onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'skills', detail: slug(skill) }))}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-soft aria-[current]:bg-hair">
          <SkillMark skill={skill} />
          <span className="grid min-w-0 flex-1"><span className="truncate text-[13px] font-medium">{skill.name}</span><span className="truncate text-[12px] text-mute">{skill.description || skill.path}</span></span>
          {skill.id in drafts && <span className="size-1.5 shrink-0 rounded-full bg-ink" title="Unsaved changes" aria-label="Unsaved changes" />}
        </Button>)}
        {!skills.data && !skills.error && <Loading />}
        {skills.data && !shown.length && <p className="m-0 px-2 py-1 text-[13px] text-mute">{filter === 'builtIn' ? `${agent.name} has no built-in skills.` : `${agent.name} hasn't learned a skill yet.`}</p>}
      </nav>
    </aside>
    <section className={cn('flex min-w-0 flex-1 flex-col', phone && !selected && 'hidden')}>
      {selected
        ? <SkillDetail key={selected} agent={agent} skillId={`${agent.id}~${selected}`} draft={drafts[`${agent.id}~${selected}`]} setDraft={(body) => setDraft(`${agent.id}~${selected}`, body)} onClose={phone ? toList : onClose} back={phone} />
        : <div className="flex flex-1 justify-end p-3"><CloseButton onClose={onClose} /></div>}
    </section>
  </DialogCard>
}

function CloseButton({ onClose, back }: { onClose: () => void; back?: boolean }) {
  return <Button type="button" data-back={back || undefined} size="icon-sm" aria-label={back ? 'All skills' : 'Close'} title={back ? 'All skills' : 'Close'} tabIndex={-1} onClick={onClose}><I icon={back ? ArrowLeft01Icon : Cancel01Icon} size={15} /></Button>
}

function SkillMark({ skill }: { skill: Skill }) {
  if (!skill.builtIn) return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-white"><I icon={SparklesIcon} size={15} /></span>
  const brand = skill.name.split('-')[0]
  if (isBrand(brand)) return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card shadow-[inset_0_0_0_1px_var(--hair)]"><Glyph name={brand} size={16} /></span>
  return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-soft text-body">{skillIcon(skill.path.split('/').at(-2) ?? '')}</span>
}

function isBrand(name: string): name is BrandName {
  return Object.hasOwn(BRAND_ICONS, name)
}

function SkillDetail({ agent, skillId, draft, setDraft, onClose, back }: { agent: Agent; skillId: string; draft: string | undefined; setDraft: (body: string | undefined) => void; onClose: () => void; back: boolean }) {
  const skill = useSkill({ skillId, agentId: agent.id })
  const updateSkill = useUpdateSkill({ skillId, agentId: agent.id })
  const deleteSkill = useDeleteSkill({ skillId, agentId: agent.id })
  const [view, setView] = useState<View>(draft === undefined ? 'rendered' : 'source')
  const saved = skill.data?.body ?? ''
  const body = draft ?? saved
  const editable = !!skill.data && !skill.data.builtIn && agent.canEdit
  const changed = draft !== undefined && draft !== saved
  return <>
    <header className="grid gap-1 border-b border-hair px-5 pt-5 pb-4">
      <div className="flex items-center gap-2">
        {back && <CloseButton onClose={onClose} back />}
        <h3 className="m-0 min-w-0 truncate text-[15px]/[22px] font-medium">{skill.data?.name ?? 'Skill'}</h3>
        {skill.data?.builtIn && <Tooltip label={`Built-in skills come with OpenHut and its connections. ${agent.name} reads them but can't change them.`}><Badge variant="secondary">Built in · read-only</Badge></Tooltip>}
        <span className="ml-auto flex items-center gap-1">
          <ToggleGroup aria-label="View" value={view} onPick={(value) => setView(VIEWS.find(([id]) => id === value)?.[0] ?? view)}>
            {VIEWS.map(([id, label]) => <ToggleGroupItem key={id} value={id}>{label}</ToggleGroupItem>)}
          </ToggleGroup>
          {editable && <ConfirmIcon label="Delete skill" icon={Delete02Icon} danger question={`Delete ${skill.data?.name}? ${agent.name} forgets it for good.`} action="Delete" busy={deleteSkill.isPending}
            onConfirm={(done) => deleteSkill.mutate(undefined, { onSuccess: () => { done(); setDraft(undefined); navigate(agentPath({ agentId: agent.id, dialog: 'skills' })) }, onError: toastError })} />}
          {!back && <CloseButton onClose={onClose} />}
        </span>
      </div>
      {skill.data?.description && <p className="m-0 text-[13px]/[18px] text-body">{skill.data.description}</p>}
      {skill.data && skill.data.path !== skill.data.name && <p className="m-0 flex items-center gap-1 text-[12px] text-mute">{skill.data.path}<CopyButton text={skill.data.path} label="Copy" variant="ghost" size="xs" className="text-mute" /></p>}
    </header>
    <ErrorNote message={skill.error?.message ?? updateSkill.error?.message} />
    {!skill.data && !skill.error && <p className="m-0 p-5 text-[13px] text-mute">Opening…</p>}
    {skill.data && (view === 'rendered'
      ? <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{readable({ body, name: skill.data.name }).trim()
        ? <div className={PROSE}><Markdown remarkPlugins={[remarkGfm]}>{readable({ body, name: skill.data.name })}</Markdown></div>
        : <p className="m-0 text-[13px] text-mute">Nothing more than the description above.</p>}</div>
      : <Textarea variant="editor" aria-label="Skill" maxLength={SKILL_MAX_LENGTH} readOnly={!editable} value={body} onChange={(event) => setDraft(event.target.value === saved ? undefined : event.target.value)} className="text-[12.5px]/[1.7]" />)}
    {editable && (view === 'source' || changed) && <footer className="flex items-center gap-2 border-t border-hair px-5 py-3">
      <span className="text-[12px] text-mute">{body.length.toLocaleString('en')} / {SKILL_MAX_LENGTH.toLocaleString('en')} characters</span>
      <span className="ml-auto flex gap-2">
        {changed && <Button type="button" variant="secondary" onClick={() => setDraft(undefined)}>Discard</Button>}
        <Button type="button" variant="primary" disabled={!changed || updateSkill.isPending} onClick={() => updateSkill.mutate(body, { onSuccess: () => setDraft(undefined), onError: toastError })}>Save</Button>
      </span>
    </footer>}
  </>
}
