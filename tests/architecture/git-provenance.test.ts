import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyGitHistory } from '../../tools/git-provenance.mjs';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'crm-synthetic');
const SNAPSHOT = join(FIXTURE, 'source-snapshot');

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function walk(directory: string, base = directory): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(full, base));
    else files.push(relative(base, full).replaceAll('\\', '/'));
  }
  return files.sort();
}

function buildManifest(root: string) {
  const files = walk(root).map((file) => ({
    path: file,
    sha256: sha256(readFileSync(join(root, file))),
  }));
  return {
    files,
    fileCount: files.length,
    byteCount: files.reduce((total, entry) => total + readFileSync(join(root, entry.path)).length, 0),
  };
}

let tempRoot: string;
let repo: string;
let commit: string;
let manifest: ReturnType<typeof buildManifest>;

function git(args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

function copySnapshot(): string {
  const target = mkdtempSync(join(tempRoot, 'snapshot-'));
  cpSync(SNAPSHOT, target, { recursive: true });
  return target;
}

beforeAll(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'atlas-git-provenance-'));
  repo = join(tempRoot, 'repo');
  mkdirSync(repo);
  cpSync(join(SNAPSHOT, 'synthetic'), join(repo, 'synthetic'), { recursive: true });
  git(['init', '-q']);
  git(['config', 'user.name', 'Synthetic Fixture']);
  git(['config', 'user.email', 'synthetic@example.invalid']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'synthetic snapshot'], {
    GIT_AUTHOR_DATE: '2026-10-20T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-20T00:00:00Z',
  });
  commit = git(['rev-parse', 'HEAD']);
  manifest = buildManifest(SNAPSHOT);
});

afterAll(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

describe('本地 Git 历史核实（合成 Git 仓库）', () => {
  it('提交是 commit 对象且清单文件与历史树一致时 verified', async () => {
    const result = await verifyGitHistory({
      repositoryPath: repo,
      commit,
      manifest,
      snapshotRoot: SNAPSHOT,
    });
    expect(result.status).toBe('verified');
    expect(result.commit).toBe(commit);
    expect(result.commitExists).toBe(true);
    expect(result.commitIsCommit).toBe(true);
    expect(result.manifestFiles).toBe(8);
    expect(result.matchedFiles).toBe(8);
    expect(result.mismatchedFiles).toEqual([]);
    expect(result.missingInGit).toEqual([]);
    expect(result.missingInSnapshot).toEqual([]);
  });

  it('不存在的提交是 failed，不当成可降级的缺失证据', async () => {
    const result = await verifyGitHistory({
      repositoryPath: repo,
      commit: 'd'.repeat(40),
      manifest,
      snapshotRoot: SNAPSHOT,
    });
    expect(result.status).toBe('failed');
    expect(result.commitExists).toBe(false);
    expect(result.note).toContain('不存在');
  });

  it('tag 对象不是 commit，不能通过历史核实', async () => {
    git(['tag', '-a', 'synthetic-tag', '-m', 'synthetic tag']);
    const tagObject = git(['rev-parse', 'synthetic-tag']);
    const result = await verifyGitHistory({
      repositoryPath: repo,
      commit: tagObject,
      manifest,
      snapshotRoot: SNAPSHOT,
    });
    expect(result.status).toBe('failed');
    expect(result.commitExists).toBe(true);
    expect(result.note).toMatch(/解析为|不是 commit/);
  });

  it('文件内容与历史树不一致时 partial，并单独记录路径', async () => {
    const snapshot = copySnapshot();
    const target = join(snapshot, 'synthetic', 'customer', 'customer-service.ts');
    writeFileSync(target, `${readFileSync(target, 'utf8')}\n// tampered\n`, 'utf8');
    const result = await verifyGitHistory({
      repositoryPath: repo,
      commit,
      manifest,
      snapshotRoot: snapshot,
    });
    expect(result.status).toBe('partial');
    expect(result.matchedFiles).toBe(7);
    expect(result.mismatchedFiles).toEqual(['synthetic/customer/customer-service.ts']);
    rmSync(snapshot, { recursive: true, force: true });
  });

  it('快照缺少清单文件时 partial，并记录 missingInSnapshot', async () => {
    const snapshot = copySnapshot();
    rmSync(join(snapshot, 'synthetic', 'shared', 'id.ts'));
    const result = await verifyGitHistory({
      repositoryPath: repo,
      commit,
      manifest,
      snapshotRoot: snapshot,
    });
    expect(result.status).toBe('partial');
    expect(result.missingInSnapshot).toEqual(['synthetic/shared/id.ts']);
    rmSync(snapshot, { recursive: true, force: true });
  });

  it('快照包含清单外文件时 partial，不把未核对文件算进 8/8', async () => {
    const snapshot = copySnapshot();
    writeFileSync(join(snapshot, 'synthetic', 'shared', 'extra.ts'), 'export const extra = 1;\n');
    const result = await verifyGitHistory({
      repositoryPath: repo,
      commit,
      manifest,
      snapshotRoot: snapshot,
    });
    expect(result.status).toBe('partial');
    expect(result.matchedFiles).toBe(8);
    expect(result.snapshotFilesNotInManifest).toEqual(['synthetic/shared/extra.ts']);
    rmSync(snapshot, { recursive: true, force: true });
  });

  it('快照中的符号链接被记录，不能算作逐字节一致', async () => {
    if (process.platform === 'win32') return;
    const snapshot = copySnapshot();
    symlinkSync(
      join(snapshot, 'synthetic', 'shared', 'id.ts'),
      join(snapshot, 'synthetic', 'shared', 'link.ts'),
    );
    const result = await verifyGitHistory({
      repositoryPath: repo,
      commit,
      manifest,
      snapshotRoot: snapshot,
    });
    expect(result.status).toBe('partial');
    expect(result.symlinksInSnapshot).toContain('synthetic/shared/link.ts');
    rmSync(snapshot, { recursive: true, force: true });
  });

  it('Git 历史中同目录有清单外文件时仍可 verified，但单独记录数量', async () => {
    writeFileSync(join(repo, 'synthetic', 'shared', 'extra.ts'), 'export const extra = 1;\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'synthetic extra file'], {
      GIT_AUTHOR_DATE: '2026-10-20T01:00:00Z',
      GIT_COMMITTER_DATE: '2026-10-20T01:00:00Z',
    });
    const secondCommit = git(['rev-parse', 'HEAD']);
    const result = await verifyGitHistory({
      repositoryPath: repo,
      commit: secondCommit,
      manifest,
      snapshotRoot: SNAPSHOT,
    });
    expect(result.status).toBe('verified');
    expect(result.gitFilesNotInManifest).toBe(1);
    expect(result.gitFilesNotInManifestSample).toEqual(['synthetic/shared/extra.ts']);
  });

  it('Git 仓库路径不存在时 failed，不伪造提交存在', async () => {
    const result = await verifyGitHistory({
      repositoryPath: join(tempRoot, 'missing-repo'),
      commit,
      manifest,
      snapshotRoot: SNAPSHOT,
    });
    expect(result.status).toBe('failed');
    expect(result.commitExists).toBe(false);
  });
});
