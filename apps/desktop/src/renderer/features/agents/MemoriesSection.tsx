import type { Memory, MemoryInclusion } from '@morrowbot/contracts';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useStore } from '../../shared/use-store.ts';
import { Icon } from '../../shared/ui/Icon.tsx';
import { Segmented } from '../../shared/ui/Segmented.tsx';
import type { MemoriesEditor } from './memories-editor.ts';

const INCLUSIONS = [
  { value: 'essential', label: 'Every chat' },
  { value: 'searchable', label: 'On search' },
] as const;

function MemoryRow(props: { readonly memory: Memory; readonly editor: MemoriesEditor; readonly saving: boolean; readonly redact: (text: string) => string }) {
  const { memory, editor } = props;
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    const save = (): void => {
      if (draft.trim() === '') return;
      void editor.update(memory.id, { text: draft }).then((saved) => {
        if (saved) setDraft(null);
      });
    };
    return (
      <li class="memory-row editing">
        <textarea
          class="memory-text-input"
          aria-label="Memory"
          value={draft}
          maxLength={4000}
          onInput={(event) => { setDraft(event.currentTarget.value); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.stopPropagation(); setDraft(null); }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) save();
          }}
        />
        <div class="row">
          <button type="button" class="btn secondary" onClick={() => { setDraft(null); }}>Cancel</button>
          <button type="button" class="btn primary" disabled={props.saving || draft.trim() === ''} onClick={save}>Save</button>
        </div>
      </li>
    );
  }
  return (
    <li class="memory-row">
      <p class="memory-text">{props.redact(memory.text)}</p>
      <div class="memory-actions">
        <Segmented
          label="When to include"
          value={memory.inclusion}
          options={INCLUSIONS}
          onChange={(inclusion: MemoryInclusion) => void editor.update(memory.id, { inclusion })}
        />
        <button type="button" class="icon-btn" aria-label="Edit memory" title="Edit" disabled={props.saving} onClick={() => { setDraft(memory.text); }}><Icon name="pencil" /></button>
        <button type="button" class="icon-btn" aria-label="Forget memory" title="Forget" disabled={props.saving} onClick={() => void editor.forget(memory.id)}><Icon name="trash" /></button>
      </div>
    </li>
  );
}

/** Agent Settings › Memories: what the agent keeps across chats. Essential memories go with every turn. */
export function MemoriesSection(props: { readonly editor: () => MemoriesEditor; readonly redact: (text: string) => string }) {
  const editor = useMemo(props.editor, []);
  const state = useStore(editor.state);
  const [text, setText] = useState('');
  const [inclusion, setInclusion] = useState<MemoryInclusion>('essential');
  useEffect(() => {
    void editor.load();
  }, [editor]);
  const add = (): void => {
    if (text.trim() === '') return;
    void editor.add(text, inclusion).then((saved) => {
      if (saved) setText('');
    });
  };
  return (
    <div class="settings-section memories-section">
      <p class="binding-note">Memories marked “Every chat” are sent with each message to this agent. The rest are kept for search.</p>
      <div class="memory-new">
        <textarea
          class="memory-text-input"
          aria-label="New memory"
          placeholder="Something this agent should remember…"
          value={text}
          maxLength={4000}
          onInput={(event) => { setText(event.currentTarget.value); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) add();
          }}
        />
        <div class="row">
          <Segmented label="When to include the new memory" value={inclusion} options={INCLUSIONS} onChange={setInclusion} />
          <button type="button" class="btn primary" disabled={text.trim() === ''} onClick={add}>Remember</button>
        </div>
      </div>
      {state.problem !== null && <p class="note error" role="alert">{props.redact(state.problem)}</p>}
      <label class="memory-search">
        <Icon name="search" />
        <input type="search" aria-label="Search memories" placeholder="Search memories" value={state.query} maxLength={200} onInput={(event) => void editor.search(event.currentTarget.value)} />
      </label>
      {state.memories.kind === 'loading' && <p class="muted">Loading memories…</p>}
      {state.memories.kind === 'failed' && <p class="note error">{props.redact(state.memories.message)}</p>}
      {state.memories.kind === 'loaded' && state.memories.value.length === 0 && (
        <p class="muted">{state.query === '' ? 'No memories yet.' : 'No memories match.'}</p>
      )}
      {state.memories.kind === 'loaded' && state.memories.value.length > 0 && (
        <ul class="memory-list" aria-label="Memories">
          {state.memories.value.map((memory) => (
            <MemoryRow key={memory.id} memory={memory} editor={editor} saving={state.saving.includes(memory.id)} redact={props.redact} />
          ))}
        </ul>
      )}
    </div>
  );
}
