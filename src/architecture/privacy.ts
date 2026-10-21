import type { AtlasDataset } from './schema.ts';
import { normalizeRelativePath } from './paths.ts';

/**
 * 导出 / 导入前的隐私体检。
 *
 * 目标是发现“绝对路径、用户目录、凭据字段、内部工具目录”这类高风险内容；
 * 内部符号名与仓库相对路径是架构数据本身，导出时仍会保留，界面必须明确提示。
 */

export interface PrivacyFinding {
  code: 'absolute-path' | 'home-path' | 'credential-field' | 'tool-directory' | 'invalid-relative-path';
  field: string;
  message: string;
}

export interface PrivacyAudit {
  status: 'pass' | 'warn' | 'fail';
  findings: PrivacyFinding[];
  absolutePathCount: number;
  credentialFieldCount: number;
  internalSymbolCount: number;
}

const ABSOLUTE_PATTERNS: { code: PrivacyFinding['code']; regex: RegExp; label: string }[] = [
  { code: 'home-path', regex: /\/Users\/|\/home\/|C:\\Users\\|\\\\Users\\/i, label: '用户目录绝对路径' },
  { code: 'absolute-path', regex: /(^|[\s"'(])\/(?:private|var|opt|mnt|Volumes)\/|file:\/\//i, label: '绝对路径或 file://' },
  { code: 'tool-directory', regex: /graphify-poc|desktop\/codex|_desktop_/i, label: '内部工具目录' },
];

const CREDENTIAL_KEY = /(password|passwd|secret|authorization|cookie|access[_-]?token|api[_-]?key|private[_-]?key)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function scanStrings(value: unknown, field: string, findings: PrivacyFinding[]): void {
  if (typeof value === 'string') {
    for (const pattern of ABSOLUTE_PATTERNS) {
      if (pattern.regex.test(value)) {
        findings.push({ code: pattern.code, field, message: `${field} 含${pattern.label}特征。` });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanStrings(item, `${field}[${index}]`, findings));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (CREDENTIAL_KEY.test(key) && child !== null && child !== '') {
        findings.push({
          code: 'credential-field',
          field: `${field}.${key}`,
          message: `${field}.${key} 是凭据型字段，不应进入架构导出。`,
        });
      }
      scanStrings(child, `${field}.${key}`, findings);
    }
  }
}

function checkPath(value: unknown, field: string, findings: PrivacyFinding[]): void {
  if (typeof value !== 'string') return;
  if (!normalizeRelativePath(value).ok) {
    findings.push({
      code: 'invalid-relative-path',
      field,
      message: `${field} 不是仓库相对路径。`,
    });
  }
}

export function auditDatasetPrivacy(dataset: AtlasDataset): PrivacyAudit {
  const findings: PrivacyFinding[] = [];

  for (const [index, node] of dataset.nodes.entries()) {
    checkPath(node.sourceFile, `nodes[${index}].sourceFile`, findings);
    node.evidence.forEach((evidence, evidenceIndex) => {
      checkPath(evidence.file, `nodes[${index}].evidence[${evidenceIndex}].file`, findings);
    });
  }
  for (const [index, relation] of dataset.relations.entries()) {
    if (relation.evidence) {
      checkPath(relation.evidence.file, `relations[${index}].evidence.file`, findings);
    }
    relation.review.evidence.forEach((evidence, evidenceIndex) => {
      checkPath(evidence.file, `relations[${index}].review.evidence[${evidenceIndex}].file`, findings);
    });
  }
  for (const [moduleIndex, module] of dataset.modules.entries()) {
    module.keyComponents.forEach((component, componentIndex) => {
      checkPath(component.file, `modules[${moduleIndex}].keyComponents[${componentIndex}].file`, findings);
    });
    module.evidence.forEach((evidence, evidenceIndex) => {
      evidence.sourceRefs.forEach((ref, refIndex) => {
        checkPath(ref.file, `modules[${moduleIndex}].evidence[${evidenceIndex}].sourceRefs[${refIndex}].file`, findings);
      });
    });
  }

  scanStrings(dataset, 'dataset', findings);

  const deduped = [...new Map(findings.map((finding) => [`${finding.code}|${finding.field}`, finding])).values()];
  const absolutePathCount = deduped.filter(
    (finding) => finding.code === 'absolute-path' || finding.code === 'home-path' || finding.code === 'invalid-relative-path',
  ).length;
  const credentialFieldCount = deduped.filter((finding) => finding.code === 'credential-field').length;
  const internalSymbolCount = dataset.nodes.filter((node) => node.sourceFile !== null).length;

  return {
    status: absolutePathCount || credentialFieldCount ? 'fail' : deduped.length ? 'warn' : 'pass',
    findings: deduped,
    absolutePathCount,
    credentialFieldCount,
    internalSymbolCount,
  };
}
