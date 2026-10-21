#!/usr/bin/env node
/**
 * 默认发布包安全门禁。
 *
 * 检查 dist 中是否意外包含真实 NEXUS 快照、提交 SHA、内部符号或源码路径。
 * 在 npm run build 之后执行；不要把真实数据放回 public/。
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DIST = path.join(ROOT, 'dist');

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

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

async function main() {
  try {
    await stat(DIST);
  } catch {
    console.error('[ATLAS] 安全门禁失败：dist 不存在，请先运行 npm run build。');
    process.exitCode = 1;
    return;
  }

  const files = await walk(DIST);
  const snapshots = files.filter((file) => file.endsWith('.atlas.json'));
  const findings = [];

  for (const file of files) {
    if (!/\.(?:html|js|css|json|map|txt)$/i.test(file)) continue;
    const relative = path.relative(DIST, file);
    const text = await readFile(file, 'utf8');
    for (const needle of FORBIDDEN) {
      if (text.includes(needle)) findings.push(`${relative}: 包含 ${needle}`);
    }
  }

  if (snapshots.length) {
    for (const snapshot of snapshots) findings.push(`${path.relative(DIST, snapshot)}: 真实快照被打包`);
  }

  const hasMark = files.some((file) => path.relative(DIST, file) === 'atlas-mark.svg');
  console.log(`[ATLAS] 检查 ${files.length} 个 dist 文件`);
  console.log(`[ATLAS] 真实快照文件：${snapshots.length}`);
  console.log(`[ATLAS] 静态图标：${hasMark ? '存在' : '缺失'}`);

  if (findings.length || !hasMark) {
    console.error('[ATLAS] 安全门禁失败：');
    for (const finding of findings) console.error(`  - ${finding}`);
    if (!hasMark) console.error('  - dist/atlas-mark.svg 缺失');
    process.exitCode = 1;
    return;
  }

  console.log('[ATLAS] 安全门禁通过：默认构建不含真实快照、提交 SHA 或内部源码定位。');
}

main().catch((error) => {
  console.error(`[ATLAS] 安全门禁异常：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
