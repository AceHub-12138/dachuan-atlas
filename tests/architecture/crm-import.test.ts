import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  adaptGraphifyWithProfile,
} from '../../src/architecture/graphify-adapter';
import {
  parseGraphReport,
  readSnapshotManifest,
  evaluateImportProvenance,
} from '../../src/architecture/import-provenance';
import { parseRepositoryProfile } from '../../src/architecture/repository-profile';
import { parseAtlasDataset, serializeAtlasDataset } from '../../src/architecture/dataset';
import { buildDemoDataset } from '../../src/architecture/demo-dataset';
import {
  assertSupportedUiDataset,
  importArchitectureFiles,
} from '../../src/architecture/import-package';
import { auditDatasetPrivacy } from '../../src/architecture/privacy';
import {
  confirmedCrossRepositoryRelations,
  relationScopeCounts,
} from '../../src/architecture/multi-repo';
import {
  aiReview,
  emptyReview,
  type AtlasDataset,
  type AtlasNode,
  type AtlasRelation,
} from '../../src/architecture/schema';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'crm-synthetic');
const NEXUS_COMMIT = 'b'.repeat(40);

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const graph = readJson(join(FIXTURE, 'graph.json')) as Record<string, unknown>;
const rawManifest = readJson(join(FIXTURE, 'snapshot-manifest.json')) as Record<string, unknown>;
const reportText = readFileSync(join(FIXTURE, 'GRAPH_REPORT.md'), 'utf8');
const profileRaw = readJson(join(FIXTURE, 'profile.json'));

function buildProfile(allowSynthetic = true) {
  return parseRepositoryProfile(profileRaw, {
    expectedRepositoryId: 'crm',
    expectedSystem: 'crm',
    allowSynthetic,
  });
}

