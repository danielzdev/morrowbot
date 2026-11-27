import type { ProviderBinding } from '@morrowbot/contracts';
import { useEffect, useRef, useState } from 'preact/hooks';
import { ProviderGlyph } from '../../shared/binding-ui/ProviderRail.tsx';
import type { ProviderChoice } from '../../shared/binding-ui/selection.ts';
import { ariaShortcut, PLATFORM } from '../../shared/keys.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { accessPill, bindingPill, composerWarnings, type BoundProvider } from './binding-display.ts';
import { BindingPopover } from './BindingPopover.tsx';

const NOTE_MS = 4000;

/**
 * The composer's binding pill and access pill (spec §4.5). Either opens the one popover; the access
 * pill focuses its Access section. `openRequest` changes on ⇧⌘M.
 */
export function BindingControl(props: {
  readonly agentName: string;
  readonly choices: readonly ProviderChoice[];
  /** The bound provider's entry; undefined when it is not installed. */
  readonly choice: ProviderChoice | undefined;
  readonly binding: ProviderBinding;
  readonly openRequest: number;
  readonly onCommit: (next: BoundProvider) => Promise<string | null>;
  readonly redact: (text: string) => string;
  readonly onOpenProviders: () => void;
  readonly onOpenBrain: () => void;
}) {
  const [open, setOpen] = useState<'model' | 'access' | null>(null);
  const [note, setNote] = useState(false);
  const modelButton = useRef<HTMLButtonElement>(null);
  const accessButton = useRef<HTMLButtonElement>(null);
  const seen = useRef(props.openRequest);
  useEffect(() => {
    if (props.openRequest === seen.current) return;
    seen.current = props.openRequest;
    if (props.binding.kind === 'bound') setOpen('model');
    else props.onOpenBrain();
  }, [props.openRequest]);
  useEffect(() => {
    if (!note) return;
    const timer = setTimeout(() => {
      setNote(false);
    }, NOTE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [note]);
  const { binding } = props;
  if (binding.kind === 'unbound') {
    return (
      <button type="button" class="pill warn" onClick={props.onOpenBrain}>
        {`Choose a provider for ${props.agentName}`}
      </button>
    );
  }
  const { choice } = props;
  const model = bindingPill(choice, binding);
  const access = accessPill(choice, binding);
  return (
    <div class="binding-pills">
      <button
        ref={modelButton}
        type="button"
        class={`pill ${model.warn ? 'warn' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open === 'model'}
        aria-keyshortcuts={ariaShortcut('binding', PLATFORM)}
        onClick={() => { setOpen(open === 'model' ? null : 'model'); }}
      >
        <ProviderGlyph name={choice?.name ?? '?'} size="sm" />
        <span>{model.label}</span>
        <Icon name="chevron-down" />
      </button>
      <button
        ref={accessButton}
        type="button"
        class={`pill ${access.warn ? 'warn' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open === 'access'}
        onClick={() => { setOpen(open === 'access' ? null : 'access'); }}
      >
        <Icon name="lock" />
        <span>{access.label}</span>
        <Icon name="chevron-down" />
      </button>
      {note && <span class="binding-applies" role="status">{`Applies to all of ${props.agentName}'s chats`}</span>}
      {open !== null && (
        <BindingPopover
          key={open}
          agentName={props.agentName}
          choices={props.choices}
          binding={binding}
          anchor={open === 'access' ? accessButton : modelButton}
          focus={open}
          redact={props.redact}
          onOpenProviders={() => {
            setOpen(null);
            props.onOpenProviders();
          }}
          onCommit={async (next) => {
            const refused = await props.onCommit(next);
            if (refused === null) setNote(true);
            return refused;
          }}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

/** The warning strip under the composer: one line per warning that applies now (spec §4.5). */
export function BindingWarnings(props: { readonly choice: ProviderChoice | undefined; readonly binding: ProviderBinding; readonly onOpenProviders: () => void }) {
  const warnings = composerWarnings(props.choice, props.binding);
  if (warnings.length === 0) return null;
  return (
    <div class="warning-strip">
      {warnings.map((warning) =>
        warning.kind === 'profile' ? (
          <p key={warning.text}>
            <Icon name="warning" /> {warning.text}
          </p>
        ) : (
          <p key="review">
            <Icon name="warning" />{' '}
            <button type="button" class="link" onClick={props.onOpenProviders}>
              Review this provider's status
            </button>
          </p>
        ),
      )}
    </div>
  );
}
