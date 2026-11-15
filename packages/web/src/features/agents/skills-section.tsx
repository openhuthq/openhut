import { useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { SKILL_MAX_LENGTH, type Skill } from '@openhut/common/agents/skill.ts'
import { BRAND_ICONS, type BrandName } from '@/components/brand-icons'
import { ConfirmButton } from '@/components/confirm-button'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { ErrorNote } from '@/components/error-note'
import { ICONS, LEARNED_SKILL_ICON, skillIcon } from '@/components/icons'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
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
  const filters = skills.data && <div className="segs" role="group" aria-label="Which skills">
    {FILTERS.map((each) => <button type="button" key={each.filter} className="seg" aria-pressed={filter === each.filter} onClick={() => pick(each.filter)}>{each.label}<span className="n">{counts[each.filter]}</span></button>)}
  </div>
  return <section>
    <SectionHead title="Skills" action={filters} />
    <ErrorNote message={skills.error?.message} />
    {skills.data && !shown.length && <p className="note">{filter === 'builtIn' ? `${agent.name} has no built-in skills.` : `${agent.name} hasn't learned a skill yet.`}</p>}
    {!!shown.length && <div className="grid">{(unfolded ? shown : shown.slice(0, FOLDED)).map((skill) => <SkillCard key={skill.id} agent={agent} skill={skill} />)}</div>}
    {shown.length > FOLDED && <div className="skill-more">
      <button type="button" className="btn sm" aria-expanded={unfolded} onClick={() => setUnfolded(!unfolded)}>{unfolded ? 'Show fewer' : `Show all ${shown.length}`}{ICONS.chevd}</button>
    </div>}
    {open && <SkillDialog key={open} agent={agent} skillId={`${agent.id}~${open}`} lockReason={lockReason} />}
  </section>
}

function SkillCard({ agent, skill }: { agent: Agent; skill: Skill }) {
  return <button type="button" className="card skill" aria-haspopup="dialog" aria-label={`${agent.canEdit ? 'Edit' : 'View'} the ${skill.name} skill`} onClick={() => navigate(`/agents/${agent.id}/skills/${skill.id.slice(agent.id.length + 1)}`)}>
    <span className="top"><SkillMark skill={skill} /><span className="who name ellip">{skill.name}</span>{!skill.builtIn && <span className="status secondary">Learned</span>}</span>
    <span className="role">{skill.description || skill.path}</span>
  </button>
}

function SkillMark({ skill }: { skill: Skill }) {
  if (!skill.builtIn) return <span className="mark learned">{LEARNED_SKILL_ICON}</span>
  const brand = skill.name.split('-')[0]
  if (isBrand(brand)) return <Mark name={brand} size={32} />
  return <span className="mark">{skillIcon(skill.path.split('/').at(-2) ?? '')}</span>
}

function isBrand(name: string): name is BrandName {
  return Object.hasOwn(BRAND_ICONS, name)
}

function SkillDialog({ agent, skillId, lockReason }: { agent: Agent; skillId: string; lockReason: string | undefined }) {
  const skill = useSkill(skillId)
  const updateSkill = useUpdateSkill(skillId)
  const deleteSkill = useDeleteSkill({ skillId, agentId: agent.id })
  return <Dialog labelledBy="skill-h" onClosed={() => navigate(`/agents/${agent.id}`)}>{(close) =>
    <form className="dlgform" onSubmit={(event) => updateSkill.mutate(formValues(event)('body'), { onSuccess: close })}>
      <DialogHead id="skill-h" title={skill.data ? `${agent.name}'s ${skill.data.name} skill` : `${agent.name}'s skill`} subtitle={skill.data?.description || skill.data?.path} onClose={close} />
      {skill.data
        ? <textarea name="body" aria-label="Skill" maxLength={SKILL_MAX_LENGTH} required readOnly={!agent.canEdit} defaultValue={skill.data.body ?? ''} />
        : <textarea aria-label="Skill" readOnly placeholder={skill.error ? '' : 'Opening…'} />}
      <DialogFoot error={skill.error?.message ?? updateSkill.error?.message}>
        {skill.data && !skill.data.builtIn && <Locked reason={lockReason}>
          <ConfirmButton className="btn danger" disabled={!agent.canEdit || deleteSkill.isPending} question={`Delete the ${skill.data.name} skill?`} detail={`${agent.name} forgets it for good. This can't be undone.`} action="Delete"
            onConfirm={() => deleteSkill.mutate(undefined, { onSuccess: close, onError: toastError })}>{ICONS.trash}<span className="lbl">Delete</span></ConfirmButton>
        </Locked>}
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <Locked reason={lockReason}><button className="btn primary" disabled={!agent.canEdit || !skill.data || updateSkill.isPending}>Save</button></Locked>
      </DialogFoot>
    </form>}
  </Dialog>
}