function buildDataset(options: {
  manifest?: Record<string, unknown> | null;
  report?: string | null;
  manifestVerified?: boolean;
  importStatusOverride?: 'complete' | 'partial';
} = {}): AtlasDataset {
  const profile = buildProfile();
  const manifestRaw = options.manifest === undefined ? rawManifest : options.manifest;
  const report = options.report === undefined ? reportText : options.report;
  const manifest = manifestRaw
    ? readSnapshotManifest(manifestRaw, {
        expectedRepositoryId: 'crm',
        expectedSystem: 'crm',
      })
    : null;
  const provenance = evaluateImportProvenance({
    declared: {
      repositoryId: 'crm',
      repositoryName: profile.repository.name,
      system: 'crm',
    },
    manifest,
    report: parseGraphReport(report),
    manifestVerified: options.manifestVerified ?? Boolean(manifest),
    reportPresent: report !== null,
  });
  const dataset = adaptGraphifyWithProfile(
    {
      graph,
      manifest: manifestRaw,
      options: {
        repositoryId: 'crm',
        repositoryName: profile.repository.name,
        expectedRepositoryId: 'crm',
        commitOverride: provenance.commit === 'unknown' ? undefined : provenance.commit,
        generatedAt: provenance.generatedAt,
        scannedAt: provenance.scannedAt,
        importedAt: '2026-10-21T00:00:00.000Z',
        manifestVerification: manifest
          ? {
              fileCount: 8,
              byteCount: 2444,
              verifiedFiles: 8,
              verifiedAt: '2026-10-21T00:00:00.000Z',
            }
          : null,
        importStatusOverride:
          options.importStatusOverride ?? (provenance.complete ? 'complete' : 'partial'),
      },
    },
    profile,
  );
  return parseAtlasDataset(JSON.parse(serializeAtlasDataset(dataset)));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('CRM 合成快照导入（P2.0-A）', () => {
  it('正确导入并保留独立仓库、独立快照与独立模块', () => {
    const dataset = buildDataset();
    expect(dataset.nodes).toHaveLength(12);
    expect(dataset.relations).toHaveLength(14);
    expect(dataset.modules).toHaveLength(5);
    expect(dataset.snapshot?.repository.id).toBe('crm');
    expect(dataset.snapshot?.commit).toBe('cafebabecafebabecafebabecafebabecafebabe');
    expect(dataset.snapshot?.commitShort).toBe('cafebab');
    expect(dataset.snapshot?.generatedAt).toBe('2026-10-20');
    expect(dataset.snapshot?.importStatus).toBe('complete');
    expect(dataset.repositories?.[0]?.snapshots[0]?.snapshotKey).toBe(
      'crm@cafebab@2026-10-20',
    );
    expect(dataset.repositories?.[0]?.snapshots[0]?.scannedAt).toBe('2026-10-19T09:30:00Z');
    expect(dataset.source.label).toContain('合成验证');
    expect(dataset.snapshot?.notes.join(' ')).toContain('合成数据');
    expect(dataset.nodes.every((node) => node.repository === 'crm')).toBe(true);
    expect(dataset.nodes.every((node) => node.system === 'crm')).toBe(true);
    expect(dataset.modules.every((module) => module.repository === 'crm')).toBe(true);
    expect(dataset.modules.every((module) => module.system === 'crm')).toBe(true);
    expect(dataset.modules.every((module) => module.reviewRecord.method === 'unverified')).toBe(
      true,
    );
    expect(
      dataset.modules.every((module) => module.keyComponents.every((part) => part.review.method === 'unverified')),
    ).toBe(true);
    expect(dataset.modules.map((module) => module.id)).toEqual([
      'customer',
      'orders',
      'contracts',
      'receivables',
      'shipments',
    ]);
    expect(dataset.modules.some((module) => ['data', 'voice', 'animation', 'canvas'].includes(module.id))).toBe(false);
  });

  it('未匹配规则的节点保持未分类，不为了星图完整强行归类', () => {
    const dataset = buildDataset();
    const makeId = dataset.nodes.find((node) => node.symbol === 'makeId');
    const readConfig = dataset.nodes.find((node) => node.symbol === 'readConfig');
    const zod = dataset.nodes.find((node) => node.symbol === 'zod');
    expect(makeId?.moduleId).toBeNull();
    expect(makeId?.moduleIds).toEqual([]);
    expect(readConfig?.moduleId).toBeNull();
    expect(zod?.moduleId).toBeNull();
    expect(zod?.external).toBe(true);
    expect(dataset.diagnostics.counts.modulesAssigned).toBe(9);
    expect(dataset.diagnostics.counts.modulesUnassigned).toBe(2);
    expect(dataset.diagnostics.issues.some((issue) => issue.code === 'GRAPHIFY_MODULE_UNCLASSIFIED')).toBe(true);
    expect(dataset.diagnostics.issues.some((issue) => issue.code === 'IMPORT_SYNTHETIC_FIXTURE')).toBe(true);
  });

  it('没有 AI/人工复核清单时，所有关系保持待核实且不推断运行时', () => {
    const dataset = buildDataset();
    expect(dataset.relations.every((relation) => relation.runtimeScope === 'unknown')).toBe(true);
    expect(dataset.relations.every((relation) => relation.runtimeVerified === false)).toBe(true);
    expect(dataset.relations.every((relation) => relation.runtimeEvidence.length === 0)).toBe(true);
    expect(dataset.relations.every((relation) => relation.repositoryScope === 'intra-repository')).toBe(true);
    expect(dataset.relations.every((relation) => relation.interfaceEvidence.length === 0)).toBe(true);
    expect(dataset.relations.every((relation) => relation.review.status === 'unverified')).toBe(true);
    expect(dataset.diagnostics.reviewCounts.aiReviewed).toBe(0);
    expect(dataset.diagnostics.reviewCounts.humanReviewed).toBe(0);
    expect(relationScopeCounts(dataset)).toMatchObject({
      total: 14,
      crossRepository: 0,
      intraRuntime: 0,
      crossRuntime: 0,
      unknownRuntime: 14,
      runtimeVerified: 0,
    });
    expect(dataset.nodes.every((node) => node.displayName === null)).toBe(true);
  });

  it('重复关系保留为不同 ID，完全重复项合并，悬空关系跳过', () => {
    const dataset = buildDataset();
    const ids = dataset.relations.map((relation) => relation.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => id.endsWith(':calls~2'))).toBe(true);
    expect(dataset.snapshot?.stats.duplicateRelationsCollapsed).toBe(1);
    expect(dataset.snapshot?.stats.danglingRelationsDropped).toBe(1);
    expect(dataset.snapshot?.stats.selfReferences).toBe(1);
    expect(dataset.relations.some((relation) => relation.type === 'unknown')).toBe(true);
    expect(dataset.relations.filter((relation) => relation.evidenceType === 'INFERRED')).toHaveLength(1);
  });

  it('导出后重新导入保持一致，并通过隐私体检', () => {
    const dataset = buildDataset();
    const exported = serializeAtlasDataset(dataset);
    const reimported = parseAtlasDataset(JSON.parse(exported));
    expect(reimported).toEqual(dataset);
    expect(reimported.nodes).toHaveLength(12);
    expect(reimported.relations).toHaveLength(14);
    expect(auditDatasetPrivacy(dataset)).toMatchObject({
      status: 'pass',
      absolutePathCount: 0,
      credentialFieldCount: 0,
    });
  });

  it('缺少清单时只能得到 partial；清单与报告都缺失时提交为 unknown', () => {
    const missingManifest = buildDataset({ manifest: null });
    expect(missingManifest.snapshot?.manifest).toBeNull();
    expect(missingManifest.snapshot?.importStatus).toBe('partial');
    expect(missingManifest.snapshot?.commit).toBe('cafebabecafebabecafebabecafebabecafebabe');

    const provenance = evaluateImportProvenance({
      declared: { repositoryId: 'crm', repositoryName: 'CRM', system: 'crm' },
      manifest: null,
      report: parseGraphReport(reportText),
      manifestVerified: false,
      reportPresent: true,
    });
    expect(provenance.complete).toBe(false);
    expect(provenance.commitSource).toBe('report');
    expect(provenance.issues.map((issue) => issue.code)).toContain('MANIFEST_MISSING');
    expect(provenance.issues.map((issue) => issue.code)).toContain('COMMIT_REPORT_ONLY');

    const noEvidence = buildDataset({ manifest: null, report: null });
    expect(noEvidence.snapshot?.commit).toBe('unknown');
    expect(noEvidence.snapshot?.importStatus).toBe('partial');
    expect(noEvidence.repositories?.[0]?.snapshots[0]?.snapshotKey).toBe('crm@unknown@unknown');
  });

  it('无效 SHA、仓库不符和提交冲突都被拒绝', () => {
    expect(() =>
      readSnapshotManifest({ ...rawManifest, commit: 'cafebab' }, {
        expectedRepositoryId: 'crm',
        expectedSystem: 'crm',
      }),
    ).toThrow(/40 位/);

    expect(() =>
      readSnapshotManifest({ ...rawManifest, repository_id: 'nexus' }, {
        expectedRepositoryId: 'crm',
        expectedSystem: 'crm',
      }),
    ).toThrow(/拒绝把不同仓库/);

    const manifest = readSnapshotManifest(rawManifest, {
      expectedRepositoryId: 'crm',
      expectedSystem: 'crm',
    });
    expect(() =>
      evaluateImportProvenance({
        declared: { repositoryId: 'crm', repositoryName: 'CRM', system: 'crm' },
        manifest,
        report: { ...parseGraphReport(reportText)!, commit: 'd'.repeat(40) },
        manifestVerified: true,
        reportPresent: true,
      }),
    ).toThrow(/提交不一致/);
  });

  it('未知模块与重复关系 ID 在标准数据导入层被拒绝', () => {
    const dataset = buildDataset();

    const unknownModule = clone(dataset);
    unknownModule.nodes[0].moduleId = 'ghost';
    unknownModule.nodes[0].moduleIds = ['ghost'];
    expect(() => parseAtlasDataset(unknownModule)).toThrow(/引用了不存在的模块/);

    const duplicateRelation = clone(dataset);
    duplicateRelation.relations.push(clone(duplicateRelation.relations[0]));
    expect(() => parseAtlasDataset(duplicateRelation)).toThrow(/重复关系 ID/);
  });

  it('模块 profile 空时全部节点未分类，不借用 NEXUS 四模块', () => {
    const profile = parseRepositoryProfile(
      { ...(profileRaw as Record<string, unknown>), modules: [] },
      { expectedRepositoryId: 'crm', expectedSystem: 'crm', allowSynthetic: true },
    );
    const dataset = adaptGraphifyWithProfile(
      {
        graph,
        manifest: rawManifest,
        options: {
          repositoryId: 'crm',
          repositoryName: profile.repository.name,
          expectedRepositoryId: 'crm',
          generatedAt: '2026-10-20',
          importedAt: '2026-10-21T00:00:00.000Z',
          manifestVerification: {
            fileCount: 8,
            byteCount: 2444,
            verifiedFiles: 8,
            verifiedAt: '2026-10-21T00:00:00.000Z',
          },
          importStatusOverride: 'partial',
        },
      },
      profile,
    );
    const parsed = parseAtlasDataset(JSON.parse(serializeAtlasDataset(dataset)));
    expect(parsed.modules).toEqual([]);
    expect(parsed.nodes.every((node) => node.moduleId === null && node.moduleIds.length === 0)).toBe(true);
    expect(parsed.diagnostics.issues.some((issue) => issue.code === 'GRAPHIFY_MODULE_PROFILE_EMPTY')).toBe(true);
  });

  it('profile 校验拒绝复用 NEXUS 模块、伪造复核和空规则', () => {
    expect(() => buildProfile(false)).toThrow(/synthetic/);

    const reserved = clone(profileRaw) as Record<string, unknown>;
    (reserved.modules as Record<string, unknown>[])[0].id = 'voice';
    expect(() =>
      parseRepositoryProfile(reserved, {
        expectedRepositoryId: 'crm',
        expectedSystem: 'crm',
        allowSynthetic: true,
      }),
    ).toThrow(/不能复用/);

    const fakeReview = clone(profileRaw) as Record<string, unknown>;
    (fakeReview.modules as Record<string, unknown>[])[0].review = 'verified';
    expect(() =>
      parseRepositoryProfile(fakeReview, {
        expectedRepositoryId: 'crm',
        expectedSystem: 'crm',
        allowSynthetic: true,
      }),
    ).toThrow(/reviewMethod=unverified/);

    const emptyRule = clone(profileRaw) as Record<string, unknown>;
    const module = (emptyRule.modules as Record<string, unknown>[])[0];
    module.primaryPrefixes = [];
    module.primaryFiles = [];
    module.supportingFiles = [];
    module.evidence = [];
    expect(() =>
      parseRepositoryProfile(emptyRule, {
        expectedRepositoryId: 'crm',
        expectedSystem: 'crm',
        allowSynthetic: true,
      }),
    ).toThrow(/没有任何路径或职责证据/);

    const misleadingLabel = clone(profileRaw) as Record<string, unknown>;
    misleadingLabel.sourceLabel = 'CRM 生产快照';
    expect(() =>
      parseRepositoryProfile(misleadingLabel, {
        expectedRepositoryId: 'crm',
        expectedSystem: 'crm',
        allowSynthetic: true,
      }),
    ).toThrow(/必须明确标注/);
  });

  it('跨仓库关系缺少复核或接口证据时拒绝，证据齐全才进入已确认图', () => {
    const base = buildDataset();
    const altered = clone(base);
    const crmNode = altered.nodes.find((node) => node.symbol === 'createCustomer')!;
    const nexusNode: AtlasNode = {
      id: 'nexus:src/nexus-client.ts#NexusClient',
      sourceId: 'n_nexus_client',
      repository: 'nexus',
      system: 'nexus',
      kind: 'symbol',
      symbol: 'NexusClient',
      symbolType: 'class',
      sourceFile: 'src/nexus-client.ts',
      sourceLine: 1,
      scope: 'product',
      moduleId: null,
      moduleIds: [],
      displayName: null,
      responsibility: null,
      sourceConfidence: 'EXTRACTED',
      review: emptyReview('合成跨仓库节点', 'unverified', [], 'synthetic-fixture'),
      community: null,
      external: false,
      metadata: {},
      evidence: [
        {
          repository: 'nexus',
          commit: NEXUS_COMMIT,
          file: 'src/nexus-client.ts',
          line: 1,
          symbol: 'NexusClient',
          locator: 'src/nexus-client.ts#L1',
        },
      ],
    };
    altered.nodes.push(nexusNode);
    altered.repositories!.push({
      id: 'nexus',
      name: 'NEXUS 合成对照',
      system: 'nexus',
      snapshots: [
        {
          snapshotId: 'nexus-synthetic-对照',
          snapshotKey: 'nexus@bbbbbbb@2026-10-20',
          commit: NEXUS_COMMIT,
          commitShort: 'bbbbbbb',
          scannedAt: null,
          generatedAt: '2026-10-20',
          importedAt: '2026-10-21T00:00:00.000Z',
          graphifyVersion: '0.9.92',
          nodeCount: 1,
          relationCount: 1,
          history: true,
        },
      ],
    });

    const relation: AtlasRelation = {
      id: 'cross:crm->nexus',
      from: crmNode.id,
      to: nexusNode.id,
      type: 'calls',
      sourceRelation: 'calls',
      evidenceType: 'EXTRACTED',
      confidence: null,
      review: emptyReview('未确认候选', 'unverified', [], 'synthetic-fixture'),
      evidence: null,
      selfReference: false,
      context: null,
      repositoryScope: 'cross-repository',
      runtimeScope: 'unknown',
      runtimeVerified: false,
      runtimeEvidence: [],
      interfaceEvidence: [],
      legacyScope: null,
      scopeNote: '未确认候选；不得静默升级。',
      flags: { deferred: false, typeOnly: false },
      sourceIndex: 999,
    };
    altered.relations.push(relation);
    expect(() => parseAtlasDataset(altered)).toThrow(/尚未经过 AI 或人工复核/);

    const reviewed = clone(altered);
    reviewed.relations[reviewed.relations.length - 1].review = aiReview(
      '接口契约已核对',
      [],
      { actor: 'synthetic-fixture', reviewedAt: '2026-10-21' },
    );
    reviewed.relations[reviewed.relations.length - 1].evidence = {
      repository: 'crm',
      commit: base.snapshot!.commit,
      file: 'synthetic/customer/customer-service.ts',
      line: 24,
      symbol: 'createCustomer',
      locator: 'synthetic/customer/customer-service.ts#L24',
    };
    expect(() => parseAtlasDataset(reviewed)).toThrow(/必须提供 interfaceEvidence/);

    const confirmed = clone(reviewed);
    confirmed.relations[confirmed.relations.length - 1].interfaceEvidence = [
      {
        repository: 'nexus',
        commit: NEXUS_COMMIT,
        file: 'contracts/openapi.yaml',
        line: null,
        symbol: null,
        locator: 'contracts/openapi.yaml',
        kind: 'api-contract',
        note: '合成接口契约，仅用于验证证据门槛。',
      },
    ];
    const parsed = parseAtlasDataset(confirmed);
    expect(confirmedCrossRepositoryRelations(parsed)).toHaveLength(1);
    expect(confirmedCrossRepositoryRelations(base)).toHaveLength(0);
  });

  it('CRM 导入失败不会改写 NEXUS 历史快照或演示模式', () => {
    const nexusPath = join(
      process.cwd(),
      'local-data',
      'nexus',
      'nexus-2026-10-20-2584284.atlas.json',
    );
    const before = createHash('sha256').update(readFileSync(nexusPath)).digest('hex');
    expect(() =>
      parseAtlasDataset({
        ...(clone(buildDataset()) as unknown as Record<string, unknown>),
        relations: [
          ...(clone(buildDataset()).relations as unknown[]),
          clone(buildDataset()).relations[0],
        ],
      }),
    ).toThrow();
    const after = createHash('sha256').update(readFileSync(nexusPath)).digest('hex');
    expect(after).toBe(before);

    const nexus = parseAtlasDataset(JSON.parse(readFileSync(nexusPath, 'utf8')));
    expect(nexus.nodes).toHaveLength(1390);
    expect(nexus.relations).toHaveLength(3170);
    expect(() => assertSupportedUiDataset(nexus)).not.toThrow();

    const demo = parseAtlasDataset(JSON.parse(serializeAtlasDataset(buildDemoDataset())));
    expect(demo.modules).toHaveLength(4);
    expect(demo.source.kind).toBe('demo');
    expect(() => assertSupportedUiDataset(demo)).not.toThrow();

    const crm = buildDataset();
    const imported = importArchitectureFiles([
      { name: 'crm.atlas.json', text: serializeAtlasDataset(crm) },
    ]);
    expect(imported.dataset.nodes).toHaveLength(12);
    expect(() => assertSupportedUiDataset(imported.dataset)).toThrow(/当前界面只支持 NEXUS/);
  });
});
