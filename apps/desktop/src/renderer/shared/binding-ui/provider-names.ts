/** Built-in providers' short names and what runs their turns; other providers use their own name. */
const BUILT_IN: Readonly<Record<string, { readonly name: string; readonly runtime: string }>> = {
  'provider-claude': { name: 'Claude', runtime: 'Claude Code' },
  'provider-openai': { name: 'Codex', runtime: 'Codex' },
  'provider-antigravity': { name: 'Antigravity', runtime: 'Antigravity' },
};

/** The names the binding UI shows for a provider, from its id and manifest name. */
export function providerNames(id: string, manifestName: string): { readonly name: string; readonly runtime: string } {
  const known = BUILT_IN[id];
  if (known !== undefined) return known;
  const name = manifestName.replace(/\s*\([^)]*\)\s*$/, '') || manifestName;
  return { name, runtime: name };
}
