// ==========================================================================
// Publication-ready method descriptions (FR-3)
//
// Generated from the immutable record so a pasted paragraph can never drift
// away from the numbers shown in the app.
// ==========================================================================

import { canonicalJSON } from './canonical';
import { metricDisplayText } from './format';
import type { ResultRecord } from './types';

function metricPhrase(record: ResultRecord): string {
  return record.metrics
    .map((m) => `${m.label} = ${metricDisplayText(m)}`)
    .join('; ');
}

export function methodDescription(record: ResultRecord, locale: 'zh' | 'en'): string {
  const created = new Date(record.createdAt).toISOString();
  const seed = record.seed === undefined ? 'not seeded' : String(record.seed);
  const params = canonicalJSON(record.params);
  const hash =
    record.input.dataHash ||
    (locale === 'zh'
      ? '未记录（该计算未绑定输入文件）'
      : 'not recorded (this computation was not bound to an input file)');
  if (locale === 'zh') {
    return (
      `使用 Ergalics Studio ${record.environment.appVersion}（${record.pluginId} v${record.pluginVersion}，` +
      `计算后端 ${record.environment.backend}）完成计算。输入数据 SHA-256 为 ${hash}；` +
      `完整参数快照为 ${params}；随机种子为 ${seed}。得到的结果为：${metricPhrase(record)}。` +
      `该结果记录于 ${created}，标识为 ${record.resultId}，可据此进行溯源与复现。`
    );
  }
  return (
    `Computations were performed with Ergalics Studio ${record.environment.appVersion} ` +
    `(${record.pluginId} v${record.pluginVersion}, backend ${record.environment.backend}). ` +
    `The input data SHA-256 is ${hash}; the complete parameter snapshot was ${params}; ` +
    `the random seed was ${seed}. The reported metrics were: ${metricPhrase(record)}. ` +
    `This result was recorded at ${created} under identifier ${record.resultId}.`
  );
}

export function bilingualMethodDescription(record: ResultRecord): string {
  return `${methodDescription(record, 'en')}\n\n${methodDescription(record, 'zh')}`;
}
