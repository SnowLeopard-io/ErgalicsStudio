// ==========================================================================
// Ergalics Studio — FR-08 模型推理 tool page (ToolShell)
//
// Browser-local inference: pick a built-in pretrained example (text / image
// classification) or import a model file (.json weights; .onnx reports a
// readable "runtime not bundled" error), choose the input, run on WebGPU
// when available (CPU fallback with an explicit performance warning), then
// save the result table back into the project — which feeds the lineage DAG
// and the experiment record through the typed event bus.
// ==========================================================================

import { useMemo, useRef, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { getGpuBackend } from '@/core/gpu';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { listDataFilesGrouped, resolveDataFile, DATA_EXTS_SERIES } from '@/core/dataFiles';
import { hashString } from '@/core/repro/random';
import { PRETRAINED_MODELS, getModelEntry, type PretrainedModelEntry } from '@/core/inference/model-catalog';
import {
  resolveDevice,
  runTextClassification,
  runImageClassification,
  loadExternalModel,
  MAX_WEBGPU_MODEL_MB,
  HARD_MODEL_LIMIT_MB,
  type InferenceDevice,
  type InferenceModel,
  type InferenceResult,
} from '@/core/inference/onnx-runner';

const SAMPLE_DIGIT_CSV = [
  '0,0,1,1,1,1,0,0',
  '0,1,1,0,0,1,1,0',
  '1,1,0,0,0,0,1,1',
  '1,1,0,0,0,0,1,1',
  '1,1,0,0,0,0,1,1',
  '1,1,0,0,0,0,1,1',
  '0,1,1,0,0,1,1,0',
  '0,0,1,1,1,1,0,0',
].join('\n');

function gpuAvailableNow(): boolean {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator && getGpuBackend().available) return true;
  return false;
}

