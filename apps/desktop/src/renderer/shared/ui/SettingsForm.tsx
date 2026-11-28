import type { PluginConfig, PluginSettingsSchema, SettingField, SettingValue } from '@morrowbot/contracts';
import { useEffect, useState } from 'preact/hooks';

function SettingInput(props: { readonly id: string; readonly name: string; readonly field: SettingField; readonly value: SettingValue | undefined; readonly onChange: (value: SettingValue | undefined) => void }) {
  const { field } = props;
  switch (field.kind) {
    case 'boolean':
      return (
        <input
          id={props.id}
          type="checkbox"
          checked={props.value === undefined ? field.default === true : props.value === true}
          onChange={(event) => {
            props.onChange(event.currentTarget.checked);
          }}
        />
      );
    case 'select':
      return (
        <select
          id={props.id}
          value={String(props.value ?? field.default ?? '')}
          onChange={(event) => {
            props.onChange(event.currentTarget.value);
          }}
        >
          {field.options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      );
    case 'number':
      return (
        <input
          id={props.id}
          type="number"
          value={props.value === undefined ? '' : String(props.value)}
          placeholder={field.default === undefined ? '' : String(field.default)}
          onInput={(event) => {
            const text = event.currentTarget.value;
            props.onChange(text === '' ? undefined : Number(text));
          }}
        />
      );
    case 'string':
      return (
        <input
          id={props.id}
          type="text"
          spellcheck={false}
          value={props.value === undefined ? '' : String(props.value)}
          placeholder={field.default ?? (props.name === 'cliPath' ? 'Found on PATH' : '')}
          onInput={(event) => {
            const text = event.currentTarget.value;
            props.onChange(text === '' ? undefined : text);
          }}
        />
      );
  }
}

const same = (a: PluginConfig, b: PluginConfig): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * A plugin's or provider's own settings, drawn from its schema, with Save and Cancel (spec IA §4).
 * Remount it (key on the saved config) to drop the draft after a save. Renders nothing for an empty schema.
 */
export function SettingsForm(props: {
  readonly idPrefix: string;
  readonly schema: PluginSettingsSchema;
  readonly saved: PluginConfig;
  readonly busy: boolean;
  readonly onSave: (config: PluginConfig) => void;
  readonly onDirty: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<PluginConfig>(props.saved);
  const dirty = !same(draft, props.saved);
  const { onDirty } = props;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => {
    onDirty(false);
  }, [onDirty]);
  const fields = Object.entries(props.schema);
  if (fields.length === 0) return null;
  return (
    <form
      class="settings-form"
      onSubmit={(event) => {
        event.preventDefault();
        props.onSave(draft);
      }}
    >
      {fields.map(([name, field]) => (
        <div key={name} class="form-row">
          <label for={`${props.idPrefix}-${name}`}>{field.label}</label>
          <SettingInput
            id={`${props.idPrefix}-${name}`}
            name={name}
            field={field}
            value={draft[name]}
            onChange={(value) => {
              const others = Object.fromEntries(Object.entries(draft).filter(([key]) => key !== name));
              setDraft(value === undefined ? others : { ...others, [name]: value });
            }}
          />
        </div>
      ))}
      <div class="form-actions">
        <button type="button" class="btn secondary" disabled={!dirty || props.busy} onClick={() => { setDraft(props.saved); }}>
          Cancel
        </button>
        <button type="submit" class="btn primary" disabled={!dirty || props.busy}>
          {props.busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}
