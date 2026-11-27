import type { ComponentChildren } from 'preact';
import type { SettingEntry } from './settings-index.ts';

/**
 * One settings row (spec §6): label and a one-line description on the left, the control on the right.
 * The text comes from the row's index entry, so search finds exactly what is shown.
 */
export function SettingRow(props: { readonly entry: SettingEntry; readonly children: ComponentChildren }) {
  return (
    <div class="setting-row" data-setting={props.entry.id}>
      <div class="setting-text">
        <div class="setting-label">{props.entry.label}</div>
        <div class="setting-description">{props.entry.description}</div>
      </div>
      <div class="setting-control">{props.children}</div>
    </div>
  );
}
