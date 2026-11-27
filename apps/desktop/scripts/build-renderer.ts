import { fileURLToPath } from 'node:url';
import { bundleRenderer } from './renderer-bundle.ts';

await bundleRenderer(fileURLToPath(new URL('../dist/renderer/', import.meta.url)));
