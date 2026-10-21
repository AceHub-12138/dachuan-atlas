import { describe, expect, it } from 'vitest';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';
import { serializeAtlasDataset } from '../../src/architecture/dataset';
import { importArchitectureFiles } from '../../src/architecture/import-package';

describe('浏览器端文件导入（仅 ATLAS 标准数据）', () => {
  it('导入 ATLAS 标准数据', () => {
    const demo = buildDemoDataset();
    const imported = importArchitectureFiles([
      { name: 'atlas.atlas.json', text: serializeAtlasDataset(demo) },
    ]);
    expect(imported.dataset.schemaId).toBe('atlas.architecture');
    expect(imported.dataset.nodes).toHaveLength(demo.nodes.length);
    expect(imported.fileNames).toEqual(['atlas.atlas.json']);
  });

  it('拒绝 Graphify 原始 graph.json，并提示先本地转换', () => {
    const graph = {
      graph: { schema_version: 1, graphify_version: '0.9.92' },
      nodes: [],
      links: [],
    };
    expect(() =>
      importArchitectureFiles([{ name: 'graph.json', text: JSON.stringify(graph) }]),
    ).toThrow(/npm run import:graphify/);
  });

  it('拒绝无法识别的文件', () => {
    expect(() =>
      importArchitectureFiles([{ name: 'notes.txt', text: 'hello' }]),
    ).toThrow(/请选择本地 ATLAS 标准数据/);
  });

  it('拒绝非法 JSON', () => {
    expect(() =>
      importArchitectureFiles([{ name: 'atlas.atlas.json', text: '{oops' }]),
    ).toThrow(/不是合法 JSON/);
  });

  it('导出后重新导入保持一致', () => {
    const imported = importArchitectureFiles([
      { name: 'atlas.atlas.json', text: serializeAtlasDataset(buildDemoDataset()) },
    ]);
    const exported = serializeAtlasDataset(imported.dataset);
    const reimported = importArchitectureFiles([{ name: 'roundtrip.atlas.json', text: exported }]);
    expect(reimported.dataset).toEqual(imported.dataset);
  });
});