export default function InferencePage() {
  const t = useT();
  const { locale } = useLocale();
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);

  const fileGroups = useMemo(() => listDataFilesGrouped(DATA_EXTS_SERIES), [project?.data.files]);

  const [modelId, setModelId] = useState<string>(PRETRAINED_MODELS[0]?.id ?? '');
  const [externalModel, setExternalModel] = useState<{ name: string; model: InferenceModel; sizeMb: number } | null>(null);
  const [uploadError, setUploadError] = useState('');

  const [text, setText] = useState('this result is great and clearly works');
  const [imageCsv, setImageCsv] = useState(SAMPLE_DIGIT_CSV);
  const [dataFile, setDataFile] = useState('');

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<InferenceResult | null>(null);
  const [runError, setRunError] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const modelInputRef = useRef<HTMLInputElement>(null);

  const entry: PretrainedModelEntry | undefined = getModelEntry(modelId);
  const activeModel: InferenceModel | null = externalModel?.model ?? (entry ? entry.build() : null);
  const activeName = externalModel?.name ?? (entry ? (locale === 'zh-CN' ? entry.name : entry.nameEn) : '');
  const activeSizeMb = externalModel?.sizeMb ?? entry?.sizeMb ?? 0;
  const inputType: 'text' | 'image' | 'table' =
    activeModel?.kind === 'text' ? 'text' : 'image';

  const deviceChoice = useMemo(
    () => resolveDevice(gpuAvailableNow(), activeSizeMb),
    [activeSizeMb, activeModel],
  );

  const warningKey =
    deviceChoice.warning === 'memory-threshold' || deviceChoice.warning === 'no-gpu-and-large-model'
      ? 'infer.warn_memory'
      : deviceChoice.warning === 'no-gpu'
        ? 'infer.warn_no_gpu'
        : deviceChoice.warning === 'invalid-model-size'
          ? 'infer.warn_invalid'
          : null;

  const onPickModelFile = async (file: File) => {
    setUploadError('');
    setExternalModel(null);
    setResult(null);
    try {
      const buf = await file.arrayBuffer();
      const model = loadExternalModel(file.name, buf);
      setExternalModel({ name: file.name, model, sizeMb: buf.byteLength / (1024 * 1024) });
      setModelId('');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : String(err));
    }
  };

  const parseImageInput = (): { width: number; height: number; data: number[] } | string => {
    if (!activeModel || activeModel.kind === 'text') return 'internal';
    const rows = imageCsv
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean)
      .map((r) => r.split(/[,\s;]+/).map(Number));
    if (rows.length === 0 || rows.some((r) => r.length === 0 || r.some((v) => !Number.isFinite(v)))) {
      return t('infer.bad_image');
    }
    const flat = rows.flat();
    const expected = activeModel.width * activeModel.height;
    if (flat.length !== expected && flat.length !== expected * 3) {
      return t('infer.image_size', { expected });
    }
    return { width: activeModel.width, height: activeModel.height, data: flat };
  };

  const run = async () => {
    if (!activeModel || running) return;
    setRunning(true);
    setRunError('');
    setResult(null);
    setSavedNote('');
    setProgress(0);
    try {
      const device: InferenceDevice = deviceChoice.device;
      let res: InferenceResult;
      if (activeModel.kind === 'text') {
        let input = text;
        if (dataFile) {
          const content = await resolveDataFile(dataFile);
          if (content === undefined) throw new Error(t('infer.file_missing', { name: dataFile }));
          input = content;
        }
        res = await runTextClassification(input, activeModel, {
          device,
          modelId: externalModel ? `file:${externalModel.name}` : modelId,
          onProgress: setProgress,
        });
      } else {
        const parsed = parseImageInput();
        if (typeof parsed === 'string') {
          setRunError(parsed);
          setRunning(false);
          return;
        }
        res = await runImageClassification(parsed, activeModel, {
          device,
          modelId: externalModel ? `file:${externalModel.name}` : modelId,
          onProgress: setProgress,
        });
      }
      setResult(res);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const saveResult = async () => {
    if (!result || !project) return;
    setSavedNote('');
    const csv = [
      'label,score',
      ...result.scores.map((s) => `${s.label},${s.score.toFixed(6)}`),
    ].join('\n');
    const base = `inference-${result.modelId}-${new Date().toISOString().slice(0, 10)}`;
    const name = `${base.replace(/[^\w.-]+/g, '-')}.csv`;
    try {
      const fileId = await addDataFile(new File([csv], name, { type: 'text/csv' }));
      // 运行记录：设备与耗时写入 params，血缘 DAG 经 RUN_COMPLETED 自动接入。
      await useExperimentStore.getState().recordRun({
        source: 'inference',
        label: `inference: ${activeName}`,
        params: {
          modelId: result.modelId,
          device: result.device,
          latencyMs: result.latencyMs,
          topLabel: result.label,
          sizeMb: Number(activeSizeMb.toFixed(3)),
        },
        metrics: { latencyMs: result.latencyMs, topScore: result.scores[0]?.score ?? 0 },
        inputsHash: hashString(`${result.modelId}:${result.label}:${result.scores.map((s) => s.score.toFixed(4)).join(',')}`),
        outputFileIds: fileId ? [fileId] : [],
        durationMs: result.latencyMs,
      });
      setSavedNote(t('infer.saved', { name }));
    } catch (err) {
      setSavedNote(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <ToolShell toolId="model-inference">
      <div className="analysis-body">
        {/* ---- Model picker ---- */}
        <h4 className="share-section-title">{t('infer.model')}</h4>
        <div className="analysis-row">
          <select
            className="input"
            value={externalModel ? '' : modelId}
            onChange={(e) => {
              setExternalModel(null);
              setUploadError('');
              setResult(null);
              setModelId(e.target.value);
            }}
          >
            {PRETRAINED_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {locale === 'zh-CN' ? m.name : m.nameEn} · {m.sizeMb} MB
              </option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => modelInputRef.current?.click()}>
            {t('infer.upload')}
          </button>
          <input
            ref={modelInputRef}
            type="file"
            accept=".onnx,.json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickModelFile(f);
              e.target.value = '';
            }}
          />
        </div>
        {externalModel && (
          <p className="analysis-note">
            {t('infer.uploaded', { name: externalModel.name, size: externalModel.sizeMb.toFixed(2) })}
          </p>
        )}
        {uploadError && <p className="analysis-error">{uploadError}</p>}
        <p className="analysis-note">{t('infer.model_limits', { soft: MAX_WEBGPU_MODEL_MB, hard: HARD_MODEL_LIMIT_MB })}</p>

        {/* ---- Device badge (before running) ---- */}
        <div className="analysis-row">
          <span className={`infer-device-badge is-${deviceChoice.device}`}>
            {deviceChoice.device === 'webgpu' ? 'WebGPU' : t('infer.device_cpu')}
          </span>
          {warningKey && <span className="infer-device-warning">{t(warningKey)}</span>}
        </div>

        {/* ---- Input ---- */}
        <h4 className="share-section-title">{t('infer.input')}</h4>
        {inputType === 'text' ? (
          <>
            <textarea
              className="input infer-textarea"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('infer.text_placeholder')}
            />
            {fileGroups.project.length + fileGroups.examples.length > 0 && (
              <div className="analysis-row">
                <label className="analysis-label">{t('infer.from_file')}</label>
                <select className="input" value={dataFile} onChange={(e) => setDataFile(e.target.value)}>
                  <option value="">{t('infer.no_file')}</option>
                  {fileGroups.project.map((n) => (
                    <option key={`p:${n}`} value={n}>{n}</option>
                  ))}
                  {fileGroups.examples.map((n) => (
                    <option key={`e:${n}`} value={n}>{n}</option>
                  ))}
                </select>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="analysis-note">{t('infer.image_hint', { w: activeModel?.kind === 'image' || activeModel?.kind === 'image-proto' ? activeModel.width : 8, h: activeModel?.kind === 'image' || activeModel?.kind === 'image-proto' ? activeModel.height : 8 })}</p>
            <textarea
              className="input infer-textarea"
              rows={8}
              value={imageCsv}
              onChange={(e) => setImageCsv(e.target.value)}
              spellCheck={false}
            />
            <button type="button" className="btn btn-sm" onClick={() => setImageCsv(SAMPLE_DIGIT_CSV)}>
              {t('infer.sample_digit')}
            </button>
          </>
        )}

        {/* ---- Run ---- */}
        <div className="analysis-row">
          <button type="button" className="btn btn-primary" onClick={() => void run()} disabled={running || !activeModel}>
            {running ? t('infer.running') : t('infer.run')}
          </button>
          {running && (
            <div className="infer-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)}>
              <div className="infer-progress-bar" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
        </div>
        {runError && <p className="analysis-error">{runError}</p>}

        {/* ---- Result table ---- */}
        {result && (
          <>
            <h4 className="share-section-title">{t('infer.result')}</h4>
            <p className="analysis-note">
              {t('infer.result_meta', {
                device: result.device === 'webgpu' ? 'WebGPU' : 'CPU',
                ms: result.latencyMs,
              })}
            </p>
            <table className="infer-table">
              <thead>
                <tr>
                  <th>{t('infer.col_label')}</th>
                  <th>{t('infer.col_score')}</th>
                </tr>
              </thead>
              <tbody>
                {result.scores.map((s) => (
                  <tr key={s.label} className={s.label === result.label ? 'is-top' : undefined}>
                    <td>{s.label}</td>
                    <td>{s.score.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {project ? (
              <div className="analysis-row">
                <button type="button" className="btn" onClick={() => void saveResult()}>
                  {t('infer.save')}
                </button>
                {savedNote && <span className="analysis-note">{savedNote}</span>}
              </div>
            ) : (
              <p className="analysis-note">{t('infer.need_project')}</p>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}
