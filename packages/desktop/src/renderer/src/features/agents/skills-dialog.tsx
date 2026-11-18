import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Cancel01Icon, Delete02Icon, Search01Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { SKILL_MAX_LENGTH, type Skill } from '@openhut/common/agents/skill.ts'
import { BRAND_ICONS, type BrandName } from '@/components/brand-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { skillIcon } from '@/components/icons'
import { DialogCard, I, SPLIT_DIALOG } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { useDeleteSkill, useSkill, useSkills, useUpdateSkill } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'learned' | 'builtIn'
type View = 'rendered' | 'source'

const FILTERS: [Filter, string][] = [['all', 'All'], ['learned', 'Learned'], ['builtIn', 'Built in']]
const VIEWS: [View, string][] = [['rendered', 'Rendered'], ['source', 'Source']]

export function SkillsDialog({ agent, open, onClose }: { agent: Agent; open: string | undefined; onClose: () => void }) {
  const skills = useSkills(agent.id)
  const [filter, setFilter] = useState<Filter>('learned')
  const [query, setQuery] = useState('')
  const all = skills.data ?? []
  const counts: Record<Filter, number> = { all: all.length, learned: all.filter((skill) => !skill.builtIn).length, builtIn: all.filter((skill) => skill.builtIn).length }
  const needle = query.trim().toLowerCase()
  const shown = all.filter((skill) => (filter === 'all' || skill.builtIn === (filter === 'builtIn')) && (!needle || `${skill.name} ${skill.description}`.toLowerCase().includes(needle)))
  const slug = (skill: Skill) => skill.id.slice(agent.id.length + 1)
  const selected = open ?? (shown[0] && slug(shown[0]))
  return <DialogCard onClose={onClose} className={cn(SPLIT_DIALOG, 'flex-row')}>
    <aside className="flex w-[300px] shrink-0 flex-col gap-3 border-r border-hair bg-sidebar p-4">
      <div className="flex items-center gap-2.5">
        <Face agent={agent} size={32} />
        <div className="grid min-w-0"><DialogTitle className="truncate text-[15px]/[20px] font-medium">{agent.name}'s skills</DialogTitle><span className="text-[12px] text-mute">{counts.learned} learned · {counts.builtIn} built in</span></div>
      </div>
      <label className="relative block"><span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-mute"><I icon={Search01Icon} size={14} /></span>
        <Input type="search" aria-label="Search skills" placeholder="Search skills" className="pl-8" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
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
        </Button>)}
        {skills.data && !shown.length && <p className="m-0 px-2 py-1 text-[13px] text-mute">{needle ? 'No skill matches.' : filter === 'builtIn' ? `${agent.name} has no built-in skills.` : `${agent.name} hasn't learned a skill yet.`}</p>}
      </nav>
    </aside>
    <section className="flex min-w-0 flex-1 flex-col">
      {selected
        ? <SkillDetail key={selected} agent={agent} skillId={`${agent.id}~${selected}`} onClose={onClose} />
        : <div className="flex flex-1 justify-end p-3"><CloseButton onClose={onClose} /></div>}
    </section>
  </DialogCard>
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
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

function withoutFrontmatter(body: string) {
  return body.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
}

function SkillDetail({ agent, skillId, onClose }: { agent: Agent; skillId: string; onClose: () => void }) {
  const skill = useSkill({ skillId, agentId: agent.id })
  const updateSkill = useUpdateSkill({ skillId, agentId: agent.id })
  const deleteSkill = useDeleteSkill({ skillId, agentId: agent.id })
  const [view, setView] = useState<View>('rendered')
  const [draft, setDraft] = useState<string | undefined>()
  const [confirm, setConfirm] = useState(false)
  const saved = skill.data?.body ?? ''
  const body = draft ?? saved
  const editable = !!skill.data && !skill.data.builtIn && agent.canEdit
  const changed = draft !== undefined && draft !== saved
  return <>
    <header className="flex items-start gap-3 px-5 pt-5 pb-3">
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex items-center gap-2"><h3 className="m-0 truncate text-[15px]/[22px] font-medium">{skill.data?.name ?? 'Skill'}</h3>{skill.data && !skill.data.builtIn && <Badge variant="secondary">Learned</Badge>}</div>
        {skill.data?.description && <p className="m-0 text-[13px]/[18px] text-body">{skill.data.description}</p>}
      </div>
      <ToggleGroup aria-label="View" value={view} onPick={(value) => setView(VIEWS.find(([id]) => id === value)?.[0] ?? view)}>
        {VIEWS.map(([id, label]) => <ToggleGroupItem key={id} value={id}>{label}</ToggleGroupItem>)}
      </ToggleGroup>
      <CloseButton onClose={onClose} />
    </header>
    {skill.data && <div className="flex items-center gap-2 border-y border-hair px-5 py-1.5 text-[12px] text-mute">
      <span className="min-w-0 truncate font-mono">{skill.data.path}</span>
      <CopyButton text={skill.data.path} label="Copy" variant="ghost" size="sm" />
      <span className="ml-auto font-mono">{body.length.toLocaleString('en')} / {SKILL_MAX_LENGTH.toLocaleString('en')} characters</span>
    </div>}
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-5 py-4">
      <ErrorNote message={skill.error?.message ?? updateSkill.error?.message} />
      {!skill.data && !skill.error && <p className="m-0 text-[13px] text-mute">Opening…</p>}
      {skill.data && (view === 'rendered'
        ? <div className="msg-t"><Markdown remarkPlugins={[remarkGfm]}>{withoutFrontmatter(body)}</Markdown></div>
        : <Textarea aria-label="Skill" maxLength={SKILL_MAX_LENGTH} readOnly={!editable} value={body} onChange={(event) => setDraft(event.target.value)}
          className="min-h-[340px] flex-1 resize-none rounded-lg bg-canvas font-mono text-[12.5px]/[1.7]" />)}
      {skill.data?.builtIn && <p className="m-0 mt-3 text-[12px]/[16px] text-mute">Built-in skills come with OpenHut and its connections. {agent.name} reads them but can't change them.</p>}
    </div>
    <footer className="flex items-center gap-2 border-t border-hair px-5 py-3">
      {editable && (confirm
        ? <><span className="text-[13px] text-mute">{agent.name} forgets it for good.</span>
          <Button type="button" variant="destructive" size="sm" disabled={deleteSkill.isPending} onClick={() => deleteSkill.mutate(undefined, { onSuccess: () => navigate(agentPath({ agentId: agent.id, dialog: 'skills' })), onError: toastError })}>Delete</Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setConfirm(false)}>Keep it</Button></>
        : <Button type="button" variant="danger" onClick={() => setConfirm(true)}><I icon={Delete02Icon} size={14} />Delete</Button>)}
      <span className="ml-auto flex gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        {editable && <Button type="button" variant="primary" disabled={!changed || updateSkill.isPending} onClick={() => updateSkill.mutate(body, { onSuccess: () => setDraft(undefined), onError: toastError })}>Save</Button>}
      </span>
    </footer>
  </>
}
