import type { ComponentChildren } from 'preact';

/** One settings row (spec §6): label and a one-line description on the left, the control on the right. */
export function SettingRow(props: { readonly label: string; readonly description: string; readonly children: ComponentChildren }) {
  return (
    <div class="setting-row">
      <div class="setting-text">
        <div class="setting-label">{props.label}</div>
        <div class="setting-description">{props.description}</div>
      </div>
      <div class="setting-control">{props.children}</div>
    </div>
  );
}
