import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertSafeOutput,
  atomicWriteOutputs,
  verifyManifestFiles,
} from '../../tools/import-safety.mjs';

const ROOT = process.cwd();
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'crm-synthetic');
const CLI = join(ROOT, 'tools', 'import-crm.mjs');

let tempRoot: string;

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function copyFixture(name: string): string {
  const target = join(tempRoot, name);
  cpSync(FIXTURE, target, { recursive: true });
  return target;
}

function rawManifest() {
  return JSON.parse(readFileSync(join(FIXTURE, 'snapshot-manifest.json'), 'utf8'));
}

function runCli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function importArgs(bundle: string, out: string, report: string, extra: string[] = []) {
  return [
    '--graphify',
    bundle,
    '--profile',
    join(bundle, 'profile.json'),
    '--allow-synthetic',
    '--out',
    out,
    '--report',
    report,
    ...extra,
  ];
}

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'atlas-crm-security-'));
  const tsc = join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  execFileSync(tsc, ['-p', 'tsconfig.tools.json'], { cwd: ROOT, stdio: 'ignore' });
  for (const directory of [
    'public',
    'dist',
    '.git',
    'node_modules',
    'local-data/crm',
    'local-data/nexus',
    'input',
  ]) {
    mkdirSync(join(tempRoot, 'root', directory), { recursive: true });
  }
  writeFileSync(join(tempRoot, 'root', 'input', 'graph.json'), '{}\n');
  writeFileSync(join(tempRoot, 'root', 'profile.json'), '{}\n');
});

