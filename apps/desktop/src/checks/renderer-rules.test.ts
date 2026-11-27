import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const desktop = fileURLToPath(new URL('../../', import.meta.url));
const renderer = `${desktop}src/renderer/`;
const styles = `${renderer}styles/`;

function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => pattern.test(name))
    .map((name) => `${dir}${name}`);
}

const relative = (path: string): string => path.slice(desktop.length);
const cssFiles = readdirSync(styles).filter((name) => name.endsWith('.css')).sort();

it('keeps raw colours in tokens.css only (spec §1)', () => {
  const raw = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/i;
  const offenders = cssFiles
    .filter((name) => name !== 'tokens.css')
    .flatMap((name) => readFileSync(`${styles}${name}`, 'utf8').split('\n').map((line, index) => ({ name, line, index })))
    .filter(({ line }) => raw.test(line.replace(/\/\*.*?\*\//g, '')))
    .map(({ name, line, index }) => `${name}:${String(index + 1)}: ${line.trim()}`);
  expect(offenders).toEqual([]);
});

it('never uses the browser’s blocking dialogs: there is an in-app ConfirmDialog', () => {
  const blocking = /\b(?:window\.)?(?:confirm|alert|prompt)\s*\(/;
  const offenders = filesUnder(renderer, /\.tsx?$/)
    .filter((path) => !path.endsWith('.test.ts'))
    .flatMap((path) => readFileSync(path, 'utf8').split('\n').map((line, index) => ({ path, line, index })))
    .filter(({ line }) => blocking.test(line) && !line.trim().startsWith('*'))
    .map(({ path, line, index }) => `${relative(path)}:${String(index + 1)}: ${line.trim()}`);
  expect(offenders).toEqual([]);
});

it('links every stylesheet from index.html, and the built app ships each one', () => {
  execFileSync(process.execPath, [`${desktop}scripts/build-renderer.ts`], { cwd: desktop, stdio: 'pipe' });
  const linked = [...readFileSync(`${desktop}dist/renderer/index.html`, 'utf8').matchAll(/<link rel="stylesheet" href="\.\/styles\/([\w-]+\.css)"/g)].map((match) => match[1]);
  const built = readdirSync(`${desktop}dist/renderer/styles`).sort();
  expect({ source: cssFiles, linked: [...linked].sort(), built }).toEqual({ source: cssFiles, linked: cssFiles, built: cssFiles });
  expect(cssFiles).toEqual(['agent-forms.css', 'agent-row.css', 'base.css', 'binding.css', 'chat.css', 'layout.css', 'overlays.css', 'palette.css', 'settings-search.css', 'settings.css', 'thread.css', 'timeline.css', 'tokens.css', 'usage.css']);
});
