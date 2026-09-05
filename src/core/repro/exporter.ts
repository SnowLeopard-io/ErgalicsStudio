// ==========================================================================
// Ergalics Studio — DAG → Python reproduction script (pure TS)
//
// Emits a runnable Python script (numpy / pandas / scipy / matplotlib) that
// replays the analysis. Known statistic/plot blocks map to real scipy/pyplot
// calls; unknown blocks degrade to a labelled TODO so the scaffold stays
// valid Python. The global seed is set up front so randomness is captured.
// ==========================================================================

export interface ExportNode {
  id: string;
  blockId: string;
  params: Record<string, unknown>;
  /** Upstream node ids, in connection order. */
  inputs: string[];
}

export interface ExportGraph {
  nodes: ExportNode[];
  seed: number;
  studioVersion: string;
  manifestId?: string;
}

/** Topologically order nodes (Kahn). Falls back to input order on a cycle. */
export function topoSort(nodes: ExportNode[]): ExportNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const n of nodes) for (const up of n.inputs) if (byId.has(up)) indeg.set(n.id, (indeg.get(n.id) ?? 0) + 1);
  const queue = nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
  const order: ExportNode[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id)!;
    order.push(n);
    for (const m of nodes) {
      if (m.inputs.includes(id)) {
        indeg.set(m.id, (indeg.get(m.id) ?? 1) - 1);
        if ((indeg.get(m.id) ?? 0) === 0) queue.push(m.id);
      }
    }
  }
  // Append any nodes left out by a cycle, preserving original order.
  for (const n of nodes) if (!seen.has(n.id)) order.push(n);
  return order;
}

function col(p: Record<string, unknown>, key: string): string {
  return String(p[key] ?? '');
}

/** Emit a Python snippet for one block; returns the variable it produces. */
function emitBlock(node: ExportNode, ins: string[], varName: string): string {
  const p = node.params;
  const c = (k: string) => col(p, k);
  const r = (k: string, d: number) => Number.isFinite(Number(p[k])) ? Number(p[k]) : d;
  switch (node.blockId) {
    case 'statistics.tTestOne':
      return `# one-sample t-test\n${varName} = scipy.stats.ttest_1samp(${ins[0]}['${c('column')}'], popmean=${r('mu', 0)})`;
    case 'statistics.tTestTwo':
      return `# two-sample (Welch) t-test\n${varName} = scipy.stats.ttest_ind(${ins[0]}['${c('xColumn')}'], ${ins[1]}['${c('yColumn')}'], equal_var=False)`;
    case 'statistics.tTestPaired':
      return `# paired t-test\n${varName} = scipy.stats.ttest_rel(${ins[0]}['${c('xColumn')}'], ${ins[1]}['${c('yColumn')}'])`;
    case 'statistics.anova':
      return `# one-way ANOVA\n${varName} = scipy.stats.f_oneway(${ins.map((v) => `${v}['${c('column')}']`).join(', ')})`;
    case 'statistics.mannWhitney':
      return `# Mann-Whitney U test\n${varName} = scipy.stats.mannwhitneyu(${ins[0]}['${c('xColumn')}'], ${ins[1]}['${c('yColumn')}'])`;
    case 'statistics.chiSquare':
      return `# chi-square test of independence\n${varName} = scipy.stats.chi2_contingency(${ins[0]})`;
    case 'statistics.correlation':
      return `# correlation (${c('method') || 'pearson'})\n${varName} = ${c('method') === 'spearman' ? 'scipy.stats.spearmanr' : 'np.corrcoef'}(${ins[0]}['${c('xColumn')}'], ${ins[1]}['${c('yColumn')}'])`;
    case 'statistics.cohensD':
      return `# Cohen's d\n${varName} = (_mean(${ins[0]}['${c('xColumn')}']) - _mean(${ins[1]}['${c('yColumn')}'])) / _pooled_sd(${ins[0]}['${c('xColumn')}'], ${ins[1]}['${c('yColumn')}'])`;
    case 'statistics.correction':
      return `# multiple-comparison correction (${c('method')})\n${varName} = _correct([${ins.join(', ')}], method='${c('method')}', alpha=${r('alpha', 0.05)})`;
    case 'plot.histogram':
      return `fig, ax = plt.subplots()\nax.hist(${ins[0]}['${c('column')}'])\nax.set_xlabel('${c('column')}')\nax.set_ylabel('count')\nfig.savefig('${varName}.png')`;
    case 'plot.line':
      return `fig, ax = plt.subplots()\nax.plot(${ins[0]}['${c('xColumn')}'], ${ins[0]}['${c('yColumn')}'])\nfig.savefig('${varName}.png')`;
    case 'plot.scatter':
      return `fig, ax = plt.subplots()\nax.scatter(${ins[0]}['${c('xColumn')}'], ${ins[0]}['${c('yColumn')}'])\nfig.savefig('${varName}.png')`;
    case 'plot.bar':
      return `fig, ax = plt.subplots()\nax.bar(${ins[0]}['${c('column')}'].value_counts().index, ${ins[0]}['${c('column')}'].value_counts().values)\nfig.savefig('${varName}.png')`;
    default:
      return `# block ${node.id} (${node.blockId}) — reproduction template not available`;
  }
}

/** Generate a runnable Python reproduction script from a graph. */
export function dagToPython(graph: ExportGraph): string {
  const header = [
    '# Reproduced by Ergalics Studio',
    graph.manifestId ? `# run: ${graph.manifestId}` : '',
    `# studio_version: ${graph.studioVersion}`,
    `# seed: ${graph.seed}`,
    'import numpy as np',
    'import pandas as pd',
    'import scipy.stats as scipy',
    'import matplotlib.pyplot as plt',
    '',
    'np.random.seed(' + graph.seed + ')',
    '',
    '# --- helpers (stand-ins for the studios statistics kernel) ---',
    'def _mean(a): return float(np.mean(a))',
    'def _pooled_sd(a, b):',
    '    na, nb = len(a), len(b)',
    '    return float(np.sqrt(((na - 1) * np.var(a, ddof=1) + (nb - 1) * np.var(b, ddof=1)) / (na + nb - 2)))',
    'def _correct(pvals, method="bonferroni", alpha=0.05):',
    '    import statsmodels.stats.multitest as sm',
    '    return sm.multipletests(pvals, alpha=alpha, method=method)',
    '',
    '# --- data sources (reconstruct from the run manifest inputs) ---',
  ]
    .filter((l) => l !== '')
    .join('\n');

  const ordered = topoSort(graph.nodes);
  const varOf = new Map<string, string>();
  ordered.forEach((n, i) => varOf.set(n.id, `n${i}`));

  const body: string[] = [];
  for (const n of ordered) {
    const ins = n.inputs.map((up) => varOf.get(up) ?? `n_UNKNOWN_${up}`);
    if (n.blockId.startsWith('data_source')) {
      body.push(`# data source: ${n.blockId}\nn${ordered.indexOf(n)} = pd.DataFrame()  # TODO: reconstruct from manifest input`);
      continue;
    }
    body.push(emitBlock(n, ins, varOf.get(n.id)!));
  }

  return `${header}\n\n${body.join('\n\n')}\n`;
}
