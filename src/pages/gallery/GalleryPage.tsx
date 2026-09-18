// ==========================================================================
// FR-19 作品画廊 — workstation gallery page (ToolShell)
//
// Two tabs: the built-in curated catalog (mirrors the website gallery) and
// "My shares" (local localStorage records from the Share dialog). The filter
// bar (subject / chart type / repro status / search) drives the pure
// `filterGallery` helper; all presentation logic stays here.
//
// Detail modal: bilingual summary + metadata + license, "View snapshot"
// (opens the stored sanitized HTML in a new window via a Blob URL), "Open in
// Ergalics" (FR-01 template deep link through loadTemplate) and the
// take-down flow (confirm modal → store.markTakedown, filtered from lists).
// ==========================================================================

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT, useLocale } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { Modal } from '@/components/Modal';
import { EmptyState } from '@/components/EmptyState';
import { pickLocale, loadTemplate } from '@/core/templates';
import { useAppStore } from '@/stores/appStore';
import { listCuratedGallery } from '@/core/gallery/catalog';
import { filterGallery, type GalleryFilter } from '@/core/gallery/filter';
import {
  getSharedEntry,
  listSharedEntries,
  markTakedown,
  removeShared,
} from '@/core/gallery/store';
import {
  GALLERY_CHART_TYPES,
  GALLERY_REPRO_STATUSES,
  GALLERY_SUBJECTS,
  type GalleryItem,
} from '@/core/gallery/types';

type Tab = 'curated' | 'mine';

// ---------------------------------------------------------------------------
// Lightweight deterministic cover art (same spirit as the website CoverArt,
// trimmed to the shapes we actually need; decorative → aria-hidden).
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COVER_PALETTE = ['#2dd4bf', '#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399'];

