import type { AssistantMessage, Message, QueuedMessage } from '@morrowbot/contracts';
import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { radii, spacing, typography } from '../../lib/theme.ts';
import { useTheme } from '../../lib/useTheme.ts';
import { ApprovalCard } from './ApprovalCard.tsx';
import type { QueuedControls } from './composer-controls.ts';
import { Markdown } from './Markdown.tsx';
import { outcomeNote } from './outcome-copy.ts';
import { QueuedBubble } from './QueuedBubble.tsx';
import type { ActiveTurnView, ToolStep, TurnStep } from './thread-view.ts';
import { ToolTimeline } from './ToolTimeline.tsx';

const tools = (steps: readonly TurnStep[]): ToolStep[] => steps.flatMap((step) => (step.kind === 'tool' ? [step] : []));

/** How close to the end still counts as "at the end", so streaming keeps the newest text in view. */
const FOLLOW_SLACK = 80;

function UserBubble(props: { readonly text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.user, { backgroundColor: colors.surfaceUser }]}>
      <Text selectable style={[typography.body, { color: colors.text1 }]}>{props.text}</Text>
    </View>
  );
}

function Outcome(props: {
  readonly message: AssistantMessage;
  readonly latest: boolean;
  readonly disabled: boolean;
  readonly onContinue: () => void;
}) {
  const { colors } = useTheme();
  const note = outcomeNote(props.message);
  if (note === null) return null;
  const tone = { muted: colors.text3, warn: colors.warn, danger: colors.danger }[note.tone];
  return (
    <View style={styles.outcome}>
      <Text style={[typography.small, styles.outcomeText, { color: tone }]}>{note.text}</Text>
      {note.action !== null && props.latest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: props.disabled }}
          disabled={props.disabled}
          onPress={props.onContinue}
          style={({ pressed }) => [
            styles.continue,
            { backgroundColor: pressed ? colors.selected : colors.accentSoft },
            props.disabled && styles.disabled,
          ]}
        >
          <Text style={[typography.ui, styles.continueText, { color: colors.accent }]}>{note.action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function MessageList(props: {
  readonly messages: readonly Message[];
  readonly finished: Readonly<Record<string, readonly TurnStep[]>>;
  readonly activeTurn: ActiveTurnView | null;
  readonly queue: readonly QueuedMessage[];
  readonly agentName: string;
  readonly queueControls: (message: QueuedMessage) => QueuedControls;
  readonly onQueued: (action: 'now' | 'edit' | 'cancel', queuedId: string) => void;
  readonly answering: readonly string[];
  /** The chat is catching up with the host: approvals and Continue wait. */
  readonly stale: boolean;
  readonly bottomInset: number;
  readonly onAnswer: (approvalId: string, choiceId: string) => void;
  readonly onContinue: (failedMessageId: string) => void;
}) {
  const { colors } = useTheme();
  const scroll = useRef<ScrollViewInstance>(null);
  const following = useRef(true);
  /** Until the user first scrolls, every jump to the end is instant, so late layout never leaves it short. */
  const settled = useRef(false);
  const { activeTurn } = props;
  const last = props.messages.at(-1);
  return (
    <ScrollView
      ref={scroll}
      style={styles.fill}
      contentContainerStyle={[styles.content, { paddingBottom: props.bottomInset + spacing[4] }]}
      keyboardDismissMode="interactive"
      scrollEventThrottle={32}
      onScrollBeginDrag={() => {
        settled.current = true;
      }}
      onScroll={({ nativeEvent }) => {
        const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
        following.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - FOLLOW_SLACK;
      }}
      onContentSizeChange={() => {
        if (following.current) scroll.current?.scrollToEnd({ animated: settled.current });
      }}
    >
      {props.messages.length === 0 && activeTurn === null ? (
        <Text style={[typography.ui, styles.empty, { color: colors.text3 }]}>Say hello to start this chat.</Text>
      ) : null}
      {props.messages.map((message) =>
        message.kind === 'user' ? (
          <UserBubble key={message.id} text={message.text} />
        ) : (
          <View key={message.id} style={styles.assistant}>
            <ToolTimeline steps={tools(props.finished[message.id] ?? [])} />
            {message.text === '' ? null : <Markdown text={message.text} />}
            <Outcome
              message={message}
              latest={message === last && activeTurn === null}
              disabled={props.stale}
              onContinue={() => {
                props.onContinue(message.id);
              }}
            />
          </View>
        ),
      )}
      {activeTurn === null ? null : (
        <View style={styles.assistant}>
          <ToolTimeline steps={tools(activeTurn.steps)} />
          {activeTurn.trigger.kind === 'agent-message' ? (
            <Text style={[typography.ui, { color: colors.text3 }]}>Answering a message from another agent…</Text>
          ) : activeTurn.text === '' ? (
            <Text style={[typography.ui, { color: colors.text3 }]}>
              {activeTurn.state === 'queued' ? (activeTurn.queueNote ?? 'Waiting to start…') : `${activeTurn.detail ?? 'Thinking'}…`}
            </Text>
          ) : (
            <Markdown text={activeTurn.text} />
          )}
          {activeTurn.steps.map((step) =>
            step.kind === 'approval' ? (
              <ApprovalCard
                key={step.approval.approvalId}
                step={step}
                answer={props.answering.includes(step.approval.approvalId) ? 'sending' : props.stale ? 'paused' : 'ready'}
                onAnswer={(choiceId) => {
                  props.onAnswer(step.approval.approvalId, choiceId);
                }}
              />
            ) : null,
          )}
        </View>
      )}
      {props.queue.map((message) => (
        <QueuedBubble
          key={message.id}
          message={message}
          agentName={props.agentName}
          controls={props.queueControls(message)}
          onNow={() => {
            props.onQueued('now', message.id);
          }}
          onEdit={() => {
            props.onQueued('edit', message.id);
          }}
          onCancel={() => {
            props.onQueued('cancel', message.id);
          }}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[4] },
  empty: { textAlign: 'center', marginTop: spacing[8] },
  user: { alignSelf: 'flex-end', maxWidth: '85%', borderRadius: radii.xl, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  assistant: { gap: spacing[3] },
  outcome: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  outcomeText: { flex: 1 },
  continue: { minHeight: 44, paddingHorizontal: spacing[5], borderRadius: radii.pill, justifyContent: 'center' },
  continueText: { fontWeight: '600' },
  disabled: { opacity: 0.5 },
});
