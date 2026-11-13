import type { Agent } from '@fastmonkey/common/agents/agent.ts'
import { SKILL_MAX_LENGTH, type Skill } from '@fastmonkey/common/agents/skill.ts'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { ErrorNote } from '@/components/error-note'
import { Locked } from '@/components/locked'
import { SectionHead } from '@/components/section-head'
import { useSkill, useSkills, useUpdateSkill } from '@/features/agents/api'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'

export function SkillsSection({ agent, lockReason, open }: { agent: Agent; lockReason: string | undefined; open: string | undefined }) {
  const skills = useSkills(agent.id)
  const learned = skills.data?.filter((skill) => !skill.builtIn) ?? []
  const builtIn = skills.data?.filter((skill) => skill.builtIn) ?? []
  return <section>
    <SectionHead title="Skills" />
    <ErrorNote message={skills.error?.message} />
    {skills.data && <div className="box rows">
      {learned.map((skill) => <SkillRow key={skill.id} agent={agent} skill={skill} />)}
      {!learned.length && <div className="row"><div className="t mute">{agent.name} hasn't learned a skill yet.</div></div>}
      {!!builtIn.length && <details className="skills-more">
        <summary>{builtIn.length} built in</summary>
        {builtIn.map((skill) => <SkillRow key={skill.id} agent={agent} skill={skill} />)}
      </details>}
    </div>}
    {open && <SkillDialog key={open} agent={agent} skillId={`${agent.id}~${open}`} lockReason={lockReason} />}
  </section>
}

function SkillRow({ agent, skill }: { agent: Agent; skill: Skill }) {
  return <div className="row">
    <div className="t"><div className="ellip">{skill.name}</div><div className="mute ellip">{skill.description || skill.path}</div></div>
    <button type="button" className="btn sec sm" aria-haspopup="dialog" aria-label={`${agent.canEdit ? 'Edit' : 'View'} the ${skill.name} skill`} onClick={() => navigate(`/agents/${agent.id}/skills/${skill.id.slice(agent.id.length + 1)}`)}>{agent.canEdit ? 'Edit' : 'View'}</button>
  </div>
}

function SkillDialog({ agent, skillId, lockReason }: { agent: Agent; skillId: string; lockReason: string | undefined }) {
  const skill = useSkill(skillId)
  const updateSkill = useUpdateSkill(skillId)
  return <Dialog labelledBy="skill-h" onClosed={() => navigate(`/agents/${agent.id}`)}>{(close) =>
    <form className="dlgform" onSubmit={(event) => updateSkill.mutate(formValues(event)('body'), { onSuccess: close })}>
      <DialogHead id="skill-h" title={skill.data ? `${agent.name}'s ${skill.data.name} skill` : `${agent.name}'s skill`} subtitle={skill.data?.description || skill.data?.path} onClose={close} />
      {skill.data
        ? <textarea name="body" aria-label="Skill" maxLength={SKILL_MAX_LENGTH} required readOnly={!agent.canEdit} defaultValue={skill.data.body ?? ''} />
        : <textarea aria-label="Skill" readOnly placeholder={skill.error ? '' : 'Opening…'} />}
      <DialogFoot error={skill.error?.message ?? updateSkill.error?.message}>
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <Locked reason={lockReason}><button className="btn primary" disabled={!agent.canEdit || !skill.data || updateSkill.isPending}>Save</button></Locked>
      </DialogFoot>
    </form>}
  </Dialog>
}
