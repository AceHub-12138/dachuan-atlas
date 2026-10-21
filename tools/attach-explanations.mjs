#!/usr/bin/env node
/**
 * 把本地维护的“为什么需要它”模块解释附加到 ATLAS 快照。
 *
 * 解释属于中文注释层，不是源码事实；它只存在于 local-data/，不进入默认
 * 构建。工具不接受没有审核记录的文本，也不会生成任何解释。
 *
 * 用法：
 *   node tools/attach-explanations.mjs \
 *     --dataset local-data/nexus/nexus-2026-10-20-2584284.atlas.json \
 *     --explanations local-data/nexus/explanations/module-explanations.json
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const MODULE_IDS = new Set(['data', 'voice', 'animation', 'canvas']);
const REVIEW_STATUS = new Set(['verified', 'partially_verified', 'unverified']);
const REVIEW_METHODS = new Set([
  'graphify-extracted',
  'graphify-inferred',
  'ai-source-review',
  'human-review',
  'unverified',
]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`参数 --${key} 缺少值。`);
    options[key] = value;
    index += 1;
  }
  return options;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} 必须是非空字符串。`);
  return value;
}

function validateReview(review, field) {
  if (!isRecord(review)) fail(`${field} 必须是对象。`);
  if (!REVIEW_STATUS.has(review.status)) fail(`${field}.status 非法。`);
  if (!REVIEW_METHODS.has(review.method)) fail(`${field}.method 非法。`);
  if (!Array.isArray(review.evidence)) fail(`${field}.evidence 必须是数组。`);
}

function validateExplanations(payload) {
  if (!isRecord(payload) || !isRecord(payload.modules)) {
    fail('解释文件必须包含 modules 对象。');
  }
  const result = {};
  for (const [moduleId, entry] of Object.entries(payload.modules)) {
    if (!MODULE_IDS.has(moduleId)) fail(`未知模块：${moduleId}。`);
    if (!isRecord(entry)) fail(`modules.${moduleId} 必须是对象。`);
    const whyNeeded = requireString(entry.whyNeeded, `modules.${moduleId}.whyNeeded`);
    validateReview(entry.review, `modules.${moduleId}.review`);
    result[moduleId] = { whyNeeded, review: entry.review };
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetPath = args.dataset
    ? path.resolve(ROOT, args.dataset)
    : path.join(ROOT, 'local-data/nexus/nexus-2026-10-20-2584284.atlas.json');
  const explanationsPath = args.explanations
    ? path.resolve(ROOT, args.explanations)
    : path.join(ROOT, 'local-data/nexus/explanations/module-explanations.json');
  const outPath = args.out ? path.resolve(ROOT, args.out) : datasetPath;

  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  if (!isRecord(dataset) || dataset.schemaId !== 'atlas.architecture') {
    fail('dataset 不是 ATLAS 标准数据。');
  }
  if (!Array.isArray(dataset.modules)) fail('dataset 缺少 modules。');
  const explanations = validateExplanations(
    JSON.parse(await readFile(explanationsPath, 'utf8')),
  );

  const modules = dataset.modules.map((module) => {
    const explanation = explanations[module.id];
    if (!explanation) return module;
    return { ...module, explanation };
  });

  // 附加解释材料不改变数据集 Schema 版本；保留原始版本，由导入层迁移。
  const next = {
    ...dataset,
    modules,
  };
  if (next.snapshot) {
    next.snapshot = {
      ...next.snapshot,
      notes: [
        ...(Array.isArray(next.snapshot.notes) ? next.snapshot.notes : []).filter(
          (note) => !note.startsWith('P1.3 本地附加模块解释'),
        ),
        'P1.3 本地附加模块“为什么需要它”解释；解释经过 AI 源码复核，不改变源码事实。',
      ],
    };
  }
  await writeFile(outPath, `${JSON.stringify(next)}\n`, 'utf8');
  console.log(
    `[P1.3] 已附加 ${Object.keys(explanations).length} 个模块解释到 ${path.relative(ROOT, outPath)}`,
  );
}

main().catch((error) => {
  console.error(`[P1.3] 模块解释附加失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
