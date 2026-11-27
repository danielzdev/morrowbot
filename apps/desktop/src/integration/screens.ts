import type { Message } from '@morrowbot/contracts';
import { describeOutcome, type ThreadScreen, type ThreadSession } from '../renderer/features/chat/index.ts';
import { until } from '../renderer/shared/store.ts';

const hidePid = (text: string): string => text.replaceAll(/from pid \d+/g, 'from pid <pid>');

function line(message: Message): string {
  if (message.kind === 'user') return `user: ${message.text}`;
  const note = describeOutcome(message.outcome);
  const label = note.label === null ? '' : ` [${note.label}]`;
  const offer = note.continueOffer === null ? '' : ` [${note.continueOffer.label}]`;
  return `assistant: ${hidePid(message.text)}${label}${offer}`;
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
                    approvals: view.value.activeTurn.approvals.map(({ summary, choices }) => ({ summary, choices: choices.map(({ label }) => label) })),
                  },
            expiredApprovals: view.value.expiredApprovals,
          }
        : view,
    draft: screen.draft,
    problem:
      problem === null
        ? null
        : problem.kind === 'session-choice'
          ? { kind: problem.kind, prompt: problem.prompt, options: problem.options.map(({ label, warning }) => (warning === null ? label : `${label} (${warning})`)) }
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
