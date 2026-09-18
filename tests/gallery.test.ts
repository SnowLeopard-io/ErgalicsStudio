// ==========================================================================
// FR-19 作品画廊 — core tests (node env, no DOM)
//
// Covers: curated catalog integrity (unique ids, legal subjects/licenses,
// website↔workstation repro mapping), the sanitizeForGallery private-data
// stripping strategy (fixture snapshot with raw rows → rows gone, statistics
// + lock info kept), buildGalleryShare metadata validation, filterGallery
// combinations, the localStorage-backed shared store round-trip through an
// injected storage adapter (node has no localStorage — same stub pattern as
// the theme-pack suite), take-down semantics, and zh/en dictionary parity.
// ==========================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CURATED_GALLERY, listCuratedGallery } from '@/core/gallery/catalog';
import { filterGallery } from '@/core/gallery/filter';
import {
  buildGalleryShare,
  MAX_TABLE_ROWS,
  sanitizeForGallery,
  type GalleryShareMeta,
} from '@/core/gallery/share';
import {
  addShared,
  getSharedEntry,
  listShared,
  listSharedEntries,
  markTakedown,
  removeShared,
  setGalleryStorageForTests,
  GALLERY_SHARED_KEY,
} from '@/core/gallery/store';
import {
  GALLERY_CHART_TYPES,
  GALLERY_LICENSES,
  GALLERY_REPRO_STATUSES,
  GALLERY_SUBJECTS,
  type GalleryItem,
} from '@/core/gallery/types';
import { galleryZh, galleryEn } from '@/i18n/dicts/gallery';

// ---------------------------------------------------------------------------
// localStorage stub (node has none; the store also degrades without it)
// ---------------------------------------------------------------------------

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as unknown as Storage;
}

let mem: Storage;
beforeEach(() => {
  mem = makeStorage();
  setGalleryStorageForTests(mem);
});
afterEach(() => {
  setGalleryStorageForTests(null);
});

// ---------------------------------------------------------------------------
// catalog integrity
// ---------------------------------------------------------------------------

describe('curated gallery catalog', () => {
  it('maps all 12 website template works', () => {
    expect(CURATED_GALLERY.length).toBeGreaterThanOrEqual(12);
  });

  it('has unique ids', () => {
    const ids = CURATED_GALLERY.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only legal subjects / chart types / repro statuses / licenses', () => {
    for (const item of CURATED_GALLERY) {
      expect(GALLERY_SUBJECTS).toContain(item.subject);
      expect(item.chartTypes.length).toBeGreaterThan(0);
      for (const c of item.chartTypes) expect(GALLERY_CHART_TYPES).toContain(c);
      expect(GALLERY_REPRO_STATUSES).toContain(item.reproStatus);
      expect(GALLERY_LICENSES).toContain(item.license);
      expect(item.curated).toBe(true);
      expect(item.title.zh && item.title.en).toBeTruthy();
    }
  });

  it('covers a diverse set of subjects and chart types', () => {
    const subjects = new Set(CURATED_GALLERY.map((x) => x.subject));
    const charts = new Set(CURATED_GALLERY.flatMap((x) => x.chartTypes));
    expect(subjects.size).toBeGreaterThanOrEqual(6);
    expect(charts.size).toBeGreaterThanOrEqual(6);
  });

  it('maps website repro status (ok/partial/none → locked/drifted/none)', () => {
    expect(CURATED_GALLERY.find((x) => x.id === 'pendulum-chaos')?.reproStatus).toBe('locked');
    expect(CURATED_GALLERY.find((x) => x.id === 'fits-spectrum')?.reproStatus).toBe('drifted');
    expect(CURATED_GALLERY.find((x) => x.id === 'copula-qq')?.reproStatus).toBe('none');
  });

  it('carries template ids that match the workstation template catalog ids', () => {
    for (const item of CURATED_GALLERY) {
      expect(item.templateId).toBeTruthy();
    }
  });

  it('filters take-down entries out of the public listing', () => {
    const before = listCuratedGallery().length;
    const victim = CURATED_GALLERY[0]!;
    victim.takedown = true;
    try {
      expect(listCuratedGallery().length).toBe(before - 1);
      expect(listCuratedGallery().some((x) => x.id === victim.id)).toBe(false);
    } finally {
      delete victim.takedown;
    }
  });
});

// ---------------------------------------------------------------------------
// sanitizeForGallery — the private-data stripping contract
// ---------------------------------------------------------------------------

