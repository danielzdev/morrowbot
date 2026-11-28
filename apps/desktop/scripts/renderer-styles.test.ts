import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';

/** Each rule in `css` that sets `-webkit-app-region`: its selectors and the region. */
function appRegionRules(css: string): { selectors: string[]; region: string }[] {
  const rules = css.replaceAll(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g);
  return [...rules].flatMap(([, selector = '', body = '']) => {
    const region = /-webkit-app-region:\s*([\w-]+)/.exec(body)?.[1];
    return region === undefined ? [] : [{ selectors: selector.trim().split(/\s*,\s*/), region }];
  });
}

it('keeps menus, popovers and dialogs from dragging the window when they open from a title bar', async () => {
  const overlays = await readFile(new URL('../src/renderer/styles/overlays.css', import.meta.url), 'utf8');
  expect(appRegionRules(overlays)).toEqual([{ selectors: ['.popover', '.modal'], region: 'no-drag' }]);
});
