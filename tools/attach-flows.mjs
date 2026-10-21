#!/usr/bin/env node
/**
 * 把本地维护的流程场景附加到已有的 ATLAS 快照。
 *
 * 流程场景只存在于 local-data/，不进入 public/ 或默认构建。每一
 * 步都必须能在快照中找到对应的文件、符号和模块；找不到就拒绝写入，
 * 不允许用推测补全不存在的节点。
 *
 * 用法：
 *   node tools/attach-flows.mjs \
 *     --dataset local-data/nexus/nexus-2026-10-20-2584284.atlas.json \
 *     --flows local-data/nexus/flows/voice-request-to-overlay.flows.json
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

function validateRelativeFile(file, field) {
  requireString(file, field);
  const slashed = file.replace(/\\/g, '/');
  if (slashed.startsWith('/') || slashed.startsWith('~') || /^[a-zA-Z]:/.test(slashed)) {
    fail(`${field} 必须是仓库相对路径，不能是绝对路径。`);
  }
  if (slashed.split('/').some((segment) => segment === '..')) {
    fail(`${field} 不能包含 .. 越界路径。`);
  }
  return slashed;
}

function flowSymbolMatches(nodeSymbol, stepSymbol) {
  return (
    nodeSymbol === stepSymbol ||
    nodeSymbol === `${stepSymbol}()` ||
    nodeSymbol === `.${stepSymbol}()` ||
    nodeSymbol === `.${stepSymbol}`
  );
}

function validateReview(review, field) {
  if (!isRecord(review)) fail(`${field} 必须是对象。`);
  if (!REVIEW_STATUS.has(review.status)) fail(`${field}.status 非法。`);
  if (!REVIEW_METHODS.has(review.method)) fail(`${field}.method 非法。`);
  if (!Array.isArray(review.evidence)) fail(`${field}.evidence 必须是数组。`);
}

function validateFlows(payload, nodes) {
  if (!isRecord(payload) || !Array.isArray(payload.flows)) {
    fail('流程文件必须包含 flows 数组。');
  }
  const flowIds = new Set();
  return payload.flows.map((flow, flowIndex) => {
    if (!isRecord(flow)) fail(`flows[${flowIndex}] 必须是对象。`);
    const id = requireString(flow.id, `flows[${flowIndex}].id`);
    if (flowIds.has(id)) fail(`流程 ID 重复：${id}。`);
    flowIds.add(id);
    requireString(flow.title, `flows[${flowIndex}].title`);
    requireString(flow.summary, `flows[${flowIndex}].summary`);
    requireString(flow.disclaimer, `flows[${flowIndex}].disclaimer`);
    if (!MODULE_IDS.has(flow.entryModuleId)) fail(`flows[${flowIndex}].entryModuleId 非法。`);
    validateReview(flow.review, `flows[${flowIndex}].review`);
    if (!Array.isArray(flow.steps) || flow.steps.length < 2 || flow.steps.length > 12) {
      fail(`flows[${flowIndex}].steps 必须是 2–12 步。`);
    }
    const stepIds = new Set();
    const steps = flow.steps.map((step, stepIndex) => {
      const field = `flows[${flowIndex}].steps[${stepIndex}]`;
      if (!isRecord(step)) fail(`${field} 必须是对象。`);
      const stepId = requireString(step.id, `${field}.id`);
      if (stepIds.has(stepId)) fail(`流程 ${id} 的步骤 ID 重复：${stepId}。`);
      stepIds.add(stepId);
      requireString(step.title, `${field}.title`);
      requireString(step.description, `${field}.description`);
      requireString(step.note, `${field}.note`);
      if (!MODULE_IDS.has(step.moduleId)) fail(`${field}.moduleId 非法。`);
      const file = validateRelativeFile(step.file, `${field}.file`);
      const symbol = requireString(step.symbol, `${field}.symbol`);
      if (step.line !== null && (!Number.isInteger(step.line) || step.line <= 0)) {
        fail(`${field}.line 必须是正整数或 null。`);
      }
      const node = nodes.find(
        (candidate) =>
          candidate.sourceFile === file &&
          flowSymbolMatches(candidate.symbol, symbol) &&
          Array.isArray(candidate.moduleIds) &&
          candidate.moduleIds.includes(step.moduleId),
      );
      if (!node) {
        fail(`${field} 指向快照中不存在的节点：${file}#${symbol}（${step.moduleId}）。`);
      }
      if (step.line !== null && node.sourceLine !== null && step.line !== node.sourceLine) {
        fail(`${field}.line=${step.line} 与快照节点行号 ${node.sourceLine} 不一致。`);
      }
      return { ...step, file, symbol };
    });
    return { ...flow, steps };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const datasetPath = args.dataset
    ? path.resolve(ROOT, args.dataset)
    : path.join(ROOT, 'local-data/nexus/nexus-2026-10-20-2584284.atlas.json');
  const flowsPath = args.flows
    ? path.resolve(ROOT, args.flows)
    : path.join(ROOT, 'local-data/nexus/flows/voice-request-to-overlay.flows.json');
  const outPath = args.out ? path.resolve(ROOT, args.out) : datasetPath;

  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  if (!isRecord(dataset) || dataset.schemaId !== 'atlas.architecture') {
    fail('dataset 不是 ATLAS 标准数据。');
  }
  if (!Array.isArray(dataset.nodes)) fail('dataset 缺少 nodes。');
  const payload = JSON.parse(await readFile(flowsPath, 'utf8'));
  const flows = validateFlows(payload, dataset.nodes);

  const next = {
    ...dataset,
    schemaVersion: '1.2.0',
    flows,
  };
  if (next.snapshot) {
    next.snapshot = {
      ...next.snapshot,
      atlasSchemaVersion: '1.2.0',
      notes: [
        ...(Array.isArray(next.snapshot.notes) ? next.snapshot.notes : []).filter(
          (note) => !note.startsWith('P1.2 本地附加流程场景'),
        ),
        `P1.2 本地附加流程场景 ${flows.length} 个；仅引用快照已有节点，未重新扫描源码。`,
      ],
    };
  }
  await writeFile(outPath, `${JSON.stringify(next)}\n`, 'utf8');
  console.log(
    `[P1.2] 已附加 ${flows.length} 个流程场景、${flows.reduce((sum, flow) => sum + flow.steps.length, 0)} 个步骤到 ${path.relative(ROOT, outPath)}`,
  );
}

main().catch((error) => {
  console.error(`[P1.2] 流程场景附加失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
