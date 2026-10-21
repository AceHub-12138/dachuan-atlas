import { AtlasDataError, type AtlasDataset } from './schema.ts';
import { importAtlasDatasetText } from './dataset.ts';

/**
 * 浏览器端文件导入：只接受 ATLAS 标准数据。
 *
 * Graphify 原始 graph.json 的转换在本地 CLI 完成（npm run import:graphify）。
 * 这样公开前端不需要携带 NEXUS 的模块规则、中文注释或源码路径。
 */

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export interface ImportFile {
  name: string;
  text: string;
}

export interface ImportedArchitecture {
  dataset: AtlasDataset;
  fileNames: string[];
  warnings: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function importArchitectureFiles(files: ImportFile[]): ImportedArchitecture {
  if (!files.length) {
    throw new AtlasDataError('IMPORT_FILE_MISSING', '没有选择文件。');
  }
  for (const file of files) {
    const bytes = new TextEncoder().encode(file.text).length;
    if (bytes > MAX_IMPORT_BYTES) {
      throw new AtlasDataError('IMPORT_FILE_UNRECOGNIZED', `文件 ${file.name} 超过 50 MB，已拒绝导入。`);
    }
  }

  const jsonFiles = files.filter((file) => /\.json$/i.test(file.name));
  if (!jsonFiles.length) {
    throw new AtlasDataError(
      'IMPORT_FILE_UNRECOGNIZED',
      '没有选择 JSON 文件；请选择本地 ATLAS 标准数据（.atlas.json）。',
    );
  }

  for (const file of jsonFiles) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.text) as unknown;
    } catch {
      throw new AtlasDataError('ATLAS_INVALID_JSON', `${file.name} 不是合法 JSON。`);
    }
    if (isRecord(parsed) && parsed.schemaId === 'atlas.architecture') {
      return {
        dataset: importAtlasDatasetText(file.text),
        fileNames: [file.name],
        warnings: [],
      };
    }
  }

  throw new AtlasDataError(
    'IMPORT_FILE_UNRECOGNIZED',
    '没有识别到 ATLAS 标准数据。Graphify 原始图请先在本地运行 npm run import:graphify 转换，再导入生成的 .atlas.json。',
  );
}
