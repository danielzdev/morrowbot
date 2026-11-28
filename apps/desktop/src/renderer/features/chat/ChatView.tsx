import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { MorrowbotBridge } from '../../bridge.ts';
import { BlockedBanner } from '../../shared/BlockedBanner.tsx';
import { useStore } from '../../shared/use-store.ts';
import type { PeerDirectory } from './AgentExchange.tsx';
import { approvalHeadingId } from './ApprovalCard.tsx';
import type { ChatDisplay } from './display.ts';
import { FindBar } from './FindBar.tsx';
import { problemText, viewAnnouncement, type AnnounceMode } from './live-region.ts';
import { readingSpot, restoreSpot, type ReadingSpot } from './reading-spot.ts';
import { earlierStart, firstShown, growthOf, nearBottom, onGrowth } from './scroll-anchor.ts';
import { pendingApprovals, type ThreadView } from './thread-model.ts';
import type { ThreadSession } from './thread-session.ts';
import type { EngineLabel } from './SubagentGroup.tsx';
import { Timeline, type TimelineContext } from './Timeline.tsx';

export interface ChatViewProps {
  readonly session: ThreadSession;
  /** Holds Continue back, e.g. while the agent's provider settings save. */
  readonly locked: boolean;
  readonly agentName: string;
  readonly providerName: string | null;
  readonly display: ChatDisplay;
  readonly bridge: Pick<MorrowbotBridge, 'openExternal' | 'copyText'>;
  /** Bumped by every ⌘F. */
  readonly findRequest: number;
  /** Opened from a sidebar row with an Approval badge: focus the pending approval's heading once (spec §4.3), never its Allow button. */
  readonly focusApproval: boolean;
  readonly onApprovalFocused: () => void;
  /** The empty chat's avatar and question (spec §4.1). */
  readonly hero: ComponentChildren;
  readonly announce: AnnounceMode;
  readonly onOpenProviders: () => void;
  /** Names, colors and avatars for agent messages. */
  readonly peers: PeerDirectory;
  /** The provider and model badge of a sub-agent. */
  readonly engine: EngineLabel;
}

