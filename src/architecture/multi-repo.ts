import type {
  AtlasDataset,
  AtlasNode,
  AtlasRelation,
  AtlasRepositoryRecord,
  AtlasRepositorySnapshotRef,
} from './schema.ts';

/**
 * 多仓库接入的只读辅助层（P1.3）。
 *
 * 设计原则：
 * - 一个 AtlasDataset 仍然只描述一个仓库历史快照；
 * - 多个仓库由多个数据集表示，通过 repository/snapshotKey 建立索引；
 * - 不把不同仓库或不同进程的节点合并成一张“运行时图”；
 * - 跨仓库关系必须是显式的 cross-repository，并带接口/协议证据。
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
  return (dataset.repositories ?? []).map((repository) => ({
    repository,
    nodeCount: nodeCounts.get(repository.id) ?? 0,
    relationCount: repository.snapshots.reduce(
      (sum, snapshot) => sum + snapshot.relationCount,
      0,
    ),
    crossRepositoryRelations: crossRepositoryRelations(dataset).filter((relation) => {
      const from = dataset.nodes.find((node) => node.id === relation.from);
      return from?.repository === repository.id;
    }).length,
    crossProcessRelations: crossProcessRelations(dataset).filter((relation) => {
      const from = dataset.nodes.find((node) => node.id === relation.from);
      return from?.repository === repository.id;
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

export function crossProcessRelations(dataset: AtlasDataset): AtlasRelation[] {
  const nodeById = new Map(dataset.nodes.map((node) => [node.id, node]));
  return dataset.relations.filter((relation) => {
    if (relation.scope === 'cross-process') return true;
    const from = nodeById.get(relation.from);
    const to = nodeById.get(relation.to);
    if (!from || !to) return false;
    const known = (value: AtlasNode['runtimeBoundary']): boolean =>
      !!value && value !== 'unknown' && value !== 'shared';
    return known(from.runtimeBoundary) && known(to.runtimeBoundary) && from.runtimeBoundary !== to.runtimeBoundary;
  });
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
