#!/usr/bin/env node
/**
 * 本地 Git 历史核实（P2.0-A.1）。
 *
 * 只使用只读 Git plumbing 命令，不 checkout、不 fetch、不执行钩子、不联网：
 * 1. 提交 SHA 是否真实存在；
 * 2. 对象类型是否为 commit（tag/tree/blob 都不算）；
 * 3. source-snapshot 中的清单文件是否与该提交的历史树逐字节一致；
 * 4. 缺失、变更、无法对应的文件分别记录。
 *
 * 清单内部一致性由 import-crm.mjs 单独检查；本模块只回答“历史是否对得上”。
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const GIT_TIMEOUT_MS = 60000;

function gitEnv() {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_ALLOW_PROTOCOL: 'none',
  };
}

function runGit(repository, args) {
  return new Promise((resolve) => {
    const child = spawn('git', ['-C', repository, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: gitEnv(),
    });
    const stdout = [];
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), GIT_TIMEOUT_MS);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: Buffer.concat(stdout), stderr: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(stdout), stderr });
    });
  });
}

/** Git blob 的对象 ID 是 SHA-1("blob <bytes>\0" + content)。 */
export function gitBlobSha1(buffer) {
  return createHash('sha1')
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest('hex');
}

async function walkSnapshot(directory, base = directory) {
  const files = [];
  const symlinks = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return { files, symlinks, readable: false };
  }
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(base, full).replaceAll(path.sep, '/');
    if (entry.isSymbolicLink()) {
      symlinks.push(relative);
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await walkSnapshot(full, base);
      files.push(...nested.files);
      symlinks.push(...nested.symlinks);
      if (!nested.readable) return { files, symlinks, readable: false };
      continue;
    }
    if (entry.isFile()) files.push(relative);
    else symlinks.push(relative);
  }
  return { files: files.sort(), symlinks: symlinks.sort(), readable: true };
}

function result(overrides) {
  return {
    status: 'failed',
    commit: null,
    commitExists: false,
    commitIsCommit: false,
    manifestFiles: 0,
    matchedFiles: 0,
    mismatchedFiles: [],
    missingInGit: [],
    missingInSnapshot: [],
    snapshotFilesNotInManifest: [],
    gitFilesNotInManifest: 0,
    gitFilesNotInManifestSample: [],
    symlinksInSnapshot: [],
    note: '',
    ...overrides,
  };
}

function short(value) {
  return typeof value === 'string' && value.length >= 7 ? value.slice(0, 7) : 'unknown';
}

/**
 * @param {object} input
 * @param {string} input.repositoryPath 本地 Git 仓库目录（只读）
 * @param {string} input.commit 完整 40 位提交 SHA
 * @param {{files: {path: string, sha256: string}[], fileCount: number|null}} input.manifest
 * @param {string} input.snapshotRoot source-snapshot 目录
 * @returns {Promise<object>} GitHistorySummary（不含绝对路径）
 */