function GalleryCover({ seed, kind }: { seed: number; kind: string }) {
  const art = useMemo(() => {
    const r = mulberry32(seed * 7919 + kind.length * 31);
    const c = () => COVER_PALETTE[Math.floor(r() * COVER_PALETTE.length)];
    if (kind === 'scatter' || kind === 'qq' || kind === 'pointcloud') {
      const pts = Array.from({ length: 40 }, () => ({ x: 6 + r() * 88, y: 8 + r() * 84, s: 1 + r() * 2.4 }));
      return (
        <g>
          {pts.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={p.s} fill={c()} opacity={0.85} />
          ))}
        </g>
      );
    }
    if (kind === 'histogram' || kind === 'boxplot') {
      const bars = Array.from({ length: 12 }, (_, i) => ({ x: 5 + i * 7.6, h: 14 + r() * 72 }));
      return (
        <g>
          {bars.map((b, i) => (
            <rect key={i} x={b.x} y={100 - b.h} width={5.6} height={b.h} rx={1} fill={c()} opacity={0.85} />
          ))}
        </g>
      );
    }
    if (kind === 'heatmap') {
      const cells = [];
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 10; gx++) {
          cells.push(
            <rect key={`${gx}-${gy}`} x={5 + gx * 9} y={10 + gy * 16} width={8} height={14} rx={1} fill={c()} opacity={0.25 + r() * 0.7} />,
          );
        }
      }
      return <g>{cells}</g>;
    }
    // line / surface / contour / sankey / default — flowing paths
    const paths = Array.from({ length: 3 }, (_, i) => {
      const pts: string[] = [];
      let y = 30 + r() * 40;
      for (let x = 0; x <= 100; x += 5) {
        y += (r() - 0.5) * 18;
        y = Math.max(8, Math.min(92, y));
        pts.push(`${x},${y}`);
      }
      return { d: 'M' + pts.join(' L'), color: c(), w: 2 - i * 0.4 };
    });
    return (
      <g>
        {paths.map((p, i) => (
          <path key={i} d={p.d} fill="none" stroke={p.color} strokeWidth={p.w} strokeLinecap="round" />
        ))}
      </g>
    );
  }, [seed, kind]);

  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" preserveAspectRatio="none" className="gallery-cover">
      <rect width="100" height="100" className="gallery-cover-bg" />
      {art}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function GalleryPage() {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const notify = useAppStore((s) => s.notify);

  const [tab, setTab] = useState<Tab>('curated');
  const [filter, setFilter] = useState<GalleryFilter>({});
  const [detail, setDetail] = useState<GalleryItem | null>(null);
  const [confirmTakedown, setConfirmTakedown] = useState<GalleryItem | null>(null);
  const [showTakenDown, setShowTakenDown] = useState(false);
  /** Bumped after every store mutation so the local list re-reads. */
  const [refresh, setRefresh] = useState(0);

  const sharedItems = useMemo(() => listSharedEntries().map((e) => e.item), [refresh]);
  const sourceItems = tab === 'curated' ? listCuratedGallery() : sharedItems;
  const items = useMemo(
    () => filterGallery(sourceItems, { ...filter, includeTakedown: showTakenDown }),
    [sourceItems, filter, showTakenDown],
  );

  const set = <K extends keyof GalleryFilter>(key: K, value: GalleryFilter[K]) =>
    setFilter((f) => ({ ...f, [key]: value }));

  const openSnapshot = (item: GalleryItem) => {
    const entry = getSharedEntry(item.id);
    if (!entry) {
      notify('info', t('gallery.snapshot_missing'));
      return;
    }
    const url = URL.createObjectURL(new Blob([entry.html], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };

  const openInErgalics = async (item: GalleryItem) => {
    if (!item.templateId) {
      notify('info', t('gallery.open_no_template'));
      return;
    }
    const result = await loadTemplate(item.templateId);
    if (result.ok) {
      setDetail(null);
      navigate(result.route);
    } else {
      notify('error', t('gallery.open_failed', { error: result.error }));
    }
  };

  const doTakedown = (item: GalleryItem) => {
    if (item.curated) {
      notify('info', t('gallery.takedown_curated'));
      return;
    }
    setConfirmTakedown(item);
  };

  const confirmTakedownNow = () => {
    if (!confirmTakedown) return;
    markTakedown(confirmTakedown.id);
    setConfirmTakedown(null);
    setDetail(null);
    setRefresh((n) => n + 1);
    notify('success', t('gallery.takedown_done'));
  };

  const deleteRecord = (item: GalleryItem) => {
    removeShared(item.id);
    setDetail(null);
    setRefresh((n) => n + 1);
    notify('success', t('gallery.delete_done'));
  };

  const emptyState =
    tab === 'mine' && listSharedEntries().length === 0 ? (
      <EmptyState
        title={t('gallery.mine.empty_title')}
        description={t('gallery.mine.empty_desc')}
        actions={
          <button type="button" className="btn btn-sm" onClick={() => navigate('/workbench')}>
            {t('figure.back')}
          </button>
        }
      />
    ) : items.length === 0 ? (
      <EmptyState
        title={t('gallery.empty.filtered_title')}
        description={t('gallery.empty.filtered_desc')}
        actions={
          <button type="button" className="btn btn-sm" onClick={() => setFilter({})}>
            {t('gallery.filter.reset')}
          </button>
        }
      />
    ) : null;

  return (
    <ToolShell toolId="gallery" title={t('gallery.title')}>
      <div className="gallery-body">
        {/* ---- Tabs ---- */}
        <div className="gallery-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'curated'}
            className={`gallery-tab ${tab === 'curated' ? 'is-active' : ''}`}
            onClick={() => setTab('curated')}
          >
            {t('gallery.tab.curated')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'mine'}
            className={`gallery-tab ${tab === 'mine' ? 'is-active' : ''}`}
            onClick={() => setTab('mine')}
          >
            {t('gallery.tab.mine')}
          </button>
        </div>

        <p className="gallery-privacy">{t('gallery.privacy_note')}</p>

        {/* ---- Filter bar ---- */}
        <div className="gallery-filters">
          <label className="analysis-label" htmlFor="gallery-filter-subject">
            {t('gallery.filter.subject')}
          </label>
          <select
            id="gallery-filter-subject"
            className="input"
            value={filter.subject ?? 'all'}
            onChange={(e) => set('subject', e.target.value as GalleryFilter['subject'])}
          >
            <option value="all">{t('gallery.filter.all')}</option>
            {GALLERY_SUBJECTS.map((s) => (
              <option key={s} value={s}>
                {t(`gallery.subject.${s}`)}
              </option>
            ))}
          </select>

          <label className="analysis-label" htmlFor="gallery-filter-chart">
            {t('gallery.filter.chartType')}
          </label>
          <select
            id="gallery-filter-chart"
            className="input"
            value={filter.chartType ?? 'all'}
            onChange={(e) => set('chartType', e.target.value as GalleryFilter['chartType'])}
          >
            <option value="all">{t('gallery.filter.all')}</option>
            {GALLERY_CHART_TYPES.map((c) => (
              <option key={c} value={c}>
                {t(`gallery.chart.${c}`)}
              </option>
            ))}
          </select>

          <label className="analysis-label" htmlFor="gallery-filter-repro">
            {t('gallery.filter.reproStatus')}
          </label>
          <select
            id="gallery-filter-repro"
            className="input"
            value={filter.reproStatus ?? 'all'}
            onChange={(e) => set('reproStatus', e.target.value as GalleryFilter['reproStatus'])}
          >
            <option value="all">{t('gallery.filter.all')}</option>
            {GALLERY_REPRO_STATUSES.map((r) => (
              <option key={r} value={r}>
                {t(`gallery.repro.${r}`)}
              </option>
            ))}
          </select>

          <input
            className="input gallery-search"
            type="search"
            aria-label={t('gallery.filter.query')}
            placeholder={t('gallery.filter.query_placeholder')}
            value={filter.query ?? ''}
            onChange={(e) => set('query', e.target.value)}
          />
        </div>

        <div className="gallery-list-head">
          <span className="analysis-note">{t('gallery.count', { n: items.length })}</span>
          {tab === 'mine' && (
            <label className="gallery-show-td">
              <input
                type="checkbox"
                checked={showTakenDown}
                onChange={(e) => setShowTakenDown(e.target.checked)}
              />
              <span>{t('gallery.mine.show_takedown')}</span>
            </label>
          )}
        </div>

        {/* ---- Card grid ---- */}
        {emptyState ?? (
          <div className="gallery-grid">
            {items.map((item) => (
              <article key={item.id} className="gallery-card card">
                <button
                  type="button"
                  className="gallery-card-hit"
                  aria-label={pickLocale(item.title, locale)}
                  onClick={() => setDetail(item)}
                >
                  <GalleryCover seed={item.seed} kind={item.chartTypes[0] ?? 'line'} />
                  <div className="gallery-card-tags">
                    <span className="tag">{t(`gallery.subject.${item.subject}`)}</span>
                    <span className={`tag gallery-repro-${item.reproStatus}`}>
                      {t(`gallery.repro.${item.reproStatus}`)}
                    </span>
                    {item.takedown && <span className="tag tag-error">{t('gallery.card.takedown')}</span>}
                  </div>
                  <h3 className="gallery-card-title">{pickLocale(item.title, locale)}</h3>
                  <p className="gallery-card-summary">{pickLocale(item.summary, locale)}</p>
                  <div className="gallery-card-foot">
                    <span className="analysis-note">{t('gallery.card.by', { name: item.author })}</span>
                    <span className="tag tag-muted">{item.license}</span>
                  </div>
                </button>
              </article>
            ))}
          </div>
        )}

        {tab === 'mine' && !emptyState && <p className="analysis-note">{t('gallery.mine.hint')}</p>}
      </div>

      {/* ---- Detail modal ---- */}
      {detail && (
        <Modal open onClose={() => setDetail(null)} title={pickLocale(detail.title, locale)} width={560}>
          <div className="gallery-detail">
            <GalleryCover seed={detail.seed} kind={detail.chartTypes[0] ?? 'line'} />
            <h4 className="share-section-title">{t('gallery.detail.summary')}</h4>
            <p>{pickLocale(detail.summary, locale)}</p>
            <h4 className="share-section-title">{t('gallery.detail.meta')}</h4>
            <dl className="gallery-detail-meta">
              <div>
                <dt>{t('gallery.detail.author')}</dt>
                <dd>{detail.author}</dd>
              </div>
              <div>
                <dt>{t('gallery.filter.subject')}</dt>
                <dd>{t(`gallery.subject.${detail.subject}`)}</dd>
              </div>
              <div>
                <dt>{t('gallery.filter.chartType')}</dt>
                <dd>{detail.chartTypes.map((c) => t(`gallery.chart.${c}`)).join(' · ')}</dd>
              </div>
              <div>
                <dt>{t('gallery.filter.reproStatus')}</dt>
                <dd>{t(`gallery.repro.${detail.reproStatus}`)}</dd>
              </div>
              <div>
                <dt>{t('gallery.detail.license')}</dt>
                <dd>{detail.license}</dd>
              </div>
              <div>
                <dt>{t('gallery.detail.created')}</dt>
                <dd>{detail.createdAt.slice(0, 10)}</dd>
              </div>
              <div>
                <dt>{t('gallery.detail.template')}</dt>
                <dd>{detail.templateId ?? t('gallery.detail.no_template')}</dd>
              </div>
            </dl>
          </div>
          <div className="gallery-detail-actions">
            <button type="button" className="btn" onClick={() => openSnapshot(detail)}>
              {t('gallery.view_snapshot')}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void openInErgalics(detail)}
            >
              {t('gallery.open_in_ergalics')}
            </button>
            {!detail.curated && !detail.takedown && (
              <button type="button" className="btn" onClick={() => doTakedown(detail)}>
                {t('gallery.takedown')}
              </button>
            )}
            {!detail.curated && detail.takedown && (
              <button type="button" className="btn btn-danger" onClick={() => deleteRecord(detail)}>
                {t('gallery.delete_record')}
              </button>
            )}
          </div>
        </Modal>
      )}

      {/* ---- Take-down confirmation ---- */}
      {confirmTakedown && (
        <Modal
          open
          onClose={() => setConfirmTakedown(null)}
          title={t('gallery.takedown_confirm_title')}
          width={420}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setConfirmTakedown(null)}>
                {t('common.close')}
              </button>
              <button type="button" className="btn btn-danger" onClick={confirmTakedownNow}>
                {t('gallery.takedown')}
              </button>
            </>
          }
        >
          <p>{t('gallery.takedown_confirm', { title: pickLocale(confirmTakedown.title, locale) })}</p>
        </Modal>
      )}
    </ToolShell>
  );
}
