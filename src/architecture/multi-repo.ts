import {
  isConfirmedCrossRepositoryRelation,
  type AtlasDataset,
  type AtlasRelation,
  type AtlasRepositoryRecord,
  type AtlasRepositorySnapshotRef,
} from './schema.ts';

/**
 * 多仓库接入的只读辅助层（P1.3）。
 *
 * 设计原则：
 * - 一个 AtlasDataset 仍然只描述一个主仓库历史快照；
 * - 多个仓库由多个数据集表示，通过 repository/snapshotKey 建立索引；
 * - 不把不同仓库或不同进程的节点合并成一张“运行时图”；
 * - 仓库维度（repositoryScope）与运行时维度（runtimeScope）分开统计，
 *   因此同一关系可以同时跨仓库和跨运行时；
 * - 未确认的跨仓库候选不进入已确认关系图。
 */

export interface RepositorySnapshotSummary extends AtlasRepositorySnapshotRef {
  repositoryId: string;
  repositoryName: string;
  system: AtlasRepositoryRecord['system'];
}

export interface RepositorySummary {
  repository: AtlasRepositoryRecord;
  nodeCount: number;
  relationCount: number;
  crossRepositoryRelations: number;
  crossProcessRelations: number;
}

export function repositorySummaries(dataset: AtlasDataset): RepositorySummary[] {
  const nodeCounts = new Map<string, number>();
  for (const node of dataset.nodes) {
    nodeCounts.set(node.repository, (nodeCounts.get(node.repository) ?? 0) + 1);
  }
  const confirmedCrossRepository = confirmedCrossRepositoryRelations(dataset);
  const crossRuntime = crossProcessRelations(dataset);
  const nodesById = new Map(dataset.nodes.map((node) => [node.id, node]));
  return (dataset.repositories ?? []).map((repository) => ({
    repository,
    nodeCount: nodeCounts.get(repository.id) ?? 0,
    relationCount: repository.snapshots.reduce(
      (sum, snapshot) => sum + snapshot.relationCount,
      0,
    ),
    crossRepositoryRelations: confirmedCrossRepository.filter((relation) => {
      return nodesById.get(relation.from)?.repository === repository.id;
    }).length,
    crossProcessRelations: crossRuntime.filter((relation) => {
      return nodesById.get(relation.from)?.repository === repository.id;
    }).length,
  }));
}

export function allSnapshotSummaries(dataset: AtlasDataset): RepositorySnapshotSummary[] {
  return (dataset.repositories ?? []).flatMap((repository) =>
    repository.snapshots.map((snapshot) => ({
      ...snapshot,
      repositoryId: repository.id,
      repositoryName: repository.name,
      system: repository.system,
    })),
  );
}

export function crossRepositoryRelations(dataset: AtlasDataset): AtlasRelation[] {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  return dataset.relations.filter((relation) => {
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    return !!from && !!to && from.repository !== to.repository;
  });
}

/**
 * 已确认的跨仓库关系：经过 AI/人工复核 + 带接口/协议证据。
 * 旧版迁移留下的未分类跨仓库边仍保留在数据集中，但不会出现在这里。
 */
export function confirmedCrossRepositoryRelations(dataset: AtlasDataset): AtlasRelation[] {
  return crossRepositoryRelations(dataset).filter(isConfirmedCrossRepositoryRelation);
}

/**
 * 跨运行时关系只由 runtimeScope 决定。runtimeScope=unknown 不参与，
 * 同仓库或跨仓库都可以是 cross-runtime。
 */
export function crossProcessRelations(dataset: AtlasDataset): AtlasRelation[] {
  return dataset.relations.filter((relation) => relation.runtimeScope === 'cross-runtime');
}

/** 同一仓库内但跨运行时的关系；用于证明“同 Git 仓库 ≠ 同运行时”。 */
export function intraRepositoryCrossProcessRelations(dataset: AtlasDataset): AtlasRelation[] {
  return crossProcessRelations(dataset).filter(
    (relation) => relation.repositoryScope === 'intra-repository',
  );
}

/** 同时跨仓库和跨运行时的关系；P1.4 修正后允许存在。 */
export function crossRepositoryCrossProcessRelations(dataset: AtlasDataset): AtlasRelation[] {
  return crossProcessRelations(dataset).filter(
    (relation) => relation.repositoryScope === 'cross-repository',
  );
}

