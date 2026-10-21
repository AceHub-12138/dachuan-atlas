import { describe, expect, it } from 'vitest';
import { adaptGraphify } from '../../src/architecture/graphify-adapter';
import { AtlasDataError } from '../../src/architecture/schema';

const COMMIT = '2584284e3e7b994d0510d9d53b2a302e3aa740bc';

const manifest = {
  repository: '/Users/example/Desktop/Codex/private-repo',
  commit: COMMIT,
  file_count: 3,
  byte_count: 100,
  files: [
    { path: 'src/lib/voice/a.ts', bytes: 10, sha256: 'a'.repeat(64) },
    { path: 'src/lib/voice/microphone.ts', bytes: 20, sha256: 'b'.repeat(64) },
    { path: 'src/components/screen/ScreenStage.tsx', bytes: 30, sha256: 'c'.repeat(64) },
  ],
};

function makeGraph() {
  return {
    directed: false,
    multigraph: true,
    graph: { schema_version: 1, graphify_version: '0.9.92' },
    nodes: [
      { id: 'src_lib_voice_a', label: 'a.ts', source_file: 'src/lib/voice/a.ts', source_location: 'L1', file_type: 'code', _origin: 'ast' },
      { id: 'src_lib_voice_a_foo', label: 'foo()', source_file: 'src/lib/voice/a.ts', source_location: 'L3', file_type: 'code', _callable: true, _origin: 'ast' },
      { id: 'src_lib_voice_a_helper', label: 'Helper', source_file: 'src/lib/voice/a.ts', source_location: 'L6', file_type: 'code', _callable: true, _callable_class: true, _origin: 'ast' },
      { id: 'src_lib_voice_a_helper_constructor', label: '.constructor()', source_file: 'src/lib/voice/a.ts', source_location: 'L8', file_type: 'code', _callable: true, _origin: 'ast' },
      { id: 'src_lib_voice_a_other_constructor', label: '.constructor()', source_file: 'src/lib/voice/a.ts', source_location: 'L20', file_type: 'code', _callable: true, _origin: 'ast' },
      { id: 'src_lib_voice_microphone_voicemicrophone', label: 'VoiceMicrophone', source_file: 'src/lib/voice/microphone.ts', source_location: 'L15', file_type: 'code', _callable: true, _callable_class: true, _origin: 'ast', community: 31 },
      { id: 'src_components_screen_motion_motiondirector_motiondirector', label: 'MotionDirector', source_file: 'src/components/screen/motion/MotionDirector.ts', source_location: 'L15', file_type: 'code', _callable: true, _callable_class: true, _origin: 'ast', community: 0 },
      { id: 'src_components_screen_screenstage_screenstage', label: 'ScreenStage()', source_file: 'src/components/screen/ScreenStage.tsx', source_location: 'L11', file_type: 'code', _callable: true, _origin: 'ast' },
      { id: 'src_components_overlay_jarviscore_jarviscore', label: 'JarvisCore', source_file: 'src/components/overlay/JarvisCore.tsx', source_location: 'L80', file_type: 'code', _callable: true, _origin: 'ast' },
      { id: 'src_components_screen_fittext_fittext', label: 'FitText()', source_file: 'src/components/screen/FitText.tsx', source_location: 'L35', file_type: 'code', _callable: true, _origin: 'ast', metadata: { unresolved_calls: [{ callee: 'observe', receiver_type: 'ResizeObserver', lang: 'typescript', line: 'L35' }] } },
      { id: 'src_lib_voice_a_docref', label: 'RFC-6455', source_file: 'src/lib/voice/a.ts', source_location: 'L2', file_type: 'concept', _origin: 'ast' },
      { id: 'bad_absolute', label: 'leak.ts', source_file: '/Users/example/secret/leak.ts', source_location: 'L1', file_type: 'code' },
      { id: 'bad_empty', label: '', source_file: 'src/lib/voice/a.ts', file_type: 'code' },
      { id: 'users_apple_desktop_private_secret', label: 'users_apple_desktop_private_secret', file_type: 'concept', external: true },
      { id: 'playwright_test', label: '@playwright/test', source_file: '@playwright/test', file_type: 'code', type: 'module' },
    ],
    links: [
      { source: 'src_lib_voice_a', target: 'src_lib_voice_a_foo', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/lib/voice/a.ts', source_location: 'L10', context: 'call' },
      { source: 'src_lib_voice_a', target: 'src_lib_voice_a_foo', relation: 'imports_from', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/lib/voice/a.ts', source_location: 'L2', context: 'import' },
      { source: 'src_lib_voice_a', target: 'src_lib_voice_a_foo', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/lib/voice/a.ts', source_location: 'L10', context: 'call' },
      { source: 'src_lib_voice_a_foo', target: 'src_lib_voice_a_foo', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/lib/voice/a.ts', source_location: 'L5' },
      { source: 'src_lib_voice_a', target: 'missing_node', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/lib/voice/a.ts' },
      { source: 'src_lib_voice_a_foo', target: 'src_lib_voice_a_other_constructor', relation: 'calls', confidence: 'INFERRED', confidence_score: 0.85, source_file: 'src/lib/voice/a.ts', source_location: 'L7', context: 'call' },
      { source: 'src_lib_voice_microphone_voicemicrophone', target: 'src_components_screen_motion_motiondirector_motiondirector', relation: 'references', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/lib/voice/microphone.ts', source_location: 'L2' },
      { source: 'src_components_screen_screenstage_screenstage', target: 'src_lib_voice_microphone_voicemicrophone', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/components/screen/ScreenStage.tsx', source_location: 'L15' },
      { source: 'src_components_overlay_jarviscore_jarviscore', target: 'src_lib_voice_microphone_voicemicrophone', relation: 'calls', confidence: 'EXTRACTED', confidence_score: 1, source_file: 'src/components/overlay/JarvisCore.tsx', source_location: 'L464' },
      { source: 'playwright_test', target: 'src_lib_voice_a', relation: 'imports', confidence: 'EXTRACTED', confidence_score: 1, source_file: '@playwright/test', source_location: 'L1' },
      { source: 'src_lib_voice_a', target: 'src_components_screen_fittext_fittext', relation: 'dynamic_import', confidence: 'AMBIGUOUS', source_file: 'src/lib/voice/a.ts', source_location: 'L30' },
    ],
  };
}

function adapt(graph = makeGraph()) {
  return adaptGraphify({
    graph,
    manifest,
    options: {
      generatedAt: '2026-10-20',
      importedAt: '2026-10-21T00:00:00.000Z',
      expectedCommit: COMMIT,
      repositoryId: 'nexus',
      repositoryName: 'NEXUS 可视化大屏',
      manifestVerification: {
        fileCount: 3,
        byteCount: 100,
        verifiedFiles: 3,
        verifiedAt: '2026-10-21T00:00:00.000Z',
      },
    },
  });
}

describe('Graphify → ATLAS 适配器', () => {
  it('保留节点规模并跳过无效节点与绝对路径', () => {
    const dataset = adapt();
    expect(dataset.nodes).toHaveLength(13);
    expect(dataset.diagnostics.counts.rawNodes).toBe(15);
    expect(dataset.nodes.some((node) => node.symbol === 'leak.ts')).toBe(false);
    expect(JSON.stringify(dataset)).not.toContain('/Users/');
    expect(JSON.stringify(dataset)).not.toContain('users_apple');
  });

  it('脱敏由绝对路径生成的外部标签', () => {
    const dataset = adapt();
    const redacted = dataset.nodes.find((node) => node.symbol.includes('已脱敏'));
    expect(redacted).toBeDefined();
    expect(redacted?.id).toBe('nexus:external#redacted-13');
    expect(redacted?.external).toBe(true);
    expect(dataset.snapshot?.stats.redactedLabels).toBe(1);
  });

  it('把包名识别为外部节点而不是仓库文件', () => {
    const dataset = adapt();
    const pkg = dataset.nodes.find((node) => node.symbol === '@playwright/test');
    expect(pkg?.sourceFile).toBeNull();
    expect(pkg?.scope).toBe('external');
    expect(pkg?.kind).toBe('external');
  });

  it('保留 EXTRACTED / INFERRED / AMBIGUOUS 状态', () => {
    const dataset = adapt();
    const inferred = dataset.relations.filter((relation) => relation.evidenceType === 'INFERRED');
    const ambiguous = dataset.relations.filter((relation) => relation.evidenceType === 'AMBIGUOUS');
    expect(inferred).toHaveLength(1);
    expect(inferred[0].confidence).toBe(0.85);
    expect(ambiguous).toHaveLength(1);
    expect(dataset.snapshot?.stats.extractedRelations).toBe(7);
  });

  it('保留多重关系，只合并完全重复的关系', () => {
    const dataset = adapt();
    const aToFoo = dataset.relations.filter(
      (relation) => relation.from.endsWith('#a.ts') && relation.to.endsWith('#foo()'),
    );
    expect(aToFoo.map((relation) => relation.type).sort()).toEqual(['calls', 'imports_from']);
    expect(dataset.snapshot?.stats.duplicateRelationsCollapsed).toBe(1);
    expect(dataset.snapshot?.stats.relations).toBe(9);
  });

  it('保留自调用并丢弃悬空关系', () => {
    const dataset = adapt();
    expect(dataset.snapshot?.stats.selfReferences).toBe(1);
    expect(dataset.relations.some((relation) => relation.selfReference)).toBe(true);
    expect(dataset.snapshot?.stats.danglingRelationsDropped).toBe(1);
  });

  it('为同名符号生成稳定的作用域逻辑 ID', () => {
    const dataset = adapt();
    const constructors = dataset.nodes.filter((node) => node.symbol === '.constructor()');
    expect(constructors).toHaveLength(2);
    expect(new Set(constructors.map((node) => node.id)).size).toBe(2);
    expect(constructors.some((node) => node.id.includes('#other.constructor()'))).toBe(true);
    expect(constructors.every((node) => !node.id.includes(COMMIT))).toBe(true);
  });

  it('按源码路径映射四个模块，Canvas 只做支撑归属', () => {
    const dataset = adapt();
    const voice = dataset.modules.find((module) => module.id === 'voice');
    const animation = dataset.modules.find((module) => module.id === 'animation');
    const canvas = dataset.modules.find((module) => module.id === 'canvas');
    const data = dataset.modules.find((module) => module.id === 'data');

    expect(voice?.stats.productNodes).toBe(8);
    expect(animation?.stats.productNodes).toBe(1);
    expect(data?.stats.productNodes).toBe(2);
    expect(canvas?.stats.productNodes).toBe(0);
    expect(canvas?.stats.supportingNodes).toBe(2);
    expect(canvas?.review).toBe('partially_verified');
    expect(canvas?.summary).toContain('不是一个独立业务子系统');
    expect(canvas?.keyComponents.length).toBeLessThanOrEqual(5);

    const stage = dataset.nodes.find((node) => node.symbol === 'ScreenStage()');
    expect(stage?.moduleId).toBe('data');
    expect(stage?.moduleIds).toContain('canvas');
  });

  it('中文注释只覆盖已人工核对的节点', () => {
    const dataset = adapt();
    const mic = dataset.nodes.find((node) => node.symbol === 'VoiceMicrophone');
    const foo = dataset.nodes.find((node) => node.symbol === 'foo()');
    expect(mic?.displayName).toBe('浏览器麦克风');
    expect(mic?.review.status).toBe('verified');
    expect(mic?.review.method).toBe('ai-source-review');
    expect(mic?.review.actor).toContain('DeepSeek');
    expect(mic?.review.evidence).toHaveLength(1);
    expect(foo?.displayName).toBeNull();
    expect(foo?.review.status).toBe('unverified');
    expect(foo?.review.method).toBe('graphify-extracted');
  });

  it('保留未落边的调用统计', () => {
    const dataset = adapt();
    expect(dataset.diagnostics.counts.unresolvedCalls).toBe(1);
    expect(dataset.diagnostics.unresolvedCallsByReceiver[0]).toEqual({ receiver: 'ResizeObserver', count: 1 });
    expect(dataset.nodes.find((node) => node.symbol === 'FitText()')?.metadata.unresolvedCalls).toHaveLength(1);
  });

  it('记录快照提交、生成时间与清单校验', () => {
    const dataset = adapt();
    expect(dataset.snapshot?.commit).toBe(COMMIT);
    expect(dataset.snapshot?.commitShort).toBe('2584284');
    expect(dataset.snapshot?.generatedAt).toBe('2026-10-20');
    expect(dataset.snapshot?.history).toBe(true);
    expect(dataset.snapshot?.importStatus).toBe('complete');
    expect(dataset.snapshot?.manifest?.verifiedFiles).toBe(3);
    expect(dataset.snapshot?.repository.name).toBe('NEXUS 可视化大屏');
    expect(JSON.stringify(dataset)).not.toContain('private-repo');
  });

  it('拒绝不兼容的 Graphify schema / 版本', () => {
    const wrongSchema = makeGraph();
    wrongSchema.graph.schema_version = 2;
    expect(() => adapt(wrongSchema)).toThrowError(AtlasDataError);

    const wrongVersion = makeGraph();
    wrongVersion.graph.graphify_version = '0.8.1';
    expect(() => adapt(wrongVersion)).toThrow(/0\.9\.x/);
  });

  it('拒绝缺失元数据、空图与提交不一致', () => {
    const missingMeta = makeGraph();
    // @ts-expect-error 测试故意破坏结构
    missingMeta.graph = undefined;
    expect(() => adapt(missingMeta)).toThrow(/元数据/);

    const empty = makeGraph();
    empty.nodes = [];
    expect(() => adapt(empty)).toThrow(/为空/);

    expect(() =>
      adaptGraphify({
        graph: makeGraph(),
        manifest,
        options: { expectedCommit: 'f'.repeat(40) },
      }),
    ).toThrow(/提交不一致/);
  });
});