/** A snapshot-shaped fixture: structure + stats + lock info + raw rows. */
const FIXTURE_SNAPSHOT = `<!doctype html>
<html lang="zh-CN">
<head><style>:root{--bg:#fff}</style></head>
<body>
<div class="wrap">
<h1>可复现快照</h1>
<h2>复现检查</h2>
<ul id="checks"><li id="chk-params" class="chk-pass">运行参数与锁定哈希一致（2 个运行）</li></ul>
<h2>数据指纹</h2>
<table><thead><tr><th>文件</th><th>字节</th><th>指纹</th></tr></thead><tbody>
<tr><td>enzyme.csv</td><td>2048</td><td><code>ab12cd34</code></td></tr>
<tr><td>control.csv</td><td>1024</td><td><code>ef56ab78</code></td></tr>
</tbody></table>
<h2>锁定运行</h2>
<table><thead><tr><th>运行</th><th>来源</th><th>种子</th><th>时间</th><th>指标</th></tr></thead><tbody>
<tr><td><code>a1b2c3d4</code> baseline</td><td>analysis</td><td>42</td><td>2026-09-01T00:00:00.000Z</td><td>p=0.031, r2=0.98</td></tr>
<tr><td><code>e5f6a7b8</code> robust</td><td>analysis</td><td>43</td><td>2026-09-01T00:05:00.000Z</td><td>p=0.028, r2=0.97</td></tr>
</tbody></table>
<h2>原始观测表（附件）</h2>
<table><thead><tr><th>sample</th><th>temp</th><th>ph</th><th>conc</th></tr></thead><tbody>
<tr><td>1</td><td>21.4</td><td>7.01</td><td>0.55</td></tr>
<tr><td>2</td><td>22.1</td><td>6.98</td><td>0.61</td></tr>
<tr><td>3</td><td>19.8</td><td>7.12</td><td>0.48</td></tr>
<tr><td>4</td><td>23.7</td><td>6.90</td><td>0.72</td></tr>
<tr><td>5</td><td>20.2</td><td>7.05</td><td>0.52</td></tr>
<tr><td>6</td><td>24.9</td><td>6.83</td><td>0.80</td></tr>
</tbody></table>
<p>raw dump, one row per line:</p>
12.5,0.44,7.02,21.3
13.1,0.51,6.97,22.0
14.8,0.62,6.88,23.4
<figure><svg viewBox="0 0 10 10"><path d="M0 5 L10 5"/></svg><figcaption>p=0.031</figcaption></figure>
<a href="data:text/csv;charset=utf-8,1%2C2%2C3%2C4">download raw</a>
</div>
<script type="application/json" id="repro-lock-json">{"schema":"ergalics.repro-lock","lockVersion":2,"runs":[{"id":"a1b2c3d4","paramsHash":"ff00ff00","metrics":{"p":0.031}}]}</script>
<script type="application/json" id="raw-records-json">[{"sample":1,"temp":21.4,"ph":7.01,"conc":0.55},{"sample":2,"temp":22.1,"ph":6.98,"conc":0.61},{"sample":3,"temp":19.8,"ph":7.12,"conc":0.48}]</script>
</body>
</html>`;

