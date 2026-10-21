/**
 * 跨平台路径与定位工具。这里不依赖 node:path，浏览器和 Node 共用同一套规则。
 * 所有进入 ATLAS 数据集的源码路径都会先经过 normalizeRelativePath 校验，
 * 绝对路径、盘符路径和 `..` 越界路径一律拒绝。
 */

export type PathNormalizeResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'empty' | 'absolute' | 'traversal' | 'invalid' };

const DRIVE_PREFIX = /^[a-zA-Z]:/;
const REPO_FILE_EXTENSION = /\.(?:ts|tsx|js|jsx|mjs|cjs|py|css|json|md|ya?ml|txt)$/i;

/**
 * 把 Windows / macOS 路径统一成 POSIX 相对路径。
 * 只接受仓库相对路径；绝对路径不会被“修好”，而是显式失败，避免把本机
 * 目录结构写进公开数据。
 */
export function normalizeRelativePath(input: unknown): PathNormalizeResult {
  if (typeof input !== 'string') return { ok: false, reason: 'invalid' };
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'empty' };

  const slashed = raw.replace(/\\/g, '/');
  if (slashed.startsWith('/') || slashed.startsWith('//')) return { ok: false, reason: 'absolute' };
  if (DRIVE_PREFIX.test(slashed)) return { ok: false, reason: 'absolute' };
  if (slashed.startsWith('~')) return { ok: false, reason: 'absolute' };
  if (slashed.includes('\0')) return { ok: false, reason: 'invalid' };
  if (slashed.includes(':')) return { ok: false, reason: 'invalid' };

  const withoutDot = slashed.replace(/^\.\//, '');
  const segments = withoutDot.split('/').filter((segment) => segment.length > 0);
  if (!segments.length) return { ok: false, reason: 'empty' };
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return { ok: false, reason: 'traversal' };
  }

  return { ok: true, path: segments.join('/') };
}

export function normalizePathOrThrow(input: string): string {
  const result = normalizeRelativePath(input);
  if (!result.ok) {
    throw new Error(`路径不是仓库相对路径（${result.reason}）`);
  }
  return result.path;
}

/** 只有带已知源码扩展名、且不是包名的引用才视为仓库文件。 */
export function isRepoFileReference(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  const normalized = normalizeRelativePath(input);
  if (!normalized.ok) return false;
  if (normalized.path.startsWith('@')) return false;
  return REPO_FILE_EXTENSION.test(normalized.path);
}

export function isPackageSpecifier(input: unknown): input is string {
  if (typeof input !== 'string') return false;
  const value = input.trim();
  if (!value) return false;
  if (value.startsWith('@')) return true;
  return !value.includes('/') && !REPO_FILE_EXTENSION.test(value);
}

/** Graphify 的 source_location 形如 L23、L23-L40，也可能缺失。 */
export function parseSourceLine(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) return Math.floor(input);
  if (typeof input !== 'string') return null;
  const match = input.match(/^L?(\d+)/);
  if (!match) return null;
  const line = Number.parseInt(match[1], 10);
  return Number.isFinite(line) && line > 0 ? line : null;
}

export function makeLocator(file: string | null, line: number | null): string {
  if (!file) return 'unknown';
  return line ? `${file}#L${line}` : file;
}

export function shortCommit(commit: string): string {
  return /^[0-9a-f]{7,40}$/i.test(commit) ? commit.slice(0, 7) : 'unknown';
}

export function isCommitSha(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);
}

/**
 * 外部节点标签可能由绝对路径 slug 化而来（例如 users_apple_desktop_...）。
 * 这类标签不进入公开数据集，避免泄露本机目录结构。
 */
export function looksLikePathDerivedLabel(value: string): boolean {
  const lower = value.toLowerCase();
  if (/^(?:users|home|private|var_folders|volumes|mnt|opt|tmp|applications|roots)_/.test(lower)) return true;
  if (/^[a-z]_(?:users|home)_/.test(lower)) return true;
  if (lower.includes('/users/') || lower.includes('\\users\\') || lower.includes('file://')) return true;
  if (lower.includes('_desktop_') || lower.includes('_documents_') || lower.includes('_downloads_')) return true;
  return false;
}

export const REDACTED_EXTERNAL_LABEL = '外部路径引用（已脱敏）';

export function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b), 'en'));
}
