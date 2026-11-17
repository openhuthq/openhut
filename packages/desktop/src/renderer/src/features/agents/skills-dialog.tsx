import { useState } from 'react'
import { ArrowLeft01Icon, Delete02Icon, SparklesIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { SKILL_MAX_LENGTH, type Skill } from '@openhut/common/agents/skill.ts'
import { BRAND_ICONS, type BrandName } from '@/components/brand-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { skillIcon } from '@/components/icons'
import { Frame, I } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { useDeleteSkill, useSkill, useSkills, useUpdateSkill } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

type Filter = 'all' | 'learned' | 'builtIn'

const FILTERS: [Filter, string][] = [['all', 'All'], ['learned', 'Learned'], ['builtIn', 'Built in']]

export function SkillsDialog({ agent, open, onClose }: { agent: Agent; open: string | undefined; onClose: () => void }) {
  const skills = useSkills(agent.id)
  const [filter, setFilter] = useState<Filter>('learned')
  if (open) return <SkillDialog key={open} agent={agent} skillId={`${agent.id}~${open}`} onClose={onClose} />
  const all = skills.data ?? []
  const counts: Record<Filter, number> = { all: all.length, learned: all.filter((skill) => !skill.builtIn).length, builtIn: all.filter((skill) => skill.builtIn).length }
  const shown = all.filter((skill) => filter === 'all' || skill.builtIn === (filter === 'builtIn'))
  return <Frame face={<Face agent={agent} size={40} />} onClose={onClose} title={`${agent.name}'s skills`} subtitle={`What ${agent.name} knows how to do. It writes learned skills itself when it figures out a task you'll ask for again.`}>
    <ToggleGroup aria-label="Which skills" className="w-fit" value={filter} onPick={(value) => setFilter(FILTERS.find(([id]) => id === value)?.[0] ?? filter)}>
      {FILTERS.map(([id, label]) => <ToggleGroupItem key={id} value={id}>{label}<span className="font-mono text-xs text-mute">{counts[id]}</span></ToggleGroupItem>)}
    </ToggleGroup>
    <ErrorNote message={skills.error?.message} />
    {skills.data && !shown.length && <p className="m-0 text-[13px] text-mute">{filter === 'builtIn' ? `${agent.name} has no built-in skills.` : `${agent.name} hasn't learned a skill yet.`}</p>}
    <div className="grid grid-cols-2 gap-2">{shown.map((skill) => <Button key={skill.id} type="button" variant="bare" onClick={() => navigate(agentPath({ agentId: agent.id, dialog: 'skills', detail: skill.id.slice(agent.id.length + 1) }))}
      className="flex flex-col gap-2 rounded-lg border border-solid border-hair bg-card p-3 hover:border-mid">
      <span className="flex items-center gap-2.5"><SkillMark skill={skill} /><span className="min-w-0 flex-1 truncate text-[13px] font-medium">{skill.name}</span>{!skill.builtIn && <Badge variant="secondary">Learned</Badge>}</span>
      <span className="line-clamp-2 min-h-[3em] text-[12px]/[1.5] text-mute">{skill.description || skill.path}</span>
    </Button>)}</div>
  </Frame>
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

function SkillDialog({ agent, skillId, onClose }: { agent: Agent; skillId: string; onClose: () => void }) {
  const skill = useSkill({ skillId, agentId: agent.id })
  const updateSkill = useUpdateSkill({ skillId, agentId: agent.id })
  const deleteSkill = useDeleteSkill({ skillId, agentId: agent.id })
  const [confirm, setConfirm] = useState(false)
  const back = () => navigate(agentPath({ agentId: agent.id, dialog: 'skills' }))
  const learned = skill.data && !skill.data.builtIn && agent.canEdit
  return <Frame face={<Face agent={agent} size={40} />} onClose={onClose} title={skill.data?.name ?? 'Skill'} subtitle={skill.data?.description || skill.data?.path}
    action={<Button type="button" size="icon-sm" aria-label="Back" title="All skills" onClick={back}><I icon={ArrowLeft01Icon} size={15} /></Button>}
    foot={<>
      {learned && (confirm
        ? <><span className="text-[13px] text-mute">{agent.name} forgets it for good.</span><Button type="button" variant="destructive" size="sm" disabled={deleteSkill.isPending} onClick={() => deleteSkill.mutate(undefined, { onSuccess: back, onError: toastError })}>Delete</Button></>
        : <Button type="button" variant="danger" onClick={() => setConfirm(true)}><I icon={Delete02Icon} size={14} />Delete</Button>)}
      <span className="ml-auto flex gap-2"><Button type="button" variant="secondary" onClick={back}>Cancel</Button><Button type="submit" form="skill-body" variant="primary" disabled={!agent.canEdit || !skill.data || skill.data.builtIn || updateSkill.isPending}>Save</Button></span>
    </>}>
    <ErrorNote message={skill.error?.message ?? updateSkill.error?.message} />
    <form id="skill-body" className="flex flex-1" onSubmit={(event) => updateSkill.mutate(formValues(event)('body'), { onSuccess: back })}>
      <Textarea name="body" aria-label="Skill" maxLength={SKILL_MAX_LENGTH} required readOnly={!agent.canEdit || !skill.data || skill.data.builtIn} defaultValue={skill.data?.body ?? ''} key={skill.data ? 'loaded' : 'loading'} placeholder={skill.data ? '' : 'Opening…'}
        className="min-h-[340px] flex-1 resize-none rounded-lg bg-canvas font-mono text-[12.5px]/[1.7]" />
    </form>
    {skill.data?.builtIn && <p className="m-0 font-copy text-[11.5px] text-mute">Built-in skills come with OpenHut and its connections. {agent.name} reads them but can't change them.</p>}
  </Frame>
}
