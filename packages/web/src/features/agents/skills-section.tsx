import { useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { SKILL_MAX_LENGTH, type Skill } from '@openhut/common/agents/skill.ts'
import { BRAND_ICONS, type BrandName } from '@/components/brand-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CardButton } from '@/components/ui/card'
import { Dialog, DialogFoot, DialogFrame, DialogHead } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { ICONS, LEARNED_SKILL_ICON, skillIcon } from '@/components/icons'
import { Locked } from '@/components/locked'
import { Mark, Tile } from '@/components/mark'
import { SectionHead } from '@/components/section-head'
import { useDeleteSkill, useSkill, useSkills, useUpdateSkill } from '@/features/agents/api'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

type Filter = 'all' | 'learned' | 'builtIn'

const FILTERS: { filter: Filter; label: string }[] = [{ filter: 'all', label: 'All' }, { filter: 'learned', label: 'Learned' }, { filter: 'builtIn', label: 'Built in' }]
const FOLDED = 12

export function SkillsSection({ agent, lockReason, open }: { agent: Agent; lockReason: string | undefined; open: string | undefined }) {
  const skills = useSkills(agent.id)
  const [filter, setFilter] = useState<Filter>('learned')
  const [unfolded, setUnfolded] = useState(false)
  const all = skills.data ?? []
  const counts: Record<Filter, number> = { all: all.length, learned: all.filter((skill) => !skill.builtIn).length, builtIn: all.filter((skill) => skill.builtIn).length }
  const shown = all.filter((skill) => filter === 'all' || skill.builtIn === (filter === 'builtIn'))
  const pick = (next: Filter) => { setFilter(next); setUnfolded(false) }
  const filters = skills.data && <ToggleGroup variant="segmented" aria-label="Which skills" value={filter} onPick={(value) => pick(FILTERS.find((each) => each.filter === value)?.filter ?? filter)}>
    {FILTERS.map((each) => <ToggleGroupItem key={each.filter} value={each.filter}>{each.label}<span className="font-mono text-xs text-mute">{counts[each.filter]}</span></ToggleGroupItem>)}
  </ToggleGroup>
  return <section>
    <SectionHead title="Skills" action={filters} />
    <ErrorNote message={skills.error?.message} />
    {skills.data && !shown.length && <p className="m-0 text-mute">{filter === 'builtIn' ? `${agent.name} has no built-in skills.` : `${agent.name} hasn't learned a skill yet.`}</p>}
    {!!shown.length && <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-2">{(unfolded ? shown : shown.slice(0, FOLDED)).map((skill) => <SkillCard key={skill.id} agent={agent} skill={skill} />)}</div>}
    {shown.length > FOLDED && <div className="mt-3 flex justify-center">
      <Button type="button" size="sm" className="aria-expanded:[&_svg]:rotate-180" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>{unfolded ? 'Show fewer' : `Show all ${shown.length}`}{ICONS.chevd}</Button>
    </div>}
    {open && <SkillDialog key={open} agent={agent} skillId={`${agent.id}~${open}`} lockReason={lockReason} />}
  </section>
}

function SkillCard({ agent, skill }: { agent: Agent; skill: Skill }) {
  return <CardButton type="button" variant="tile" className="text-left" aria-haspopup="dialog" aria-label={`${agent.canEdit ? 'Edit' : 'View'} the ${skill.name} skill`} onClick={() => navigate(`/agents/${agent.id}/skills/${skill.id.slice(agent.id.length + 1)}`)}>
    <span className="flex items-center gap-3"><SkillMark skill={skill} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{skill.name}</span>{!skill.builtIn && <Badge variant="secondary">Learned</Badge>}</span>
    <span className="line-clamp-2 min-h-[3em] text-mute">{skill.description || skill.path}</span>
  </CardButton>
}

function SkillMark({ skill }: { skill: Skill }) {
  if (!skill.builtIn) return <Tile tone="ink" className="size-8">{LEARNED_SKILL_ICON}</Tile>
  const brand = skill.name.split('-')[0]
  if (isBrand(brand)) return <Mark name={brand} size={32} className="text-body" />
  return <Tile className="size-8 text-body">{skillIcon(skill.path.split('/').at(-2) ?? '')}</Tile>
}

function isBrand(name: string): name is BrandName {
  return Object.hasOwn(BRAND_ICONS, name)
}

function SkillDialog({ agent, skillId, lockReason }: { agent: Agent; skillId: string; lockReason: string | undefined }) {
  const skill = useSkill(skillId)
  const updateSkill = useUpdateSkill(skillId)
  const deleteSkill = useDeleteSkill({ skillId, agentId: agent.id })
  const close = () => navigate(`/agents/${agent.id}`)
  return <Dialog onClose={close}>
    <DialogFrame onSubmit={(event) => updateSkill.mutate(formValues(event)('body'), { onSuccess: close })}>
      <DialogHead title={skill.data ? `${agent.name}'s ${skill.data.name} skill` : `${agent.name}'s skill`} subtitle={skill.data?.description || skill.data?.path} onClose={close} />
      {skill.data
        ? <Textarea variant="editor" name="body" aria-label="Skill" maxLength={SKILL_MAX_LENGTH} required readOnly={!agent.canEdit} defaultValue={skill.data.body ?? ''} />
        : <Textarea variant="editor" aria-label="Skill" readOnly placeholder={skill.error ? '' : 'Opening…'} />}
      <DialogFoot error={skill.error?.message ?? updateSkill.error?.message}>
        {skill.data && !skill.data.builtIn && <Locked reason={lockReason}>
          <ConfirmButton disabled={!agent.canEdit || deleteSkill.isPending} question={`Delete the ${skill.data.name} skill?`} detail={`${agent.name} forgets it for good. This can't be undone.`} action="Delete"
            onConfirm={() => deleteSkill.mutate(undefined, { onSuccess: close, onError: toastError })}>{ICONS.trash}<span>Delete</span></ConfirmButton>
        </Locked>}
        <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
        <Locked reason={lockReason}><Button type="submit" variant="primary" disabled={!agent.canEdit || !skill.data || updateSkill.isPending}>Save</Button></Locked>
      </DialogFoot>
    </DialogFrame>
  </Dialog>
}