afterAll(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

describe('导入安全边界：输出路径与符号链接', () => {
  const context = () => ({
    root: join(tempRoot, 'root'),
    graphifyDir: join(tempRoot, 'root', 'input'),
    profilePath: join(tempRoot, 'root', 'profile.json'),
  });
  const synthetic = { synthetic: true };
  const real = { synthetic: false };

  it('拒绝写入 public / dist / .git / node_modules / local-data/nexus', async () => {
    for (const directory of ['public', 'dist', '.git', 'node_modules', 'local-data/nexus']) {
      await expect(
        assertSafeOutput({
          file: join(tempRoot, 'root', directory, 'out.atlas.json'),
          profile: synthetic,
          label: '数据集',
          ...context(),
        }),
      ).rejects.toThrow(/受保护目录/);
    }
  });

  it('拒绝写入 Graphify 输入目录或覆盖 profile', async () => {
    await expect(
      assertSafeOutput({
        file: join(tempRoot, 'root', 'input', 'out.atlas.json'),
        profile: synthetic,
        label: '数据集',
        ...context(),
      }),
    ).rejects.toThrow(/输入目录/);
    await expect(
      assertSafeOutput({
        file: join(tempRoot, 'root', 'profile.json'),
        profile: synthetic,
        label: '数据集',
        ...context(),
      }),
    ).rejects.toThrow(/覆盖 profile/);
  });

  it('真实 CRM 只能写入 local-data/crm 或项目外目录', async () => {
    await expect(
      assertSafeOutput({
        file: join(tempRoot, 'root', 'docs', 'real.atlas.json'),
        profile: real,
        label: '数据集',
        ...context(),
      }),
    ).rejects.toThrow(/local-data\/crm/);
    await expect(
      assertSafeOutput({
        file: join(tempRoot, 'root', 'local-data', 'crm', 'real.atlas.json'),
        profile: real,
        label: '数据集',
        ...context(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      assertSafeOutput({
        file: join(tempRoot, 'outside', 'real.atlas.json'),
        profile: real,
        label: '数据集',
        ...context(),
      }),
    ).resolves.toBeUndefined();
  });

  it('拒绝目标本身是符号链接，以及父目录符号链接指向 public', async () => {
    const link = join(tempRoot, 'root', 'docs', 'link.atlas.json');
    mkdirSync(join(tempRoot, 'root', 'docs'), { recursive: true });
    symlinkSync(join(tempRoot, 'root', 'public', 'target.atlas.json'), link);
    await expect(
      assertSafeOutput({
        file: link,
        profile: synthetic,
        label: '数据集',
        ...context(),
      }),
    ).rejects.toThrow(/符号链接/);

    const linkedDirectory = join(tempRoot, 'root', 'linked-public');
    symlinkSync(join(tempRoot, 'root', 'public'), linkedDirectory);
    await expect(
      assertSafeOutput({
        file: join(linkedDirectory, 'out.atlas.json'),
        profile: synthetic,
        label: '数据集',
        ...context(),
      }),
    ).rejects.toThrow(/受保护目录/);
  });
});

describe('清单一致性：矛盾证据强制失败', () => {
  it('有效清单返回 verified', async () => {
    const result = await verifyManifestFiles(rawManifest(), join(FIXTURE, 'source-snapshot'));
    expect(result.integrity).toBe('verified');
    expect(result.ok).toBe(true);
    expect(result.hardFailure).toBe(false);
    expect(result.verifiedFiles).toBe(8);
  });

  it('哈希篡改、文件缺失、字节数不符都是 hardFailure', async () => {
    const snapshot = join(tempRoot, 'hash-snapshot');
    cpSync(join(FIXTURE, 'source-snapshot'), snapshot, { recursive: true });
    const target = join(snapshot, 'synthetic', 'customer', 'customer-service.ts');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n// tampered\n`);
    const tampered = await verifyManifestFiles(rawManifest(), snapshot);
    expect(tampered.integrity).toBe('mismatch');
    expect(tampered.hardFailure).toBe(true);
    expect(tampered.ok).toBe(false);

    const missing = await verifyManifestFiles(rawManifest(), join(tempRoot, 'missing-snapshot'));
    expect(missing.integrity).toBe('mismatch');
    expect(missing.hardFailure).toBe(true);

    const manifest = rawManifest();
    manifest.byte_count += 1;
    const bytes = await verifyManifestFiles(manifest, snapshot);
    expect(bytes.integrity).toBe('mismatch');
    expect(bytes.hardFailure).toBe(true);
  });

  it('路径穿越和符号链接越界都是 hardFailure', async () => {
    const traversal = rawManifest();
    traversal.files[0].path = '../outside.ts';
    traversal.file_count = traversal.files.length;
    const traversalResult = await verifyManifestFiles(traversal, join(FIXTURE, 'source-snapshot'));
    expect(traversalResult.hardFailure).toBe(true);
    expect(traversalResult.mismatches).toContain('../outside.ts');

    if (process.platform !== 'win32') {
      const snapshot = join(tempRoot, 'symlink-snapshot');
      cpSync(join(FIXTURE, 'source-snapshot'), snapshot, { recursive: true });
      symlinkSync('/etc/hosts', join(snapshot, 'synthetic', 'shared', 'escape.ts'));
      const symlinked = await verifyManifestFiles(rawManifest(), snapshot);
      expect(symlinked.hardFailure).toBe(true);
      expect(symlinked.symlinks).toContain('synthetic/shared/escape.ts');
      expect(symlinked.integrity).toBe('mismatch');
    }
  });

  it('空清单只是缺失证据，不是矛盾证据', async () => {
    const manifest = rawManifest();
    manifest.files = [];
    manifest.file_count = 0;
    manifest.byte_count = 0;
    const result = await verifyManifestFiles(manifest, join(FIXTURE, 'source-snapshot'));
    expect(result.hardFailure).toBe(false);
    expect(result.integrity).toBe('incomplete');
    expect(result.ok).toBe(false);
  });
});

describe('成对原子写入', () => {
  it('任一输出失败时恢复旧文件并清理临时文件', async () => {
    const directory = join(tempRoot, 'atomic');
    mkdirSync(directory, { recursive: true });
    const first = join(directory, 'dataset.atlas.json');
    const second = join(directory, 'blocked');
    writeFileSync(first, 'old-dataset\n');
    mkdirSync(second);

    await expect(
      atomicWriteOutputs([
        { file: first, content: 'new-dataset\n' },
        { file: second, content: 'report\n' },
      ]),
    ).rejects.toThrow();

    expect(readFileSync(first, 'utf8')).toBe('old-dataset\n');
    expect(readdirSync(directory).filter((name) => name.endsWith('.tmp') || name.endsWith('.bak'))).toEqual([]);
  });

  it('成功时同时写入两个文件', async () => {
    const directory = join(tempRoot, 'atomic-ok');
    const first = join(directory, 'dataset.atlas.json');
    const second = join(directory, 'report.json');
    await atomicWriteOutputs([
      { file: first, content: 'dataset\n' },
      { file: second, content: 'report\n' },
    ]);
    expect(readFileSync(first, 'utf8')).toBe('dataset\n');
    expect(readFileSync(second, 'utf8')).toBe('report\n');
  });
});

describe('CLI 安全回归', () => {
  it('哈希篡改无法由 --allow-partial 绕过，且不覆盖旧输出', () => {
    const bundle = copyFixture('cli-tampered');
    const target = join(bundle, 'source-snapshot', 'synthetic', 'customer', 'customer-service.ts');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n// tampered\n`);
    const out = join(tempRoot, 'cli-tampered-out', 'out.atlas.json');
    const report = join(tempRoot, 'cli-tampered-out', 'report.json');
    mkdirSync(join(tempRoot, 'cli-tampered-out'), { recursive: true });
    writeFileSync(out, 'previous-dataset\n');

    const result = runCli(importArgs(bundle, out, report, ['--allow-partial']));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('矛盾证据');
    expect(readFileSync(out, 'utf8')).toBe('previous-dataset\n');
    expect(existsSync(report)).toBe(false);
    expect(readdirSync(join(tempRoot, 'cli-tampered-out')).sort()).toEqual(['out.atlas.json']);
  });

  it('缺失清单属于缺失证据，显式 --allow-partial 下可 partial 导入', () => {
    const bundle = copyFixture('cli-missing-manifest');
    rmSync(join(bundle, 'snapshot-manifest.json'));
    const out = join(tempRoot, 'cli-missing-out', 'out.atlas.json');
    const report = join(tempRoot, 'cli-missing-out', 'report.json');
    const result = runCli(importArgs(bundle, out, report, ['--allow-partial']));
    expect(result.status).toBe(0);
    const dataset = JSON.parse(readFileSync(out, 'utf8')) as {
      snapshot: { importStatus: string };
    };
    expect(dataset.snapshot.importStatus).toBe('partial');
    const audit = JSON.parse(readFileSync(report, 'utf8')) as {
      provenance: { separation: { manifestConsistency: string; gitHistory: string } };
      sharing: { privacyPassed: boolean; containsInternalSymbols: boolean; publicShareable: boolean };
    };
    expect(audit.provenance.separation.manifestConsistency).toBe('partial');
    expect(audit.provenance.separation.gitHistory).toBe('not_attempted');
    expect(audit.sharing.privacyPassed).toBe(true);
    expect(audit.sharing.containsInternalSymbols).toBe(true);
    expect(audit.sharing.publicShareable).toBe(false);
  });

  it('CLI 不向网络传输数据（静态导入审计 + NODE_DEBUG 运行检查）', () => {
    for (const file of ['import-crm.mjs', 'git-provenance.mjs', 'import-safety.mjs']) {
      const source = readFileSync(join(ROOT, 'tools', file), 'utf8');
      expect(source).not.toMatch(
        /from\s+['"]node:(?:http|https|net|dns|tls|dgram)['"]|fetch\s*\(|https?\.request/,
      );
    }

    const bundle = copyFixture('cli-network');
    const out = join(tempRoot, 'cli-network-out', 'out.atlas.json');
    const report = join(tempRoot, 'cli-network-out', 'report.json');
    const result = runCli(importArgs(bundle, out, report, ['--dry-run', '--allow-partial']), {
      NODE_DEBUG: 'net,http,https,dns,tls',
    });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/^(?:NET|HTTP|HTTPS|DNS|TLS)\b/m);
  });
});
