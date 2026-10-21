import { useCallback, useState } from 'react';
import { buildDemoDataset } from '../architecture/demo-dataset';
import { serializeAtlasDataset } from '../architecture/dataset';
import { importArchitectureFiles } from '../architecture/import-package';
import { AtlasDataError, type AtlasDataset } from '../architecture/schema.ts';

export type ArchitectureSource = 'demo' | 'nexus-snapshot';
export type ArchitectureStatus = 'ready' | 'loading' | 'error';

const DEMO_DATASET = buildDemoDataset();

export interface ArchitectureDataState {
  source: ArchitectureSource;
  dataset: AtlasDataset;
  status: ArchitectureStatus;
  error: string | null;
  importNotice: string | null;
  exportNotice: string | null;
  isFileImport: boolean;
  setSource: (source: ArchitectureSource) => void;
  importFiles: (files: File[]) => Promise<void>;
  exportDataset: () => void;
  requestImport: () => void;
}

function describeError(error: unknown): string {
  if (error instanceof AtlasDataError) {
    const detail = error.details.length ? `（${error.details[0]}）` : '';
    return `${error.message}${detail}`;
  }
  return '数据读取失败。演示数据仍可正常使用。';
}

function downloadText(text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportName(dataset: AtlasDataset): string {
  if (dataset.snapshot) {
    const date = (dataset.snapshot.generatedAt ?? dataset.snapshot.importedAt).slice(0, 10);
    return `nexus-${dataset.snapshot.commitShort}-${date}.atlas.json`;
  }
  return 'dachuan-atlas-demo.atlas.json';
}

export function useArchitectureData(): ArchitectureDataState {
  const [source, setSourceState] = useState<ArchitectureSource>('demo');
  const [dataset, setDataset] = useState<AtlasDataset>(DEMO_DATASET);
  const [status, setStatus] = useState<ArchitectureStatus>('ready');
  const [error, setError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [importedDataset, setImportedDataset] = useState<AtlasDataset | null>(null);

  const setSource = useCallback(
    (next: ArchitectureSource) => {
      setImportNotice(null);
      setExportNotice(null);
      if (next === 'demo') {
        setSourceState('demo');
        setDataset(DEMO_DATASET);
        setStatus('ready');
        setError(null);
        return;
      }
      if (importedDataset) {
        setSourceState('nexus-snapshot');
        setDataset(importedDataset);
        setStatus('ready');
        setError(null);
        return;
      }
      // 没有本地数据时不伪造真实来源；由面板触发明确的文件选择。
      window.dispatchEvent(new CustomEvent('atlas:request-import'));
    },
    [importedDataset],
  );

  const importFiles = useCallback(async (files: File[]) => {
    setImportNotice(null);
    setExportNotice(null);
    setStatus('loading');
    try {
      const payloads = await Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() })),
      );
      const imported = importArchitectureFiles(payloads);
      setImportedDataset(imported.dataset);
      setDataset(imported.dataset);
      setSourceState('nexus-snapshot');
      setStatus('ready');
      setError(null);
      const warnings = imported.warnings.length ? ` ${imported.warnings.join(' ')}` : '';
      setImportNotice(
        `已导入 ${imported.fileNames.join(' + ')}（本地文件，未上传）：${imported.dataset.nodes.length} 节点 / ${imported.dataset.relations.length} 关系。${warnings}`,
      );
    } catch (caught) {
      setError(describeError(caught));
      setStatus('error');
    }
  }, []);

  const exportDataset = useCallback(() => {
    const text = serializeAtlasDataset(dataset);
    downloadText(text, exportName(dataset));
    setExportNotice(`已导出 ${exportName(dataset)}。文件仅在本地生成。`);
  }, [dataset]);

  return {
    source,
    dataset,
    status,
    error,
    importNotice,
    exportNotice,
    isFileImport: importedDataset !== null,
    setSource,
    importFiles,
    exportDataset,
    requestImport: () => window.dispatchEvent(new CustomEvent('atlas:request-import')),
  };
}