export async function verifyGitHistory({ repositoryPath, commit, manifest, snapshotRoot }) {
  if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/i.test(commit)) {
    return result({
      note: '提交缺失或不是完整 40 位 SHA，无法核实 Git 历史。',
    });
  }
  const expectedCommit = commit.toLowerCase();

  let repository;
  try {
    const info = await stat(repositoryPath);
    if (!info.isDirectory()) {
      return result({ commit: expectedCommit, note: 'Git 仓库路径不是目录。' });
    }
    repository = await realpath(repositoryPath);
  } catch {
    return result({ commit: expectedCommit, note: 'Git 仓库路径不存在或不可读取。' });
  }

  const revision = await runGit(repository, [
    'rev-parse',
    '--verify',
    '--quiet',
    `${expectedCommit}^{commit}`,
  ]);
  if (revision.code !== 0) {
    return result({
      commit: expectedCommit,
      note: `提交 ${short(expectedCommit)} 在本地 Git 仓库中不存在，或不能解析为 commit。`,
    });
  }
  const resolved = revision.stdout.toString('utf8').trim();
  if (resolved !== expectedCommit) {
    return result({
      commit: expectedCommit,
      commitExists: true,
      note: `提交 ${short(expectedCommit)} 解析为 ${short(resolved)}，与请求的完整 SHA 不一致。`,
    });
  }

  const objectType = await runGit(repository, ['cat-file', '-t', expectedCommit]);
  const type = objectType.code === 0 ? objectType.stdout.toString('utf8').trim() : '';
  if (type !== 'commit') {
    return result({
      commit: expectedCommit,
      commitExists: true,
      commitIsCommit: false,
      note:
        objectType.code === 0
          ? `提交 ${short(expectedCommit)} 的对象类型是 ${type || '未知'}，不是 commit。`
          : `无法读取提交 ${short(expectedCommit)} 的对象类型。`,
    });
  }

  const tree = await runGit(repository, ['ls-tree', '-r', '-z', '--full-tree', expectedCommit]);
  if (tree.code !== 0) {
    return result({
      commit: expectedCommit,
      commitExists: true,
      commitIsCommit: true,
      note: `无法读取提交 ${short(expectedCommit)} 的历史树。`,
    });
  }

  const entries = new Map();
  for (const record of tree.stdout.toString('utf8').split('\0')) {
    if (!record) continue;
    const tab = record.indexOf('\t');
    if (tab < 0) continue;
    const [mode, entryType, objectId] = record.slice(0, tab).split(' ');
    const filePath = record.slice(tab + 1);
    if (filePath) entries.set(filePath, { mode, type: entryType, objectId });
  }

  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  const manifestPaths = new Set(manifestFiles.map((entry) => entry.path));
  const mismatchedFiles = [];
  const missingInGit = [];
  const missingInSnapshot = [];
  let matchedFiles = 0;

  for (const entry of manifestFiles) {
    const treeEntry = entries.get(entry.path);
    if (!treeEntry) {
      missingInGit.push(entry.path);
      continue;
    }
    // 符号链接在 Git 中也是 blob，但内容是链接目标，不是源码字节；不能算一致。
    if (treeEntry.type !== 'blob' || treeEntry.mode === '120000') {
      mismatchedFiles.push(entry.path);
      continue;
    }
    let buffer;
    try {
      buffer = await readFile(path.join(snapshotRoot, entry.path));
    } catch {
      missingInSnapshot.push(entry.path);
      continue;
    }
    const localSha256 = createHash('sha256').update(buffer).digest('hex');
    if (localSha256 !== entry.sha256) {
      // 清单自身与文件不一致；CLI 会将其作为硬错误。
      mismatchedFiles.push(entry.path);
      continue;
    }
    if (gitBlobSha1(buffer) === treeEntry.objectId) matchedFiles += 1;
    else mismatchedFiles.push(entry.path);
  }

  const walked = await walkSnapshot(snapshotRoot);
  const snapshotFilesNotInManifest = walked.files.filter((file) => !manifestPaths.has(file));

  // 同目录下 Git 有、但清单未收录的文件：可能被 Graphify 过滤，单独记录，
  // 不因此判定内容冲突。
  const manifestDirectories = new Set(
    manifestFiles.map((entry) => path.posix.dirname(entry.path)),
  );
  const gitFilesNotInManifest = [...entries.keys()].filter(
    (file) => manifestDirectories.has(path.posix.dirname(file)) && !manifestPaths.has(file),
  );

  const manifestFileCount = manifestFiles.length;
  const problems =
    mismatchedFiles.length +
    missingInGit.length +
    missingInSnapshot.length +
    snapshotFilesNotInManifest.length +
    walked.symlinks.length;
  const status =
    problems === 0 && manifestFileCount > 0 && matchedFiles === manifestFileCount
      ? 'verified'
      : 'partial';

  const note =
    status === 'verified'
      ? `提交 ${short(expectedCommit)} 是 commit 对象；${matchedFiles}/${manifestFileCount} 个清单文件与历史树逐字节一致。`
      : `提交 ${short(expectedCommit)} 是 commit 对象，但只能核实 ${matchedFiles}/${manifestFileCount} 个清单文件；缺失 ${missingInGit.length}、内容不一致 ${mismatchedFiles.length}、快照多余 ${snapshotFilesNotInManifest.length}、符号链接 ${walked.symlinks.length}。`;

  return result({
    status,
    commit: expectedCommit,
    commitExists: true,
    commitIsCommit: true,
    manifestFiles: manifestFileCount,
    matchedFiles,
    mismatchedFiles,
    missingInGit,
    missingInSnapshot,
    snapshotFilesNotInManifest,
    gitFilesNotInManifest: gitFilesNotInManifest.length,
    gitFilesNotInManifestSample: gitFilesNotInManifest.slice(0, 20),
    symlinksInSnapshot: walked.symlinks,
    note,
  });
}