export interface RelationScopeCounts {
  total: number;
  intraRepository: number;
  crossRepository: number;
  intraRuntime: number;
  crossRuntime: number;
  unknownRuntime: number;
  runtimeVerified: number;
}

export function relationScopeCounts(dataset: AtlasDataset): RelationScopeCounts {
  const counts: RelationScopeCounts = {
    total: dataset.relations.length,
    intraRepository: 0,
    crossRepository: 0,
    intraRuntime: 0,
    crossRuntime: 0,
    unknownRuntime: 0,
    runtimeVerified: 0,
  };
  for (const relation of dataset.relations) {
    if (relation.repositoryScope === 'cross-repository') counts.crossRepository += 1;
    else counts.intraRepository += 1;
    if (relation.runtimeScope === 'cross-runtime') counts.crossRuntime += 1;
    else if (relation.runtimeScope === 'intra-runtime') counts.intraRuntime += 1;
    else counts.unknownRuntime += 1;
    if (relation.runtimeVerified) counts.runtimeVerified += 1;
  }
  return counts;
}

/**
 * 按 repository + snapshotKey 建立索引。同一逻辑节点在不同历史快照中
 * 可以拥有相同 ID；同时存在时必须用 snapshotKey 区分，不能覆盖或合并。
 */
export function snapshotIndex(dataset: AtlasDataset): Map<string, RepositorySnapshotSummary> {
  const index = new Map<string, RepositorySnapshotSummary>();
  for (const summary of allSnapshotSummaries(dataset)) {
    index.set(summary.snapshotKey, summary);
  }
  return index;
}

/**
 * 当前数据集所描述快照的稳定标识。关系 ID 只在单个快照内唯一；
 * 多快照索引必须使用 `${snapshotKey}::${relation.id}`，不能只按 relation.id
 * 合并，否则同一仓库的两个提交会互相覆盖。
 */
export function datasetSnapshotKey(dataset: AtlasDataset): string | null {
  if (dataset.snapshot) {
    const repository = dataset.repositories?.find(
      (entry) => entry.id === dataset.snapshot?.repository.id,
    );
    const match = repository?.snapshots.find(
      (entry) =>
        entry.snapshotId === dataset.snapshot?.id &&
        entry.commit === dataset.snapshot?.commit,
    );
    if (match) return match.snapshotKey;
    return `${dataset.snapshot.repository.id}@${dataset.snapshot.commitShort}@${dataset.snapshot.generatedAt ?? 'unknown'}`;
  }
  return dataset.repositories?.[0]?.snapshots[0]?.snapshotKey ?? null;
}

export function scopedRelationId(dataset: AtlasDataset, relation: AtlasRelation): string {
  const snapshotKey = datasetSnapshotKey(dataset);
  return snapshotKey ? `${snapshotKey}::${relation.id}` : relation.id;
}

/** 按快照隔离的关系索引；不同快照的同名关系不会互相覆盖。 */
export function scopedRelationIndex(dataset: AtlasDataset): Map<string, AtlasRelation> {
  const index = new Map<string, AtlasRelation>();
  for (const relation of dataset.relations) {
    index.set(scopedRelationId(dataset, relation), relation);
  }
  return index;
}

export function nodeRepository(dataset: AtlasDataset, nodeId: string): string | null {
  return dataset.nodes.find((node) => node.id === nodeId)?.repository ?? null;
}

export function isMultiRepository(dataset: AtlasDataset): boolean {
  return new Set(dataset.nodes.map((node) => node.repository)).size > 1;
}

/**
 * 多数据集索引：未来 CRM / NEXUS / Electron 各自导入时，用这个结构
 * 生成仓库目录，而不是合并节点。返回的 snapshotKey 全局唯一。
 */
export function summarizeDatasetCollection(datasets: AtlasDataset[]): {
  repositories: RepositorySummary[];
  snapshots: RepositorySnapshotSummary[];
  duplicateSnapshotKeys: string[];
} {
  const summaries = datasets.flatMap((dataset) => repositorySummaries(dataset));
  const snapshots = datasets.flatMap((dataset) => allSnapshotSummaries(dataset));
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.snapshotKey)) duplicates.add(snapshot.snapshotKey);
    seen.add(snapshot.snapshotKey);
  }
  return {
    repositories: summaries,
    snapshots,
    duplicateSnapshotKeys: [...duplicates].sort(),
  };
}
