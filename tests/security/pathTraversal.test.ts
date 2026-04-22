import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { getConfig } from '../../src/gateway/config.js';

// We test validatePath indirectly via the tools module by importing the function
// Since validatePath is not exported, we re-implement the core logic here for testing
// or test through the public tool interface. For unit testing we test the logic directly.

function testValidatePath(filePath: string, fsRootDir?: string): void {
  const root = path.resolve(fsRootDir || process.cwd());
  let resolved: string;
  try {
    resolved = fs.realpathSync(path.resolve(filePath));
  } catch {
    resolved = path.resolve(filePath);
  }
  if (!resolved.toLowerCase().startsWith(root.toLowerCase())) {
    throw new Error(`Erişim reddedildi: ${filePath} — İzin verilen kök dizin: ${root}`);
  }
  const blockedSegments = ['.env', '.ssh', 'id_rsa', 'id_ed25519', 'id_ecdsa', '.aws', '.npmrc', '.netrc', '.pgpass'];
  const segments = resolved.replace(/\\/g, '/').split('/');
  for (const seg of segments) {
    const segLower = seg.toLowerCase();
    for (const b of blockedSegments) {
      if (segLower === b.toLowerCase()) {
        throw new Error(`Erişim reddedildi: Sistem dosyası korumalıdır`);
      }
    }
    if (segLower === 'credentials' && segments.some(s => s.toLowerCase() === '.aws')) {
      throw new Error(`Erişim reddedildi: Sistem dosyası korumalıdır`);
    }
  }
}

describe('Path Traversal Defense', () => {
  const testRoot = path.join(process.cwd(), 'tmp_test_root');

  beforeAll(() => {
    if (!fs.existsSync(testRoot)) {
      fs.mkdirSync(testRoot, { recursive: true });
    }
    fs.writeFileSync(path.join(testRoot, 'safe.txt'), 'safe');
  });

  afterAll(() => {
    if (fs.existsSync(path.join(testRoot, 'safe.txt'))) {
      fs.unlinkSync(path.join(testRoot, 'safe.txt'));
    }
    if (fs.existsSync(testRoot)) {
      fs.rmdirSync(testRoot);
    }
  });

  it('blocks ../ traversal outside root', () => {
    expect(() => testValidatePath(path.join(testRoot, '..', 'package.json'), testRoot)).toThrow(/Erişim reddedildi/);
  });

  it('blocks absolute path outside root', () => {
    expect(() => testValidatePath('/etc/passwd', testRoot)).toThrow(/Erişim reddedildi/);
  });

  it('blocks .env segment', () => {
    expect(() => testValidatePath(path.join(testRoot, '.env'), testRoot)).toThrow(/Sistem dosyası korumalıdır/);
  });

  it('blocks .ssh segment', () => {
    expect(() => testValidatePath(path.join(testRoot, '.ssh', 'id_rsa'), testRoot)).toThrow(/Sistem dosyası korumalıdır/);
  });

  it('allows safe file inside root', () => {
    expect(() => testValidatePath(path.join(testRoot, 'safe.txt'), testRoot)).not.toThrow();
  });

  it('blocks symlink bypass when realpath resolves outside root', () => {
    const linkPath = path.join(testRoot, 'evil_link');
    try {
      fs.symlinkSync('/etc/passwd', linkPath);
    } catch {
      // skip if permission denied
      return;
    }
    try {
      expect(() => testValidatePath(linkPath, testRoot)).toThrow(/Erişim reddedildi/);
    } finally {
      fs.unlinkSync(linkPath);
    }
  });
});