/** The chat canvas: history in a window of recent messages, the live turn, FindBar and announcements. */
export function ChatView(props: ChatViewProps) {
  const { session } = props;
  const screen = useStore(session.screen);
  const view = screen.view.kind === 'loaded' ? screen.view.value : null;
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastSent = useRef<string | null>(null);
  const anchor = useRef<ReadingSpot | null>(null);
  const [pill, setPill] = useState(false);
  const [start, setStart] = useState<number | null>(null);
  const [finding, setFinding] = useState(false);
  const [said, setSaid] = useState({ text: '', n: 0 });
  const latest = useRef(props);
  latest.current = props;
  const begin = start ?? (view === null ? 0 : firstShown(view.messages.length));
  const growth = view === null ? '' : growthOf(view);
  const fresh = view !== null && view.messages.length === 0 && view.agentMessages.length === 0 && view.subagents.length === 0 && view.activeTurn === null;

  const ctx = useMemo<TimelineContext>(
    () => ({
      display: props.display,
      copy: { provider: props.providerName, safe: props.display.safe },
      actions: {
        openLink: (href) => void latest.current.bridge.openExternal(href),
        copy: (text) => {
          const safe = latest.current.display.safe(text);
          if (safe !== null) void latest.current.bridge.copyText(safe);
        },
      },
      onAction: (messageId, action) => {
        if (action.kind === 'continue') void session.continueTurn(messageId, action.sessionChoice);
        else latest.current.onOpenProviders();
      },
      onAnswer: (approvalId, choiceId) => void session.answer(approvalId, choiceId),
      onReact: (messageId, emoji) => void session.react(messageId, emoji),
      agentName: props.agentName,
      image: session.image,
      peers: props.peers,
      engine: props.engine,
    }),
    [session, props.display, props.providerName, props.peers, props.agentName, props.engine],
  );

  const announce = (text: string): void => { setSaid((before) => ({ text, n: before.n + 1 })); };
  const previous = useRef<ThreadView | null>(null);
  useEffect(() => {
    if (view === null) return;
    if (start === null) setStart(firstShown(view.messages.length));
    const text = viewAnnouncement(previous.current, view, props.agentName, ctx.copy, props.announce);
    previous.current = view;
    if (text !== null) announce(text);
  }, [view]);
  useEffect(() => {
    if (screen.problem !== null) announce(problemText(screen.problem, props.display.safe));
  }, [screen.problem]);
  useEffect(() => {
    if (screen.connection === 'reconnecting') announce('Reconnecting…');
  }, [screen.connection]);
  useEffect(() => {
    if (!props.focusApproval || view === null) return;
    const first = view.activeTurn === null ? undefined : pendingApprovals(view.activeTurn)[0];
    const heading = first === undefined ? null : document.getElementById(approvalHeadingId(first.approvalId));
    if (heading !== null) {
      heading.scrollIntoView({ block: 'center' });
      heading.focus({ preventScroll: true });
      following.current = false;
    }
    props.onApprovalFocused();
  }, [props.focusApproval, view]);
  const seenFind = useRef(props.findRequest);
  useEffect(() => {
    if (props.findRequest === seenFind.current) return;
    seenFind.current = props.findRequest;
    setFinding(true);
  }, [props.findRequest]);

  const toBottom = (): void => {
    const box = scroller.current;
    if (box === null) return;
    box.scrollTop = box.scrollHeight;
    following.current = true;
    setPill(false);
  };
  useLayoutEffect(() => {
    if (view === null) return;
    const lastUser = view.messages.findLast(({ kind }) => kind === 'user')?.id ?? '';
    const sent = lastSent.current !== null && lastUser !== lastSent.current;
    lastSent.current = lastUser;
    if (onGrowth(following.current, sent) === 'follow') toBottom();
    else setPill(true);
  }, [growth]);
  useLayoutEffect(() => {
    const box = scroller.current;
    const spot = anchor.current;
    anchor.current = null;
    if (box === null || spot === null) return;
    restoreSpot(box, spot);
    const frame = requestAnimationFrame(() => {
      restoreSpot(box, spot);
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [begin]);
  useEffect(() => {
    const box = scroller.current;
    const content = box?.firstElementChild;
    if (box == null || content == null) return;
    const observer = new ResizeObserver(() => {
      if (following.current) box.scrollTop = box.scrollHeight;
    });
    observer.observe(content);
    return () => { observer.disconnect(); };
  }, [view === null, fresh]);

  switch (screen.view.kind) {
    case 'loading':
      return <div class="chat empty">Loading…</div>;
    case 'failed':
      return (
        <div class="chat empty">
          <p>{props.display.safe(screen.view.message) ?? 'This chat could not be loaded.'}</p>
          <button class="secondary" onClick={() => void session.load()}>Try again</button>
        </div>
      );
    case 'loaded':
      break;
  }
  const loaded = screen.view.value;
  const idle = loaded.activeTurn === null && loaded.blockedGroups.length === 0 && screen.busy === null;
  const showEarlier = (): void => {
    const box = scroller.current;
    if (box !== null) anchor.current = readingSpot(box);
    setStart(earlierStart(begin));
  };
  return (
    <div class="chat-frame">
      {screen.connection === 'reconnecting' && <div class="reconnecting" role="status">Reconnecting…</div>}
      <BlockedBanner groups={loaded.blockedGroups} onRelease={(regId) => void session.release(regId)} />
      {finding && (
        <FindBar
          view={loaded}
          scroller={scroller}
          rendered={`${String(begin)}:${growth}`}
          focusRequest={props.findRequest}
          firstRendered={begin}
          onReveal={(id) => {
            const index = loaded.messages.findIndex((message) => message.id === id);
            if (index !== -1 && index < begin) setStart(earlierStart(begin, index));
          }}
          onClose={() => { setFinding(false); }}
        />
      )}
      <div
        ref={scroller}
        class={`chat${fresh ? ' fresh' : ''}`}
        onScroll={(event) => {
          following.current = nearBottom(event.currentTarget);
          if (following.current) setPill(false);
        }}
      >
        {fresh ? (
          <div class="hero">{props.hero}</div>
        ) : (
          <Timeline view={loaded} start={begin} answering={screen.answering} idle={idle} locked={props.locked} offline={screen.connection !== 'live'} ctx={ctx} onShowEarlier={showEarlier} />
        )}
      </div>
      {pill && (
        <button class="new-messages" onClick={toBottom}>
          ↓ New messages
        </button>
      )}
      <div class="visually-hidden" aria-live="polite">
        <span key={said.n}>{said.text}</span>
      </div>
    </div>
  );
}
