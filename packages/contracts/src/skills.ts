import { z } from 'zod';

/** Where a skill was found: the data folder's `skills/` (every agent) or the agent's `.orikami/skills/`. */
export const SkillScope = z.enum(['global', 'agent']);
export type SkillScope = z.infer<typeof SkillScope>;

/** A `SKILL.md` as its frontmatter names and describes it. An agent skill hides a global one of the same name. */
export const Skill = z.strictObject({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  scope: SkillScope,
  /** The folder holding the `SKILL.md`, under its scope's skills folder. */
  folder: z.string().min(1).max(255),
});
export type Skill = z.infer<typeof Skill>;

/** A skill folder that could not be used, and why, so the user can fix it. */
export const SkillProblem = z.strictObject({ scope: SkillScope, folder: z.string().min(1).max(255), reason: z.string().min(1) });
export type SkillProblem = z.infer<typeof SkillProblem>;

export const SkillList = z.strictObject({ skills: z.array(Skill), problems: z.array(SkillProblem) });
export type SkillList = z.infer<typeof SkillList>;
