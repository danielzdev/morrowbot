import { z } from 'zod';
import type { ElementRef } from '@morrowbot/contracts';
import { call, type CdpSession } from './session.ts';

const AxValue = z.object({ value: z.unknown().optional() }).optional();
const AxNode = z.object({
  nodeId: z.string(),
  ignored: z.boolean(),
  role: AxValue,
  name: AxValue,
  value: AxValue,
  properties: z.array(z.object({ name: z.string(), value: z.object({ value: z.unknown().optional() }) })).optional(),
  childIds: z.array(z.string()).optional(),
  parentId: z.string().optional(),
  backendDOMNodeId: z.number().int().optional(),
});
type AxNode = z.infer<typeof AxNode>;
const FullTree = z.object({ nodes: z.array(AxNode) });
const Described = z.object({ node: z.object({ attributes: z.array(z.string()).optional() }) });

/** Roles that only group other nodes: shown only when they have a name. */
const WRAPPERS = new Set(['generic', 'none', 'presentation', 'group', 'Section', 'LayoutTable', 'LayoutTableRow', 'LayoutTableCell', 'paragraph', 'Iframe', 'LabelText', 'MenuListPopup']);
const DROPPED = new Set(['InlineTextBox', 'LineBreak', 'ListMarker']);
const TEXT = 'StaticText';
const FIELDS = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
/** Fields whose children only repeat their text (a password's dots among them): never shown. */
const OPAQUE = new Set(['textbox', 'searchbox', 'spinbutton']);
const STATES = ['checked', 'selected', 'expanded', 'pressed', 'disabled', 'required', 'focused', 'level'];
const MAX_LINES = 3000;
const MAX_TEXT = 200;

export interface Snapshot {
  readonly tree: string;
  readonly refs: ReadonlyMap<ElementRef, number>;
}

/**
 * Reads the main frame's accessibility tree as one line per element, indented by depth. Elements
 * get `[ref=eN]`. Values of password and one-time-code fields are never read out.
 */
export async function takeSnapshot(session: CdpSession): Promise<Snapshot> {
  const { nodes } = await call(session, 'Accessibility.getFullAXTree', {}, FullTree);
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const root = nodes.find((node) => node.parentId === undefined || !byId.has(node.parentId));
  const refs = new Map<ElementRef, number>();
  const lines: string[] = [];
  const hidden = await hiddenValues(session, nodes);

  /** `parentName` is the nearest shown ancestor's name: text that only repeats it is left out. */
  const visit = (node: AxNode, depth: number, parentName: string): void => {
    if (lines.length >= MAX_LINES) return;
    const role = text(node.role?.value);
    const name = clip(text(node.name?.value));
    const children = (node.childIds ?? []).flatMap((id) => byId.get(id) ?? []);
    if (node.ignored || DROPPED.has(role) || role === 'RootWebArea' || (WRAPPERS.has(role) && name === '')) {
      for (const child of children) visit(child, depth, parentName);
      return;
    }
    if (role === TEXT) {
      if (name !== '' && !parentName.includes(name) && !siblingNamed(node, name)) lines.push(`${indent(depth)}- text "${name}"`);
      return;
    }
    const parts = [`${indent(depth)}- ${role}`];
    if (name !== '') parts.push(`"${name}"`);
    if (node.backendDOMNodeId !== undefined) {
      const ref: ElementRef = `e${String(refs.size + 1)}`;
      refs.set(ref, node.backendDOMNodeId);
      parts.push(`[ref=${ref}]`);
    }
    for (const state of states(node)) parts.push(state);
    if (FIELDS.has(role)) {
      const value = text(node.value?.value);
      if (node.backendDOMNodeId !== undefined && hidden.has(node.backendDOMNodeId)) parts.push(value === '' ? 'value=""' : 'value=<hidden>');
      else if (value !== '') parts.push(`value="${clip(value)}"`);
    }
    lines.push(parts.join(' '));
    if (OPAQUE.has(role)) return;
    for (const child of children) visit(child, depth + 1, name);
  };

  /** Another node under the same parent already carries this text as its name (a label and its field). */
  const siblingNamed = (node: AxNode, name: string): boolean => {
    const parent = node.parentId === undefined ? undefined : byId.get(node.parentId);
    return (parent?.childIds ?? []).some((id) => {
      const sibling = byId.get(id);
      return id !== node.nodeId && sibling !== undefined && text(sibling.role?.value) !== TEXT && clip(text(sibling.name?.value)) === name;
    });
  };

  if (root !== undefined) visit(root, 0, '');
  if (lines.length >= MAX_LINES) lines.push(`(cut at ${String(MAX_LINES)} lines; scroll and snapshot again for more)`);
  return { tree: lines.length === 0 ? '(empty page)' : lines.join('\n'), refs };
}

/** DOM nodes of fields whose value must not reach the agent: passwords and one-time codes. */
async function hiddenValues(session: CdpSession, nodes: readonly AxNode[]): Promise<ReadonlySet<number>> {
  const fields = nodes.flatMap((node) => (FIELDS.has(text(node.role?.value)) && node.backendDOMNodeId !== undefined ? [node.backendDOMNodeId] : []));
  const hidden = new Set<number>();
  await Promise.all(
    fields.map(async (backendNodeId) => {
      const { node } = await call(session, 'DOM.describeNode', { backendNodeId }, Described);
      const attributes = new Map<string, string>();
      const list = node.attributes ?? [];
      for (let index = 0; index + 1 < list.length; index += 2) attributes.set(list[index]?.toLowerCase() ?? '', list[index + 1] ?? '');
      const type = attributes.get('type')?.toLowerCase();
      const autocomplete = attributes.get('autocomplete')?.toLowerCase() ?? '';
      if (type === 'password' || /\b(one-time-code|current-password|new-password|cc-number|cc-csc)\b/.test(autocomplete)) hidden.add(backendNodeId);
    }),
  );
  return hidden;
}

function states(node: AxNode): string[] {
  const found: string[] = [];
  for (const property of node.properties ?? []) {
    if (!STATES.includes(property.name)) continue;
    const value = property.value.value;
    if (value === false || value === 'false' || value === undefined) continue;
    found.push(value === true || value === 'true' ? `[${property.name}]` : `[${property.name}=${text(value)}]`);
  }
  return found;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function clip(value: string): string {
  const quoted = value.replaceAll('"', '\\"');
  return quoted.length > MAX_TEXT ? `${quoted.slice(0, MAX_TEXT)}…` : quoted;
}

function indent(depth: number): string {
  return '  '.repeat(depth);
}
