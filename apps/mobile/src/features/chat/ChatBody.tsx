import type { Agent, Thread } from '@morrowbot/contracts';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View, type ViewInstance } from 'react-native';
import { MorrowLayoutMetricsView } from '../../../modules/morrow-native-controls/index.ts';
import { ACTION_SLOT_METRICS, deriveActionSlotPlacement } from '../../lib/layout.ts';
import { deriveBottomControlInsets, parseNativeLayoutMetrics, type NativeLayoutMetrics } from '../../lib/reserved-regions.ts';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import type { DetailProps, WorkspaceNavigation } from '../../lib/workspace.ts';
import { openAttachMenu } from './attach-menu.ts';
import { AgentSettingsSheet } from './AgentSettingsSheet.tsx';
import { AttachmentStrip } from './AttachmentStrip.tsx';
import { chatRequests, useChatHub } from './chat-context.tsx';
import { threadFor } from './chat-hub.ts';
import { canPick, roomLeft } from './composer-attachments.ts';
import { composerButtons, queuedControls } from './composer-controls.ts';
import { Composer } from './Composer.tsx';
import { useKeyboardOverlap } from './keyboard-overlap.ts';
import { MessageList } from './MessageList.tsx';
import { useStore } from './store.ts';
import { ThreadTabs } from './ThreadTabs.tsx';

const EDGE = spacing[3];

/** Where the floating composer sits: above the keyboard, clear of the home indicator, hinge occlusions and floating actions. */
function composerFrame(metrics: NativeLayoutMetrics | null, keyboardOverlap: number) {
  const bottom = deriveBottomControlInsets(metrics);
  const placement = deriveActionSlotPlacement(metrics);
  const hasVerticalBar = metrics !== null && metrics.verticalBarEdge !== 'none';
  const actions = !hasVerticalBar && placement.kind === 'floating' ? placement.right + ACTION_SLOT_METRICS.buttonSize + spacing[2] : 0;
  return {
    left: bottom.left + EDGE,
    right: Math.max(bottom.right + EDGE, actions),
    bottom: Math.max(keyboardOverlap, bottom.bottom) + spacing[2],
  };
}

function ChatThread(props: {
  readonly agent: Agent;
  readonly thread: Thread;
  readonly threads: readonly Thread[];
  readonly navigation: WorkspaceNavigation;
}) {
  const hub = useChatHub();
  const { colors } = useTheme();
  const session = hub.session(props.thread.id);
  const screen = useStore(session.screen);
  const [metrics, setMetrics] = useState<NativeLayoutMetrics | null>(null);
  const [composerHeight, setComposerHeight] = useState(96);
  const canvas = useRef<ViewInstance>(null);
  const frame = composerFrame(metrics, useKeyboardOverlap(canvas));
  const { view, problem, stale } = screen;
  return (
    <View ref={canvas} style={styles.fill}>
      <MorrowLayoutMetricsView
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        onMetricsChange={(event) => {
          const next = parseNativeLayoutMetrics(event.nativeEvent);
          if (next) setMetrics(next);
        }}
      />
      <ThreadTabs
        threads={props.threads}
        currentId={props.thread.id}
        onSelect={(thread, isMain) => {
          props.navigation.open({ kind: 'chat', agentId: props.agent.id, threadId: isMain ? null : thread.id });
        }}
      />
      {view.kind === 'loaded' ? (
        <MessageList
          messages={view.value.messages}
          finished={view.value.finished}
          activeTurn={view.value.activeTurn}
          queue={view.value.queue}
          agentName={props.agent.name}
          queueControls={(message) => queuedControls(screen, message)}
          onQueued={(action, queuedId) => {
            switch (action) {
              case 'now':
                void session.steer(queuedId);
                return;
              case 'edit':
                void session.editQueued(queuedId);
                return;
              case 'cancel':
                void session.cancelQueued(queuedId);
            }
          }}
          answering={screen.answering}
          stale={stale}
          bottomInset={composerHeight + frame.bottom}
          onAnswer={(approvalId, choiceId) => void session.answer(approvalId, choiceId)}
          onContinue={(failedMessageId) => void session.continueTurn(failedMessageId)}
        />
      ) : (
        <View style={styles.center}>
          <Text style={[typography.ui, { color: colors.text3 }]}>{view.kind === 'loading' ? 'Loading chat…' : view.message}</Text>
          {view.kind === 'failed' ? <Button
              label="Try again"
              onPress={() => {
                session.load();
              }}
            /> : null}
        </View>
      )}
      <View
        style={[styles.composer, frame]}
        onLayout={({ nativeEvent }) => {
          setComposerHeight(nativeEvent.layout.height);
        }}
      >
        {stale && view.kind === 'loaded' ? (
          <View accessibilityLiveRegion="polite" style={[styles.problem, { backgroundColor: colors.surface2, borderColor: colors.hairline }]}>
            <Text style={[typography.small, styles.problemText, { color: colors.text3 }]}>Catching up with the host…</Text>
          </View>
        ) : null}
        {problem === null ? null : (
          <View style={[styles.problem, { backgroundColor: colors.surface2, borderColor: colors.hairlineStrong }]}>
            <Text style={[typography.small, styles.problemText, { color: colors.text2 }]}>{problem.message}</Text>
            {problem.kind === 'retry' ? <Button label="Retry" onPress={() => void session.retry()} /> : null}
          </View>
        )}
        <Composer
          agent={props.agent}
          draft={screen.draft}
          buttons={composerButtons(screen)}
          onDraft={(text) => {
            session.setDraft(text);
          }}
          onSend={() => void session.send()}
          onStop={() => void session.stop()}
          attachments={
            <AttachmentStrip
              items={screen.attachments}
              onRetry={(key) => {
                session.attachments.retry(key);
              }}
              onRemove={(key) => {
                session.attachments.remove(key);
              }}
            />
          }
          canAttach={view.kind === 'loaded' && !stale && canPick(screen.attachments)}
          onAttach={() => {
            openAttachMenu(session.attachments, roomLeft(screen.attachments));
          }}
        />
      </View>
    </View>
  );
}

