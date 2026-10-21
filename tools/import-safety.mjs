#!/usr/bin/env node
/**
 * CRM 本地导入的路径与写入安全边界（P2.0-A.1）。
 *
 * 这些函数不读取网络、不依赖 ATLAS 数据模型，便于单独做安全回归：
 * - 输出不得进入 public/、dist/、.git/、node_modules/、local-data/nexus/；
 * - 输出不得是符号链接，父目录符号链接会解析后再判断；
 * - 真实 CRM 只能写入 local-data/crm/ 或项目外目录；
 * - 清单文件不得通过符号链接越出 source-snapshot；
 * - 数据集与审计报告成对写入，失败时恢复旧文件。
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export function isInsideOrEqual(directory, file) {
  const relative = path.relative(directory, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function realpathOrNull(file) {
  try {
    return await realpath(file);
  } catch {
    return null;
  }
}

/**
 * 解析“最近的已存在祖先目录 + 尚未创建的文件名”。
 * 用于识别父目录符号链接，避免把输出写进 public/ 或 dist/。
 */
export async function resolveRealTarget(target) {
  let current = path.resolve(target);
  const tail = [];
  while (true) {
    try {
      const real = await realpath(current);
      return tail.length ? path.join(real, ...tail) : real;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(target);
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

export async function assertSafeOutput({
  file,
  profile,
  label,
  root,
  graphifyDir,
  profilePath,
}) {
  const resolved = path.resolve(file);

  try {
    const info = await lstat(resolved);
    if (info.isSymbolicLink()) {
      throw new Error(`安全边界：拒绝把 ${label} 写入符号链接目标。`);
    }
    if (info.isDirectory()) {
      throw new Error(`安全边界：${label} 目标是目录，不是文件。`);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  if (isInsideOrEqual(graphifyDir, resolved)) {
    throw new Error(`安全边界：拒绝把 ${label} 写入 Graphify 输入目录。`);
  }
  if (resolved === profilePath) {
    throw new Error(`安全边界：拒绝覆盖 profile 文件。`);
  }

  const reserved = [
    path.join(root, 'public'),
    path.join(root, 'dist'),
    path.join(root, '.git'),
    path.join(root, 'node_modules'),
    path.join(root, 'local-data', 'nexus'),
  ];
  const realTarget = await resolveRealTarget(resolved);
  for (const directory of reserved) {
    const realDirectory = (await realpathOrNull(directory)) ?? path.resolve(directory);
    if (isInsideOrEqual(directory, resolved) || isInsideOrEqual(realDirectory, realTarget)) {
      throw new Error(`安全边界：拒绝把 ${label} 写入受保护目录。`);
    }
  }

  if (profile.synthetic) return;
  const localCrm = path.join(root, 'local-data', 'crm');
  const realLocalCrm = (await realpathOrNull(localCrm)) ?? path.resolve(localCrm);
  const realRoot = (await realpathOrNull(root)) ?? path.resolve(root);
  if (isInsideOrEqual(realRoot, realTarget) && !isInsideOrEqual(realLocalCrm, realTarget)) {
    throw new Error(
      `安全边界：真实 CRM ${label} 只能写入 local-data/crm/ 或项目外目录；拒绝写入仓库其他位置。`,
    );
  }
}

/** 不跟随符号链接地列出目录中的符号链接。 */
export async function findSymlinks(directory, base = directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(base, full).replaceAll(path.sep, '/');
    if (entry.isSymbolicLink()) {
      found.push(relative);
      continue;
    }
    if (entry.isDirectory()) found.push(...(await findSymlinks(full, base)));
  }
  return found.sort();
}

/**
 * 清单与 source-snapshot 的内部一致性。
 * 返回 integrity='mismatch' 时调用方必须硬失败，不能用 --allow-partial 绕过。
 */
export async function verifyManifestFiles(manifest, snapshotRoot) {
  const mismatches = [];
  const missing = [];
  const hardFailures = [];
  let verifiedFiles = 0;
  let measuredBytes = 0;

  let rootStat = null;
  try {
    rootStat = await lstat(snapshotRoot);
  } catch {
    hardFailures.push('source-snapshot 目录不存在');
  }
  if (rootStat?.isSymbolicLink()) hardFailures.push('source-snapshot 目录本身是符号链接');
  else if (rootStat && !rootStat.isDirectory()) hardFailures.push('source-snapshot 不是目录');

  const symlinks = rootStat?.isDirectory() ? await findSymlinks(snapshotRoot) : [];
  if (symlinks.length) {
    hardFailures.push(`source-snapshot 含 ${symlinks.length} 个符号链接`);
  }
  const realRoot = rootStat ? await realpathOrNull(snapshotRoot) : null;

  for (const entry of manifest.files) {
    const absolute = path.resolve(snapshotRoot, entry.path);
    if (!isInsideOrEqual(snapshotRoot, absolute)) {
      mismatches.push(entry.path);
      hardFailures.push(`清单路径越界：${entry.path}`);
      continue;
    }
    try {
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        mismatches.push(entry.path);
        hardFailures.push(`清单文件是符号链接：${entry.path}`);
        continue;
      }
      if (!info.isFile()) {
        mismatches.push(entry.path);
        hardFailures.push(`清单路径不是普通文件：${entry.path}`);
        continue;
      }
      const realFile = await realpath(absolute);
      if (!realRoot || !isInsideOrEqual(realRoot, realFile)) {
        mismatches.push(entry.path);
        hardFailures.push(`清单文件真实路径越界：${entry.path}`);
        continue;
      }
      const data = await readFile(realFile);
      measuredBytes += data.length;
      if (sha256(data) === entry.sha256) verifiedFiles += 1;
      else {
        mismatches.push(entry.path);
      }
    } catch {
      missing.push(entry.path);
    }
  }

  const declaredFileCount =
    manifest.fileCount ?? manifest.file_count ?? manifest.files.length;
  const declaredByteCount = manifest.byteCount ?? manifest.byte_count ?? null;
  const countOk = declaredFileCount === manifest.files.length;
  const bytesOk = declaredByteCount === null || declaredByteCount === measuredBytes;

  if (mismatches.length) hardFailures.push(`SHA-256 不匹配 ${mismatches.length} 个`);
  if (missing.length) hardFailures.push(`文件缺失 ${missing.length} 个`);
  if (!countOk) {
    hardFailures.push(`file_count 声明 ${declaredFileCount}，实际 ${manifest.files.length}`);
  }
  if (!bytesOk) {
    hardFailures.push(`byte_count 声明 ${declaredByteCount}，实测 ${measuredBytes}`);
  }

  const ok =
    hardFailures.length === 0 &&
    manifest.files.length > 0 &&
    verifiedFiles === manifest.files.length;
  const integrity = hardFailures.length
    ? 'mismatch'
    : ok
      ? 'verified'
      : 'incomplete';

  return {
    fileCount: manifest.files.length,
    declaredFileCount,
    declaredByteCount,
    measuredBytes,
    verifiedFiles,
    mismatches,
    missing,
    symlinks,
    countOk,
    bytesOk,
    hardFailure: hardFailures.length > 0,
    hardFailures,
    integrity,
    ok,
  };
}

/**
 * 成对写入：先全部写临时文件，再逐个替换；任一失败则恢复旧文件并清理临时文件。
 * 这样不会留下半写入的数据集，也不会在只写成功一个文件时污染导入状态。
 */
export async function atomicWriteOutputs(outputs) {
  const staged = [];
  const backups = [];
  const committed = [];
  try {
    for (const output of outputs) {
      const directory = path.dirname(output.file);
      await mkdir(directory, { recursive: true });
      const temporary = path.join(
        directory,
        `.${path.basename(output.file)}.${process.pid}.${randomUUID()}.tmp`,
      );
      await writeFile(temporary, output.content, 'utf8');
      staged.push({ ...output, temporary });
    }

    for (const output of staged) {
      const backup = `${output.file}.${process.pid}.${randomUUID()}.bak`;
      let hadExisting = false;
      try {
        const info = await lstat(output.file);
        if (info.isSymbolicLink()) {
          throw new Error(`拒绝写入符号链接：${path.basename(output.file)}`);
        }
        await copyFile(output.file, backup);
        hadExisting = true;
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      if (hadExisting) backups.push({ file: output.file, backup });
      await rename(output.temporary, output.file);
      committed.push(output.file);
    }
  } catch (error) {
    for (const file of committed.reverse()) {
      const backup = backups.find((entry) => entry.file === file);
      if (backup) await rename(backup.backup, file).catch(() => {});
      else await rm(file, { force: true }).catch(() => {});
    }
    for (const entry of staged) await rm(entry.temporary, { force: true }).catch(() => {});
    for (const entry of backups) await rm(entry.backup, { force: true }).catch(() => {});
    throw error;
  }
  for (const entry of backups) await rm(entry.backup, { force: true }).catch(() => {});
}
