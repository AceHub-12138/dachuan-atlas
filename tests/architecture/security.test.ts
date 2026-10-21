import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';
import { serializeAtlasDataset } from '../../src/architecture/dataset';
import { auditDatasetPrivacy } from '../../src/architecture/privacy';

const ROOT = process.cwd();
const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');

const FORBIDDEN = [
  '2584284e3e7b994d0510d9d53b2a302e3aa740bc',
  'nexus-2026-10-20',
  'VoiceMicrophone',
  'createVoiceOrchestrator',
  'PcmPlayer',
  'AudioStore',
  'JarvisCore',
  'sessionReducer',
  'parseWireEvent',
  'src/lib/voice/',
  'src/components/overlay/',
  'services/voice-orchestrator/',
  'nexus@2584284',
  'voice-request-to-overlay',
];

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('默认发布安全边界', () => {
  it('public 目录不包含任何真实 ATLAS 快照', () => {
    const files = walk(PUBLIC);
    expect(files.filter((file) => file.endsWith('.atlas.json'))).toEqual([]);
    expect(files.some((file) => /nexus-\d{4}-\d{2}-\d{2}/.test(file))).toBe(false);
  });

  it('演示数据序列化后不含内部源码路径或符号', () => {
    const text = serializeAtlasDataset(buildDemoDataset());
    for (const needle of FORBIDDEN) {
      expect(text).not.toContain(needle);
    }
    expect(text).not.toContain('src/lib/voice/');
    expect(text).not.toContain('/Users/');
  });

  it('演示数据隐私体检通过', () => {
    expect(auditDatasetPrivacy(buildDemoDataset())).toMatchObject({
      status: 'pass',
      absolutePathCount: 0,
      credentialFieldCount: 0,
    });
  });

  it.skipIf(!existsSync(DIST))('dist 不包含真实快照、提交 SHA 或内部源码定位', () => {
    const files = walk(DIST);
    expect(files.filter((file) => file.endsWith('.atlas.json'))).toEqual([]);
    for (const file of files) {
      if (!/\.(?:html|js|css|json|map|txt)$/i.test(file)) continue;
      const text = readFileSync(file, 'utf8');
      for (const needle of FORBIDDEN) {
        expect(text, `${file} 不应包含 ${needle}`).not.toContain(needle);
      }
    }
  });
});
