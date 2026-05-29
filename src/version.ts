import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

/** Uygulama sürümü — kök package.json ile senkron. */
export const APP_VERSION = pkg.version;
