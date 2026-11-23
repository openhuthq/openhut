import * as z from 'zod/mini'

export const SKILL_MAX_LENGTH = 100_000

export const Skill = z.object({
  id: z.string(),
  object: z.literal('skill'),
  agentId: z.string(),
  path: z.string(),
  name: z.string(),
  description: z.string(),
  builtIn: z.boolean(),
  body: z.nullable(z.string()),
})
export type Skill = z.infer<typeof Skill>

export const ListSkills = z.object({ agentId: z.string().check(z.maxLength(40)) })
export type ListSkills = z.infer<typeof ListSkills>

export const UpdateSkill = z.object({ body: z.string().check(z.minLength(1), z.maxLength(SKILL_MAX_LENGTH)) })
export type UpdateSkill = z.infer<typeof UpdateSkill>

export const SkillRecord = z.object({ path: z.string().check(z.minLength(1), z.maxLength(200)), body: z.string().check(z.maxLength(SKILL_MAX_LENGTH)) })
export type SkillRecord = z.infer<typeof SkillRecord>