function Button(props: { readonly label: string; readonly onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={props.onPress} style={[styles.button, { backgroundColor: colors.accentSoft }]}>
      <Text style={[typography.ui, styles.buttonText, { color: colors.accent }]}>{props.label}</Text>
    </Pressable>
  );
}

/** The chat canvas: thread tabs, the streaming conversation, and the floating composer. */
export function ChatBody(props: DetailProps<'chat'>) {
  const hub = useChatHub();
  const { colors } = useTheme();
  const { route, navigation } = props;
  const agents = useStore(hub.agents);
  const threads = useStore(hub.threads(route.agentId));
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(
    () =>
      chatRequests.listen((request) => {
        if (request.agentId !== route.agentId) return;
        switch (request.kind) {
          case 'agent-settings':
            setSettingsOpen(true);
            return;
          case 'new-thread':
            void hub.createThread(request.agentId).then((created) => {
              if (created.kind === 'ok') request.navigation.open({ kind: 'chat', agentId: request.agentId, threadId: created.value.id });
            });
        }
      }),
    [hub, route.agentId],
  );
  const agent = agents.kind === 'loaded' ? agents.value.find(({ id }) => id === route.agentId) : undefined;
  const thread = threads.kind === 'loaded' ? threadFor(threads.value, route.threadId) : null;
  const unknown = threads.kind === 'loaded' && thread === null && route.threadId !== null ? route.threadId : null;
  const askedFor = useRef<string | null>(null);
  useEffect(() => {
    if (unknown === null || askedFor.current === unknown) return;
    askedFor.current = unknown;
    void hub.refreshThreads(route.agentId);
  }, [hub, route.agentId, unknown]);
  if (agent === undefined || thread === null || threads.kind !== 'loaded') {
    const waiting = agents.kind === 'loading' || threads.kind === 'loading';
    const noChats = agent !== undefined && threads.kind === 'loaded' && threads.value.length === 0;
    return (
      <View style={styles.center}>
        <Text style={[typography.ui, styles.centerText, { color: colors.text3 }]}>
          {waiting ? 'Loading chat…' : noChats ? `${agent.name} has no chats yet.` : 'This chat is not on the host any more.'}
        </Text>
        {noChats ? (
          <Button
            label="Start a chat"
            onPress={() => {
              chatRequests.post({ kind: 'new-thread', agentId: agent.id, navigation });
            }}
          />
        ) : null}
      </View>
    );
  }
  return (
    <View style={styles.fill}>
      <ChatThread key={thread.id} agent={agent} thread={thread} threads={threads.value} navigation={navigation} />
      <AgentSettingsSheet
        key={agent.id}
        agent={agent}
        visible={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
        }}
        onDeleted={() => {
          setSettingsOpen(false);
          navigation.closeDetail();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[6] },
  centerText: { textAlign: 'center' },
  composer: { position: 'absolute', gap: spacing[2] },
  problem: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], borderRadius: radii.lg, borderWidth: 1, padding: spacing[3] },
  problemText: { flex: 1 },
  button: { minHeight: 40, paddingHorizontal: spacing[4], borderRadius: radii.pill, justifyContent: 'center' },
  buttonText: { fontWeight: '600' },
});
