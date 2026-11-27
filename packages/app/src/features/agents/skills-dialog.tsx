import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Delete02Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { SKILL_MAX_LENGTH, type Skill } from '@openhut/common/agents/skill.ts'
import { isBrand } from '@/components/brand-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ConfirmIcon } from '@/components/confirm-button'
import { CopyButton } from '@/components/copy-button'
import { EmptyScene } from '@/components/empty-art'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { skillIcon } from '@/components/icons'
import { I, Loading } from '@/components/kit'
import { useDeleteSkill, useSkill, useSkills, useUpdateSkill } from '@/features/agents/api'
import { readable } from '@/features/agents/skill-text'
import { toastError } from '@/lib/toast'

type View = 'rendered' | 'source'
type Drafts = Record<string, string>

const VIEWS: [View, string][] = [['rendered', 'Formatted'], ['source', 'Plain text']]
const PROSE = 'msg-t [&_:is(h1,h2,h3,h4)]:mt-5 [&_:is(h1,h2,h3,h4)]:mb-2 [&_:is(h1,h2,h3,h4)]:leading-snug [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_:is(h3,h4)]:text-[14px] [&_:is(h3,h4)]:font-semibold'

export type Crumb = { label: string; onBack: () => void }

export function SkillsBrowser({ agent, head }: { agent: Agent; head: (crumb?: Crumb) => ReactNode }) {
  const skills = useSkills(agent.id)
  const [picked, setPicked] = useState<Skill | undefined>()
  const [drafts, setDrafts] = useState<Drafts>({})
  const all = skills.data ?? []
  const setDraft = (skillId: string, body: string | undefined) => setDrafts(({ [skillId]: _, ...rest }) => body === undefined ? rest : { ...rest, [skillId]: body })
  if (picked) return <>
    {head({ label: picked.name, onBack: () => setPicked(undefined) })}
    <SkillDetail key={picked.id} agent={agent} skillId={picked.id} draft={drafts[picked.id]} setDraft={(body) => setDraft(picked.id, body)} onDeleted={() => setPicked(undefined)} />
  </>
  const groups: [string, Skill[]][] = [['Learned', all.filter((skill) => !skill.builtIn)], ['Built in', all.filter((skill) => skill.builtIn)]]
  return <>
    {head()}
    <div className="mb-1.5 flex min-h-[26px] items-center pr-8 text-[12px]/[16px] text-mute">{all.length === 1 ? '1 skill' : `${all.length} skills`}</div>
    <ErrorNote message={skills.error?.message} />
    {!skills.data && !skills.error && <Loading />}
    {skills.data && !all.length && <EmptyScene kind="skills" title="No skills yet" line={`Show ${agent.name} how to do something once, and it keeps the recipe.`} />}
    {all.length > 0 && <nav aria-label="Skills" className="no-scrollbar -ml-2.5 flex min-h-0 flex-1 flex-col overflow-y-auto pr-8 pb-2">
      {groups.filter(([, list]) => list.length).map(([label, list]) => <section key={label} className="flex flex-col not-first:mt-4">
        <h3 className="m-0 px-2.5 pb-1 text-[12px] font-medium text-mute">{label}</h3>
        {list.map((skill) => <Button key={skill.id} type="button" variant="bare" onClick={() => setPicked(skill)}
          className="flex h-[52px] w-full shrink-0 items-center gap-3 rounded-md px-2.5 text-left hover:bg-hover">
          <SkillMark skill={skill} />
          <span className="grid min-w-0 flex-1"><span className="truncate text-[13.5px] font-medium text-ink">{skill.name}</span><span className="truncate text-[12.5px] text-mute">{skill.description || skill.path}</span></span>
          {skill.id in drafts && <span className="size-1.5 shrink-0 rounded-full bg-ink" title="Unsaved changes" aria-label="Unsaved changes" />}
        </Button>)}
      </section>)}
    </nav>}
  </>
}

