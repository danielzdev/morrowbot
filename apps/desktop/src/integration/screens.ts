import type { Message } from '@morrowbot/contracts';
import { outcomeCopy, pendingApprovals, sessionChoiceCopy, bannerCopy, type ThreadScreen, type ThreadSession, type ThreadView } from '../renderer/features/chat/index.ts';
import { until } from '../renderer/shared/store.ts';

const hidePid = (text: string): string => text.replaceAll(/from pid \d+/g, 'from pid <pid>');
const COPY = { provider: null, safe: (text: string) => text };

function line(message: Message): string {
  if (message.kind === 'user') return `user: ${message.text}`;
  const note = outcomeCopy(message.outcome, COPY);
  const label = note.text === null ? '' : ` [${note.text}]`;
  const offer = note.action === null ? '' : ` [${note.action.label}]`;
  return `assistant: ${hidePid(message.text)}${label}${offer}`;
}

/** Summaries of approvals that expired, in the live turn or a turn this window watched end. */
function expired(view: ThreadView): string[] {
  const steps = [...(view.activeTurn?.steps ?? []), ...Object.values(view.finished).flatMap(({ steps: each }) => each)];
  return steps.flatMap((step) => (step.kind === 'approval' && step.ending?.kind === 'expired' ? [step.approval.summary] : []));
}

/** What the user sees in a chat, as plain data. */
export function shown(screen: ThreadScreen): unknown {
  const { view, problem } = screen;
  return {
    view:
      view.kind === 'loaded'
        ? {
            messages: view.value.messages.map(line),
            activeTurn:
              view.value.activeTurn === null
                ? null
                : {
                    state: view.value.activeTurn.state,
                    text: hidePid(view.value.activeTurn.text),
                    approvals: pendingApprovals(view.value.activeTurn).map(({ summary, choices }) => ({ summary, choices: choices.map(({ label }) => label) })),
                  },
            expiredApprovals: expired(view.value),
          }
        : view,
    draft: screen.draft,
    problem:
      problem === null
        ? null
        : problem.kind === 'session-choice'
          ? {
              kind: problem.kind,
              prompt: sessionChoiceCopy(problem.reason).prompt,
              options: sessionChoiceCopy(problem.reason).options.map(({ label, warning }) => (warning === null ? label : `${label} (${warning})`)),
            }
          : problem.kind === 'retry'
            ? { kind: problem.kind, reason: problem.reason, banner: bannerCopy(problem.reason).text, action: problem.action, sessionChoice: problem.sessionChoice }
            : problem,
  };
}

export const loaded = (session: ThreadSession): Promise<ThreadScreen> => until(session.screen, (screen) => screen.view.kind === 'loaded');

export const running = (session: ThreadSession): Promise<ThreadScreen> =>
  until(session.screen, (screen) => screen.view.kind === 'loaded' && screen.view.value.activeTurn?.state === 'running' && screen.view.value.activeTurn.text !== '');

export const idle = (session: ThreadSession, messages: number): Promise<ThreadScreen> =>
  until(
    session.screen,
    (screen) => screen.view.kind === 'loaded' && screen.view.value.activeTurn === null && screen.view.value.messages.length === messages && screen.busy === null,
  );