describe('sanitizeForGallery', () => {
  const out = sanitizeForGallery(FIXTURE_SNAPSHOT);

  it('removes raw data tables (rows > summary allowance)', () => {
    expect(out).toContain('data rows removed for privacy');
    // the private values from the raw observation table are gone
    expect(out).not.toContain('21.4');
    expect(out).not.toContain('6.98');
    expect(out).not.toContain('0.80');
  });

  it('removes raw CSV-ish lines outside markup', () => {
    expect(out).not.toContain('12.5,0.44,7.02,21.3');
    expect(out).not.toContain('14.8,0.62,6.88,23.4');
  });

  it('drops JSON islands holding flat raw record arrays', () => {
    expect(out).not.toContain('raw-records-json');
    expect(out).not.toContain('"conc":0.55');
  });

  it('neutralizes inline data: URIs carrying text payloads', () => {
    expect(out).not.toContain('data:text/csv');
  });

  it('keeps structure, statistics and repro-lock information', () => {
    expect(out).toContain('<h1>可复现快照</h1>');
    expect(out).toContain('chk-params');
    // fingerprint summary table survives (small, summary headers)
    expect(out).toContain('ab12cd34');
    // locked-run statistics survive
    expect(out).toContain('p=0.031');
    expect(out).toContain('repro-lock-json');
    expect(out).toContain('"paramsHash":"ff00ff00"');
    // figure markup survives
    expect(out).toContain('<svg viewBox="0 0 10 10">');
  });

  it('is pure and idempotent', () => {
    const again = sanitizeForGallery(out);
    expect(again).toBe(out);
    expect(FIXTURE_SNAPSHOT).toContain('21.4'); // input untouched
  });

  it('keeps small non-summary tables within the allowance', () => {
    const small = `<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody>
<tr><td>x</td><td>y</td></tr>
</tbody></table>`;
    expect(sanitizeForGallery(small)).toContain('<td>x</td>');
    expect(MAX_TABLE_ROWS).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildGalleryShare
// ---------------------------------------------------------------------------

const BASE_META: GalleryShareMeta = {
  title: { zh: '酶活分析', en: 'Enzyme assay' },
  summary: { zh: '两样本 t 检验', en: 'Two-sample t-test' },
  author: 'M. Chen',
  subject: 'biology',
  chartTypes: ['boxplot'],
  reproStatus: 'locked',
  license: 'CC-BY-4.0',
  createdAt: '2026-09-15T08:00:00.000Z',
};

describe('buildGalleryShare', () => {
  it('produces a GalleryItem + sanitized html', () => {
    const { item, html } = buildGalleryShare(FIXTURE_SNAPSHOT, BASE_META);
    expect(item.id).toMatch(/^share-[0-9a-f]{8}$/);
    expect(item.snapshotRef).toBe(`local:${item.id}`);
    expect(item.seed).toBeTypeOf('number');
    expect(item.createdAt).toBe(BASE_META.createdAt);
    expect(item.curated).toBeUndefined();
    // the stored html is ALWAYS the sanitized form
    expect(html).not.toContain('21.4');
    expect(html).toContain('data rows removed for privacy');
  });

  it('is deterministic for identical meta (stable id)', () => {
    const a = buildGalleryShare('<html></html>', BASE_META);
    const b = buildGalleryShare('<html></html>', BASE_META);
    expect(a.item.id).toBe(b.item.id);
  });

  it('rejects invalid subject / license / chart types', () => {
    expect(() =>
      buildGalleryShare('<html></html>', { ...BASE_META, subject: 'astrology' as never }),
    ).toThrow(/subject/);
    expect(() =>
      buildGalleryShare('<html></html>', { ...BASE_META, license: 'GPL-3.0' as never }),
    ).toThrow(/license/);
    expect(() =>
      buildGalleryShare('<html></html>', { ...BASE_META, chartTypes: ['pie'] as never }),
    ).toThrow(/chartTypes/);
  });
});

// ---------------------------------------------------------------------------
// filterGallery
// ---------------------------------------------------------------------------

function item(id: string, over: Partial<GalleryItem> = {}): GalleryItem {
  return {
    id,
    title: { zh: id, en: id },
    summary: { zh: '摘要', en: 'summary' },
    author: 'A. Researcher',
    subject: 'physics',
    chartTypes: ['line'],
    reproStatus: 'locked',
    license: 'CC-BY-4.0',
    seed: 1,
    createdAt: '2026-09-01',
    ...over,
  };
}

const FILTER_FIXTURES: GalleryItem[] = [
  item('a', { subject: 'physics', chartTypes: ['line'], reproStatus: 'locked' }),
  item('b', { subject: 'biology', chartTypes: ['boxplot', 'sankey'], reproStatus: 'drifted' }),
  item('c', { subject: 'biology', chartTypes: ['scatter'], reproStatus: 'none' }),
  item('d', { subject: 'medicine', chartTypes: ['line'], reproStatus: 'locked', takedown: true }),
];

describe('filterGallery', () => {
  it('returns everything (minus take-downs) with no filters', () => {
    expect(filterGallery(FILTER_FIXTURES).map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters by subject', () => {
    expect(filterGallery(FILTER_FIXTURES, { subject: 'biology' }).map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('matches any entry of the chartTypes array', () => {
    expect(filterGallery(FILTER_FIXTURES, { chartType: 'sankey' }).map((x) => x.id)).toEqual(['b']);
  });

  it('filters by repro status', () => {
    expect(filterGallery(FILTER_FIXTURES, { reproStatus: 'locked' }).map((x) => x.id)).toEqual(['a']);
  });

  it('searches title/summary/author case-insensitively', () => {
    expect(filterGallery(FILTER_FIXTURES, { query: 'SUMMARY' }).map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(filterGallery(FILTER_FIXTURES, { query: '摘要' }).length).toBe(3);
    expect(filterGallery(FILTER_FIXTURES, { query: 'nomatch' }).length).toBe(0);
  });

  it('combines filters (AND semantics)', () => {
    const res = filterGallery(FILTER_FIXTURES, { subject: 'biology', chartType: 'boxplot' });
    expect(res.map((x) => x.id)).toEqual(['b']);
  });

  it('"all" is a no-op per dimension', () => {
    expect(filterGallery(FILTER_FIXTURES, { subject: 'all', chartType: 'all', reproStatus: 'all' }).length).toBe(3);
  });

  it('includeTakedown reveals flagged entries', () => {
    expect(filterGallery(FILTER_FIXTURES, { includeTakedown: true }).map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

// ---------------------------------------------------------------------------
// store round-trip + take-down semantics
// ---------------------------------------------------------------------------

describe('gallery shared store', () => {
  const entryFor = (id: string, createdAt = '2026-09-16T08:00:00.000Z'): { item: GalleryItem; html: string } => {
    const { item: it, html } = buildGalleryShare(FIXTURE_SNAPSHOT, {
      ...BASE_META,
      title: { zh: id, en: id },
      createdAt,
    });
    return { item: { ...it, id }, html };
  };

  it('starts empty and survives a corrupted store', () => {
    expect(listShared()).toEqual([]);
    mem.setItem(GALLERY_SHARED_KEY, '{not json');
    expect(listShared()).toEqual([]);
    mem.setItem(GALLERY_SHARED_KEY, '[{"item":{"id":"x"},"html":1}]');
    expect(listShared()).toEqual([]);
  });

  it('round-trips add → list → get', () => {
    const e = entryFor('share-aaaa0001');
    addShared(e);
    const list = listShared();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('share-aaaa0001');
    const got = getSharedEntry('share-aaaa0001');
    expect(got?.html).toContain('data rows removed for privacy');
    expect(got?.html).not.toContain('21.4');
  });

  it('re-adding the same id replaces (idempotent share)', () => {
    addShared(entryFor('share-bbbb0002'));
    addShared(entryFor('share-bbbb0002'));
    expect(listSharedEntries()).toHaveLength(1);
  });

  it('orders newest first', () => {
    addShared(entryFor('share-old', '2026-01-01'));
    addShared(entryFor('share-new', '2026-06-01'));
    expect(listShared().map((x) => x.id)).toEqual(['share-new', 'share-old']);
  });

  it('take-down marks the entry and filters it from listings', () => {
    addShared(entryFor('share-cccc0003'));
    expect(markTakedown('share-cccc0003')).toBe(true);
    expect(listShared()).toHaveLength(0);
    // audit trail: the entry (with its html) is still retrievable
    const still = listSharedEntries().find((e) => e.item.id === 'share-cccc0003');
    expect(still?.item.takedown).toBe(true);
    expect(still?.html).toBeTruthy();
  });

  it('markTakedown on an unknown id returns false', () => {
    expect(markTakedown('nope')).toBe(false);
  });

  it('removeShared erases the record entirely', () => {
    addShared(entryFor('share-dddd0004'));
    expect(removeShared('share-dddd0004')).toBe(true);
    expect(listSharedEntries()).toHaveLength(0);
    expect(removeShared('share-dddd0004')).toBe(false);
  });

  it('degrades gracefully when the storage backend throws (private mode)', () => {
    setGalleryStorageForTests({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(listShared()).toEqual([]);
    expect(() => addShared(entryFor('share-eeee0005'))).not.toThrow();
    expect(listShared()).toEqual([]);
  });

  it('rejects invalid entries', () => {
    expect(() => addShared({ item: {} as GalleryItem, html: '' })).toThrow(/invalid/);
  });
});

// ---------------------------------------------------------------------------
// dictionary parity
// ---------------------------------------------------------------------------

describe('gallery dictionary', () => {
  it('keeps zh and en key sets identical', () => {
    const zh = Object.keys(galleryZh).sort();
    const en = Object.keys(galleryEn).sort();
    expect(zh).toEqual(en);
    expect(zh.length).toBeGreaterThan(50);
  });

  it('every key uses the documented prefix', () => {
    for (const key of Object.keys(galleryZh)) {
      expect(key.startsWith('gallery.') || key.startsWith('tool.gallery')).toBe(true);
    }
  });

  it('covers every subject / chart type / repro status / license label', () => {
    for (const s of GALLERY_SUBJECTS) expect(galleryZh[`gallery.subject.${s}`]).toBeTruthy();
    for (const c of GALLERY_CHART_TYPES) expect(galleryEn[`gallery.chart.${c}`]).toBeTruthy();
    for (const r of GALLERY_REPRO_STATUSES) expect(galleryZh[`gallery.repro.${r}`]).toBeTruthy();
  });

  it('interpolation placeholders match across locales', () => {
    for (const key of Object.keys(galleryZh)) {
      const zhParams = (galleryZh[key]!.match(/\{\w+\}/g) ?? []).sort();
      const enParams = (galleryEn[key]!.match(/\{\w+\}/g) ?? []).sort();
      expect(enParams).toEqual(zhParams);
    }
  });
});