function SkillMark({ skill }: { skill: Skill }) {
  if (!skill.builtIn) return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-white"><I icon={SparklesIcon} size={15} /></span>
  const brand = skill.name.split('-')[0]
  if (isBrand(brand)) return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-card shadow-[inset_0_0_0_1px_var(--hair)]"><Glyph name={brand} size={16} /></span>
  return <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-soft text-body">{skillIcon(skill.path.split('/').at(-2) ?? '')}</span>
}

function SkillDetail({ agent, skillId, draft, setDraft, onDeleted }: { agent: Agent; skillId: string; draft: string | undefined; setDraft: (body: string | undefined) => void; onDeleted: () => void }) {
  const skill = useSkill({ skillId, agentId: agent.id })
  const updateSkill = useUpdateSkill({ skillId, agentId: agent.id })
  const deleteSkill = useDeleteSkill({ skillId, agentId: agent.id })
  const [view, setView] = useState<View>(draft === undefined ? 'rendered' : 'source')
  const saved = skill.data?.body ?? ''
  const body = draft ?? saved
  const editable = !!skill.data && !skill.data.builtIn && agent.canEdit
  const changed = draft !== undefined && draft !== saved
  return <div className="flex min-h-0 flex-1 flex-col pr-8">
    <div className="mb-3 flex min-h-[26px] items-center gap-2">
      <ToggleGroup aria-label="View" value={view} onPick={(value) => setView(VIEWS.find(([id]) => id === value)?.[0] ?? view)}>
        {VIEWS.map(([id, label]) => <ToggleGroupItem key={id} value={id}>{label}</ToggleGroupItem>)}
      </ToggleGroup>
      {skill.data?.builtIn && <Badge variant="secondary">Built in · read-only</Badge>}
      <span className="ml-auto flex items-center gap-1">
        {skill.data && skill.data.path !== skill.data.name && <CopyButton text={skill.data.path} label="Copy path" variant="ghost" size="xs" className="text-mute" />}
        {editable && <ConfirmIcon label="Delete skill" icon={Delete02Icon} danger question={`Delete ${skill.data?.name}?`} action="Delete" busy={deleteSkill.isPending}
          onConfirm={(done) => deleteSkill.mutate(undefined, { onSuccess: () => { done(); setDraft(undefined); onDeleted() }, onError: toastError })} />}
      </span>
    </div>
    <ErrorNote message={skill.error?.message ?? updateSkill.error?.message} />
    {!skill.data && !skill.error && <Loading />}
    {skill.data && (view === 'rendered'
      ? <div className="no-scrollbar min-h-0 flex-1 overflow-auto pb-4">
        {skill.data.description && <p className="m-0 mb-3 text-[13px]/[19px] text-body">{skill.data.description}</p>}
        {readable({ body, name: skill.data.name }).trim() && <div className={PROSE}><Markdown remarkPlugins={[remarkGfm]}>{readable({ body, name: skill.data.name })}</Markdown></div>}
      </div>
      : <Textarea variant="editor" aria-label="Skill" maxLength={SKILL_MAX_LENGTH} readOnly={!editable} value={body} onChange={(event) => setDraft(event.target.value === saved ? undefined : event.target.value)} className="min-h-0 flex-1 rounded-lg text-[12.5px]/[1.7]" />)}
    {editable && (view === 'source' || changed) && <div className="mt-3 flex items-center gap-2">
      <span className="text-[12px] text-mute">{body.length.toLocaleString('en')} / {SKILL_MAX_LENGTH.toLocaleString('en')} characters</span>
      <span className="ml-auto flex gap-2">
        {changed && <Button type="button" variant="secondary" onClick={() => setDraft(undefined)}>Discard</Button>}
        <Button type="button" variant="primary" disabled={!changed || updateSkill.isPending} onClick={() => updateSkill.mutate(body, { onSuccess: () => setDraft(undefined), onError: toastError })}>Save</Button>
      </span>
    </div>}
  </div>
}
