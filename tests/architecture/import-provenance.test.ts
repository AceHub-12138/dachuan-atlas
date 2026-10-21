import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  evaluateImportProvenance,
  parseGraphReport,
  readSnapshotManifest,
} from '../../src/architecture/import-provenance';

const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'crm-synthetic');
const rawManifest = JSON.parse(
  readFileSync(join(FIXTURE, 'snapshot-manifest.json'), 'utf8'),
) as Record<string, unknown>;
const reportText = readFileSync(join(FIXTURE, 'GRAPH_REPORT.md'), 'utf8');
const manifest = readSnapshotManifest(rawManifest, {
  expectedRepositoryId: 'crm',
  expectedSystem: 'crm',
});
const report = parseGraphReport(reportText)!;

function evaluate(overrides: Partial<Parameters<typeof evaluateImportProvenance>[0]> = {}) {
  return evaluateImportProvenance({
    declared: { repositoryId: 'crm', repositoryName: 'CRM', system: 'crm' },
    manifest,
    report,
    manifestVerified: true,
    reportPresent: true,
    ...overrides,
  });
}

describe('Graphify 三件套来源核对', () => {
  it('清单、报告与声明一致时返回 complete', () => {
    const provenance = evaluate();
    expect(provenance.complete).toBe(true);
    expect(provenance.commit).toBe('cafebabecafebabecafebabecafebabecafebabe');
    expect(provenance.commitSource).toBe('manifest');
    expect(provenance.repositoryId).toBe('crm');
    expect(provenance.repositoryIdentitySource).toBe('manifest');
    expect(provenance.generatedAt).toBe('2026-10-20');
    expect(provenance.scannedAt).toBe('2026-10-19T09:30:00Z');
    expect(provenance.issues.filter((issue) => issue.severity === 'warning')).toEqual([]);
  });

  it('报告解析只采用明确字段，不猜自然语言', () => {
    expect(report).toMatchObject({
      commit: 'cafebabecafebabecafebabecafebabecafebabe',
      repositoryId: 'crm',
      repositoryName: 'CRM Synthetic Fixture',
      scannedAt: '2026-10-19T09:30:00Z',
      generatedAt: '2026-10-20',
    });
    const fallback = parseGraphReport('# Report\nGenerated on 2026-10-20 (2026-10-20)\n');
    expect(fallback?.generatedAt).toBe('2026-10-20');
    expect(fallback?.commit).toBeNull();
    expect(fallback?.repositoryId).toBeNull();
    const shortCommit = parseGraphReport('Commit: cafebab\n');
    expect(shortCommit?.commit).toBeNull();
    expect(shortCommit?.notes.join(' ')).toContain('完整 40 位');
  });

  it('缺少清单时降级为 partial，提交只能来自报告且不完整', () => {
    const provenance = evaluate({ manifest: null, manifestVerified: false });
    expect(provenance.complete).toBe(false);
    expect(provenance.commitSource).toBe('report');
    const codes = provenance.issues.map((issue) => issue.code);
    expect(codes).toContain('MANIFEST_MISSING');
    expect(codes).toContain('COMMIT_REPORT_ONLY');
    expect(codes).toContain('REPOSITORY_IDENTITY_DECLARED_ONLY');
  });

  it('清单没有仓库身份时只算 declared，不能 complete', () => {
    const withoutRepository = readSnapshotManifest(
      { ...rawManifest, repository_id: undefined, repository: undefined },
      { expectedRepositoryId: 'crm', expectedSystem: 'crm' },
    );
    const provenance = evaluate({
      manifest: withoutRepository,
      report: { ...report, repositoryId: null },
    });
    expect(provenance.complete).toBe(false);
    expect(provenance.repositoryIdentitySource).toBe('declared');
    expect(provenance.issues.map((issue) => issue.code)).toContain(
      'REPOSITORY_IDENTITY_DECLARED_ONLY',
    );
  });

  it('缺少报告或清单未通过文件校验时不能 complete', () => {
    expect(evaluate({ reportPresent: false, report: null }).issues.map((issue) => issue.code)).toContain(
      'REPORT_MISSING',
    );
    const unverified = evaluate({ manifestVerified: false });
    expect(unverified.complete).toBe(false);
    expect(unverified.issues.map((issue) => issue.code)).toContain('MANIFEST_UNVERIFIED');

    const noMetadata = evaluate({
      report: {
        commit: null,
        repositoryId: null,
        repositoryName: null,
        scannedAt: null,
        generatedAt: null,
        notes: [],
      },
    });
    expect(noMetadata.complete).toBe(false);
    expect(noMetadata.issues.map((issue) => issue.code)).toContain('REPORT_NO_METADATA');
  });

  it('提交或仓库冲突是硬错误，不能被 partial 掩盖', () => {
    expect(() =>
      evaluate({ report: { ...report, commit: 'd'.repeat(40) } }),
    ).toThrow(/提交不一致/);

    expect(() =>
      evaluate({ report: { ...report, repositoryId: 'nexus' } }),
    ).toThrow(/仓库身份不一致/);

    expect(() =>
      evaluate({ expectedCommit: 'e'.repeat(40) }),
    ).toThrow(/提交不一致/);

    expect(() =>
      evaluate({ expectedCommit: 'not-a-sha' }),
    ).toThrow(/40 位/);

    expect(() =>
      evaluate({
        manifest: { ...manifest, system: 'nexus' },
      }),
    ).toThrow(/仓库系统不一致/);
  });

  it('清单中的无效 SHA、路径和计数被拒绝', () => {
    expect(() =>
      readSnapshotManifest({ ...rawManifest, commit: 'deadbeef' }, {
        expectedRepositoryId: 'crm',
        expectedSystem: 'crm',
      }),
    ).toThrow(/40 位/);

    expect(() =>
      readSnapshotManifest(
        {
          ...rawManifest,
          files: [{ path: '../outside.ts', sha256: 'a'.repeat(64) }],
          file_count: 1,
          byte_count: 1,
        },
        { expectedRepositoryId: 'crm', expectedSystem: 'crm' },
      ),
    ).toThrow(/仓库相对路径/);

    expect(() =>
      readSnapshotManifest(
        {
          ...rawManifest,
          files: [{ path: 'synthetic/a.ts', sha256: 'not-a-hash' }],
          file_count: 1,
          byte_count: 1,
        },
        { expectedRepositoryId: 'crm', expectedSystem: 'crm' },
      ),
    ).toThrow(/SHA-256/);

    expect(() =>
      readSnapshotManifest(
        { ...rawManifest, files: [], file_count: 3, byte_count: 0 },
        { expectedRepositoryId: 'crm', expectedSystem: 'crm' },
      ),
    ).toThrow(/清单自身不一致/);
  });

  it('生成时间或扫描时间冲突只降级为 partial，不伪造一致', () => {
    const generated = evaluate({
      report: { ...report, generatedAt: '2026-10-21' },
    });
    expect(generated.complete).toBe(false);
    expect(generated.issues.map((issue) => issue.code)).toContain(
      'PROVENANCE_GENERATED_AT_MISMATCH',
    );

    const scanned = evaluate({
      report: { ...report, scannedAt: '2026-10-19T10:00:00Z' },
    });
    expect(scanned.complete).toBe(false);
    expect(scanned.issues.map((issue) => issue.code)).toContain(
      'PROVENANCE_SCANNED_AT_MISMATCH',
    );
  });

  it('空清单不能算作完整校验', () => {
    const empty = readSnapshotManifest(
      { ...rawManifest, files: [], file_count: 0, byte_count: 0 },
      { expectedRepositoryId: 'crm', expectedSystem: 'crm' },
    );
    const provenance = evaluate({ manifest: empty, manifestVerified: true });
    expect(provenance.complete).toBe(false);
    expect(provenance.issues.map((issue) => issue.code)).toContain('MANIFEST_EMPTY');
  });
});
