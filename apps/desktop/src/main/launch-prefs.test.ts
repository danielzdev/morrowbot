import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readSafeMode, writeSafeMode } from './launch-prefs.ts';

it('remembers the safe-mode choice for the next launch, and reads a missing or broken file as off', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'oribot-launch-'));
  try {
    const missing = readSafeMode(dir);
    writeSafeMode(dir, true);
    const on = readSafeMode(dir);
    writeSafeMode(dir, false);
    const off = readSafeMode(dir);
    writeFileSync(path.join(dir, 'launch.json'), '{"safeMode": "yes"}');
    const broken = readSafeMode(dir);
    expect({ missing, on, off, broken }).toEqual({ missing: false, on: true, off: false, broken: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
