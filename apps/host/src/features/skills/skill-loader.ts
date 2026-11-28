import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Skill, SkillList, SkillProblem, SkillScope } from '@morrowbot/contracts';
import { parseFrontmatter } from './frontmatter.ts';

export const SKILL_FILE = 'SKILL.md';

/** Where an agent's own skills live inside its workspace. */
export const AGENT_SKILLS_DIR = path.join('.oribot', 'skills');

/** Only this much of a `SKILL.md` is read: the frontmatter is at the top. */
const HEAD_BYTES = 16 * 1024;

/** At most this many skill folders are read from each skills folder. */
const MAX_FOLDERS = 200;

/** A skill and the absolute path of its `SKILL.md`, which the agent reads when it uses the skill. */
export interface FoundSkill {
  readonly skill: Skill;
  readonly file: string;
}

export interface FoundSkills {
  readonly skills: readonly FoundSkill[];
  readonly problems: readonly SkillProblem[];
}

/** The skills of an agent: its workspace's, then the global ones it does not hide, each sorted by name. */
export async function findSkills(globalDir: string, workspaceDir: string): Promise<FoundSkills> {
  const [agent, global] = await Promise.all([scan('agent', path.join(workspaceDir, AGENT_SKILLS_DIR)), scan('global', globalDir)]);
  const names = new Set(agent.skills.map(({ skill }) => skill.name));
  return {
    skills: [...agent.skills, ...global.skills.filter(({ skill }) => !names.has(skill.name))],
    problems: [...agent.problems, ...global.problems],
  };
}

export function skillList(found: FoundSkills): SkillList {
  return { skills: found.skills.map(({ skill }) => skill), problems: [...found.problems] };
}

async function scan(scope: SkillScope, dir: string): Promise<FoundSkills> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return { skills: [], problems: [] };
  }
  const folders = entries
    .filter((entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_FOLDERS);
  const results = await Promise.all(folders.map((folder) => readSkill(scope, dir, folder)));
  const skills: FoundSkill[] = [];
  const problems: SkillProblem[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    switch (result.kind) {
      case 'skill':
        if (seen.has(result.found.skill.name)) {
          problems.push({ scope, folder: result.found.skill.folder, reason: `Another folder already has a skill named "${result.found.skill.name}".` });
        } else {
          seen.add(result.found.skill.name);
          skills.push(result.found);
        }
        break;
      case 'problem':
        problems.push(result.problem);
        break;
      case 'none':
        break;
    }
  }
  skills.sort((a, b) => a.skill.name.localeCompare(b.skill.name));
  return { skills, problems };
}

type Read = { readonly kind: 'skill'; readonly found: FoundSkill } | { readonly kind: 'problem'; readonly problem: SkillProblem } | { readonly kind: 'none' };

async function readSkill(scope: SkillScope, dir: string, folder: string): Promise<Read> {
  const file = path.join(dir, folder, SKILL_FILE);
  const problem = (reason: string): Read => ({ kind: 'problem', problem: { scope, folder: folder.slice(0, 255), reason } });
  let head: string;
  try {
    head = await readHead(file);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return { kind: 'none' };
    return problem('SKILL.md could not be read.');
  }
  const parsed = parseFrontmatter(head);
  if (parsed.kind === 'invalid') return problem(parsed.reason);
  const name = parsed.fields.get('name')?.trim() ?? '';
  const description = parsed.fields.get('description')?.trim() ?? '';
  if (name === '') return problem('The frontmatter has no name.');
  if (name.length > 64) return problem('The name is longer than 64 characters.');
  if (description === '') return problem('The frontmatter has no description.');
  if (description.length > 1024) return problem('The description is longer than 1024 characters.');
  return { kind: 'skill', found: { skill: { name, description, scope, folder: folder.slice(0, 255) }, file } };
}

/** The start of a regular file; a FIFO or device is refused without blocking. */
async function readHead(file: string): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!(await handle.stat()).isFile()) throw Object.assign(new Error('not a file'), { code: 'EISDIR' });
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}
