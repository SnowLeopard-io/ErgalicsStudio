// ==========================================================================
// Ergalics Studio — Lightweight Data File Profile Cache & Compatibility Check
//
// Computes and caches compact structural profiles (headers, inferred column
// types, row count, JSON root kind) keyed by FNV-1a content hash so the
// global "Data" modal can annotate every project file with schema
// compatibility badges (`compatible` | `needs_mapping` | `incompatible`)
// without repeatedly parsing large files.
// ==========================================================================

import type {
  CompatibilityAssessment,
  DataFileProfile,
  PluginDataSchema,
} from '@ergalics/plugin-sdk/types';
import { computeSourceColumnStats, parseRawTabularText, suggestColumnMapping } from './column-mapper';

const MAX_CACHE_ENTRIES = 256;
const profileCache = new Map<string, DataFileProfile>();

/** Fast deterministic FNV-1a 32-bit hex content hash. */
export function hashTextContent(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase();
}

/** Build or retrieve a cached structural profile for a text data file. */
export function profileDataFileText(fileName: string, text: string): DataFileProfile {
  const hash = hashTextContent(text);
  const ext = extensionOf(fileName);
  const cacheKey = `${ext}|${hash}`;
  const cached = profileCache.get(cacheKey);
  if (cached) return cached;

  let profile: DataFileProfile;
  const trimmed = text.trim();

  if (ext === '.json' || ext === '.geojson' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let jsonRootType: DataFileProfile['jsonRootType'] = undefined;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) jsonRootType = 'array';
      else if (typeof parsed === 'object' && parsed !== null) jsonRootType = 'object';
      else jsonRootType = 'primitive';
    } catch {
      // Malformed JSON still gets profiled as json kind with undefined rootType.
    }
    profile = { hash, kind: 'json', jsonRootType };
  } else if (['.csv', '.tsv', '.tab', '.dat', '.xyz', '.xy', '.xye', '.txt'].includes(ext)) {
    const parsed = parseRawTabularText(text);
    const stats = computeSourceColumnStats(parsed);
    const columnTypes: Record<string, string> = {};
    for (const s of stats) columnTypes[s.header] = s.inferredType;
    profile = {
      hash,
      kind: 'tabular',
      headers: parsed.headers,
      headerless: parsed.headerless,
      columnTypes,
      rowCount: parsed.rows.length,
    };
  } else {
    profile = { hash, kind: 'text', rowCount: trimmed ? trimmed.split(/\r?\n/).length : 0 };
  }

  if (profileCache.size >= MAX_CACHE_ENTRIES) {
    const oldest = profileCache.keys().next().value;
    if (oldest !== undefined) profileCache.delete(oldest);
  }
  profileCache.set(cacheKey, profile);
  return profile;
}

/** Clear cached profiles (primarily for tests). */
export function clearProfileCache(): void {
  profileCache.clear();
}

/**
 * Assess how compatible a project/example file is with a target plugin's
 * `PluginDataSchema`. Pure, fast, and never throws.
 */
export function assessFileCompatibility(
  fileName: string,
  text: string,
  schema: PluginDataSchema,
  locale = 'zh-CN',
): CompatibilityAssessment {
  const zh = locale.toLowerCase().startsWith('zh');
  const ext = extensionOf(fileName);
  const profile = profileDataFileText(fileName, text);

  if (schema.kind === 'binary') {
    const ok = schema.extensions.map((e) => e.toLowerCase()).includes(ext);
    return ok
      ? { level: 'compatible', score: 100 }
      : {
          level: 'incompatible',
          score: 0,
          reason: zh ? `需要格式：${schema.extensions.join(', ')}` : `Expected ${schema.extensions.join(', ')}`,
        };
  }

  if (schema.kind === 'json') {
    if (profile.kind !== 'json') {
      return {
        level: 'incompatible',
        score: 0,
        reason: zh ? '该插件需要 JSON 数据' : 'Plugin expects JSON data',
      };
    }
    if (!profile.jsonRootType) {
      return {
        level: 'incompatible',
        score: 10,
        reason: zh ? 'JSON 语法无效' : 'Invalid JSON syntax',
      };
    }
    const expectedRoot = schema.schema.type;
    if (typeof expectedRoot === 'string' && expectedRoot !== profile.jsonRootType) {
      return {
        level: 'incompatible',
        score: 20,
        reason: zh
          ? `期望根类型为 ${expectedRoot}，当前为 ${profile.jsonRootType}`
          : `Expected JSON ${expectedRoot}, got ${profile.jsonRootType}`,
      };
    }
    return { level: 'compatible', score: 90 };
  }

  if (schema.kind === 'text') {
    const extMatch = schema.extensions.map((e) => e.toLowerCase()).includes(ext);
    if (!extMatch) {
      return {
        level: 'incompatible',
        score: 0,
        reason: zh ? `期望扩展名：${schema.extensions.join(', ')}` : `Expected ${schema.extensions.join(', ')}`,
      };
    }
    return text.trim().length > 0
      ? { level: 'compatible', score: 90 }
      : { level: 'incompatible', score: 0, reason: zh ? '文件内容为空' : 'File is empty' };
  }

  // ---- Tabular compatibility ----
  if (profile.kind === 'json') {
    return {
      level: 'incompatible',
      score: 0,
      reason: zh ? '该插件需要表格数据（CSV/TSV/DAT）' : 'Plugin expects tabular data (CSV/TSV/DAT)',
    };
  }

  const parsed = parseRawTabularText(text, {
    delimiters: schema.delimiters,
    allowHeaderless: schema.allowHeaderless,
  });

  if (parsed.rows.length === 0) {
    return {
      level: 'incompatible',
      score: 0,
      reason: zh ? '表格没有数据行' : 'Table contains no data rows',
    };
  }

  if (schema.minRows !== undefined && parsed.rows.length < schema.minRows) {
    return {
      level: 'incompatible',
      score: 15,
      reason: zh
        ? `行数不足（当前 ${parsed.rows.length} 行，至少需要 ${schema.minRows} 行）`
        : `Too few rows (${parsed.rows.length}, need at least ${schema.minRows})`,
    };
  }

  const suggestion = suggestColumnMapping(parsed, schema);
  if (suggestion.missingRequired.length > 0) {
    return {
      level: 'incompatible',
      score: 25,
      missingRequired: suggestion.missingRequired,
      suggestedMapping: suggestion.mapping,
      reason: zh
        ? `缺少兼容的必填列：${suggestion.missingRequired.join('、')}`
        : `Missing compatible required column(s): ${suggestion.missingRequired.join(', ')}`,
    };
  }

  const reqScores = Object.values(suggestion.scores);
  const avgScore = reqScores.length
    ? Math.round(reqScores.reduce((a, b) => a + b, 0) / reqScores.length)
    : 80;

  if (suggestion.needsConfirmation || !suggestion.isExactHeaderMatch) {
    // High-confidence alias/headerless matches can still be loaded directly;
    // low-confidence ones show `needs_mapping`.
    if (!suggestion.needsConfirmation) {
      return {
        level: 'compatible',
        score: Math.min(100, avgScore),
        suggestedMapping: suggestion.mapping,
      };
    }
    return {
      level: 'needs_mapping',
      score: Math.min(84, avgScore),
      suggestedMapping: suggestion.mapping,
      reason: zh ? '列名不完全一致，加载时需确认列映射' : 'Headers differ; confirm column mapping on load',
    };
  }

  return {
    level: 'compatible',
    score: 100,
    suggestedMapping: suggestion.mapping,
  };
}
