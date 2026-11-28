/** What the Inspector shows (spec §3.4). The app builds it only from fields the renderer receives; text is privacy-safe. */
export interface InspectorFacts {
  readonly description: string;
  readonly workspace: { readonly path: string; readonly kind: 'dedicated' | 'shared' };
  readonly brain: BrainFacts;
  readonly instructions: InstructionsPreview;
}

/** The agent's provider, model and access, per §4.6; `model` is null while the provider can't report one. */
export type BrainFacts =
  | { readonly kind: 'unbound' }
  | {
      readonly kind: 'bound';
      readonly provider: string;
      readonly status: string;
      readonly ready: boolean;
      readonly model: string | null;
      readonly access: string;
      readonly warnings: readonly string[];
      /** `capabilities.sessions === false`: each turn gets recent history instead of a saved session. */
      readonly stateless: boolean;
    };

export type InstructionsPreview =
  | { readonly kind: 'loading' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'text'; readonly lines: readonly string[]; readonly more: boolean };

const PREVIEW_LINES = 6;

/** The first six lines of SOUL.md as the Instructions card shows them, from the host's `AgentInstructionsView`. */
export function previewOf(view: { readonly content: string | null; readonly revision: string | null }, redact: (text: string) => string): InstructionsPreview {
  if (view.content === null) return view.revision === null ? { kind: 'missing' } : { kind: 'unreadable' };
  const text = view.content.trimEnd();
  if (text.trim() === '') return { kind: 'empty' };
  const lines = text.split('\n');
  return { kind: 'text', lines: lines.slice(0, PREVIEW_LINES).map(redact), more: lines.length > PREVIEW_LINES };
}
