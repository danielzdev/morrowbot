import type { SkillList, SkillScope } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';
import type { Loadable } from '../../shared/store.ts';
import { Icon } from '../../shared/ui/Icon.tsx';

const SCOPE_LABEL: Readonly<Record<SkillScope, string>> = { agent: 'This agent', global: 'All agents' };

/**
 * Agent Settings › Skills: the `SKILL.md` files this agent can use, and the two folders they come
 * from. The agent gets each skill's name and description with every message and reads the file when one fits.
 */
export function SkillsSection(props: {
  readonly load: () => Promise<Loadable<SkillList>>;
  readonly redact: (text: string) => string;
  readonly onReveal: (scope: SkillScope) => void;
}) {
  const [skills, setSkills] = useState<Loadable<SkillList>>({ kind: 'loading' });
  const refresh = (): void => {
    setSkills({ kind: 'loading' });
    void props.load().then(setSkills);
  };
  useEffect(refresh, []);
  return (
    <div class="settings-section skills-section">
      <p class="binding-note">
        A skill is a folder with a SKILL.md whose frontmatter has a name and a description. Put this agent's skills in its workspace under
        .oribot/skills, and skills for every agent in the Ori Bot data folder's skills folder.
      </p>
      <div class="row">
        <button type="button" class="btn secondary" onClick={() => { props.onReveal('agent'); }}>Open agent skills folder</button>
        <button type="button" class="btn secondary" onClick={() => { props.onReveal('global'); }}>Open global skills folder</button>
        <button type="button" class="btn secondary" onClick={refresh}>Refresh</button>
      </div>
      {skills.kind === 'loading' && <p class="muted">Looking for skills…</p>}
      {skills.kind === 'failed' && <p class="note error">{props.redact(skills.message)}</p>}
      {skills.kind === 'loaded' && (
        <>
          {skills.value.skills.length === 0 ? (
            <p class="muted">No skills yet.</p>
          ) : (
            <ul class="skill-list" aria-label="Skills">
              {skills.value.skills.map((skill) => (
                <li key={`${skill.scope}/${skill.folder}`} class="skill-row">
                  <span class="skill-icon" aria-hidden="true"><Icon name="book" /></span>
                  <span class="skill-text">
                    <span class="skill-name">{props.redact(skill.name)}</span>
                    <span class="skill-description">{props.redact(skill.description)}</span>
                  </span>
                  <span class="skill-scope">{SCOPE_LABEL[skill.scope]}</span>
                </li>
              ))}
            </ul>
          )}
          {skills.value.problems.map((problem) => (
            <p key={`${problem.scope}/${problem.folder}`} class="note warn">
              {`${SCOPE_LABEL[problem.scope]} › ${props.redact(problem.folder)}: ${props.redact(problem.reason)}`}
            </p>
          ))}
        </>
      )}
    </div>
  );
}
