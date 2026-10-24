// FR-17/FR-16 storage & worker-pool module dictionary (zh-CN / en-US).
// Keys use the `store2.` prefix so they never collide with the legacy
// `welcome.hardware.storage` / `error.storage_unavailable` catalogs.
// Merge into src/i18n/modules.ts (storageZh / storageEn).
import type { LocaleDictionary } from '../types';

export const storageZh: LocaleDictionary = {
  'store2.section_title': '存储',
  'store2.opfs_available': 'OPFS 可用（大文件将以私有文件系统分块存储）',
  'store2.opfs_unavailable': 'OPFS 不可用（将使用 IndexedDB 回退存储）',
  'store2.usage_total': '分块存储总用量',
  'store2.usage_idb': 'IndexedDB 分块',
  'store2.usage_opfs': 'OPFS 分块',
  'store2.clean_cache': '清理分块缓存',
  'store2.clean_cache_confirm': '将删除以下缓存内容，项目与插件不受影响：',
  'store2.clean_cache_items': 'IndexedDB 分块：{count} 条 / {bytes}；OPFS 文件：{files} 个 / {bytes2}',
  'store2.clean_cache_done': '分块缓存已清理',
  'store2.migrate': '迁移到 OPFS',
  'store2.migrate_progress': '迁移中… {done}/{total}',
  'store2.migrate_done': '迁移完成：{migrated} 个文件已迁移，{skipped} 个跳过',
  'store2.migrate_failed': '迁移：{failed} 个文件失败（原始数据已保留，可重试）',
  'store2.migrate_cancel': '取消迁移',
  'store2.migrate_cancelled': '迁移已中断，可随时继续',
  'store2.memory_hint': '文件过大，已超出内存软限制：请在设置中调低分块行数，或改用分块导入。',
  'store2.downsampled': '已降采样显示前 {n} 行，导出仍为全量',
  'store2.worker_pool': '解析工作线程数',
  'store2.chunk_rows': '分块导入行数',
  'store2.auto': '自动',
};

export const storageEn: LocaleDictionary = {
  'store2.section_title': 'Storage',
  'store2.opfs_available': 'OPFS available (large files are chunked into the private file system)',
  'store2.opfs_unavailable': 'OPFS unavailable (falling back to IndexedDB storage)',
  'store2.usage_total': 'Total chunk storage',
  'store2.usage_idb': 'IndexedDB chunks',
  'store2.usage_opfs': 'OPFS chunks',
  'store2.clean_cache': 'Clean chunk cache',
  'store2.clean_cache_confirm': 'The following cached data will be deleted; projects and plugins are unaffected:',
  'store2.clean_cache_items': 'IndexedDB chunks: {count} records / {bytes}; OPFS files: {files} files / {bytes2}',
  'store2.clean_cache_done': 'Chunk cache cleared',
  'store2.migrate': 'Migrate to OPFS',
  'store2.migrate_progress': 'Migrating… {done}/{total}',
  'store2.migrate_done': 'Migration finished: {migrated} migrated, {skipped} skipped',
  'store2.migrate_failed': 'Migration: {failed} files failed (source data kept — retry anytime)',
  'store2.migrate_cancel': 'Cancel migration',
  'store2.migrate_cancelled': 'Migration stopped — you can resume it later',
  'store2.memory_hint': 'File exceeded the soft memory limit: lower the chunk size in Settings or import in chunks.',
  'store2.downsampled': 'Showing the first {n} rows (downsampled); export keeps all rows',
  'store2.worker_pool': 'Parse worker threads',
  'store2.chunk_rows': 'Chunked import rows',
  'store2.auto': 'Auto',
};
