// ==========================================================================
// NLP Workbench kernel — pure, deterministic text-analysis numerics.
//
// Every function in this module is a pure function over strings/numbers with
// a seeded RNG (mulberry32): no DOM, no host APIs, and no randomness beyond
// the declared seed, so a run is reproducible from (corpus, options, seed).
//
// Contents: unicode-aware tokenization (with a CJK character-bigram
// fallback), a light suffix-stripping stemmer, TF-IDF with smoothed idf and
// L2-normalised vectors, collapsed-Gibbs-sampling LDA topic modelling,
// rule-based + multinomial naive-Bayes sentiment, heuristic rule-based NER,
// cosine similarity with seeded k-means clustering and a 2-D PCA projection,
// plus a seeded synthetic-corpus generator used by the perf benchmark.
// ==========================================================================

// ---- Seeded RNG (mulberry32) ---------------------------------------------

/** Deterministic 32-bit PRNG in [0, 1). Same seed => same sequence. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded integer in [0, n). */
function rngInt(rng: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}

// ---- English stopwords (~120 words) ---------------------------------------

const EN_STOPWORD_LIST = [
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'did', 'do', 'does', 'doing', 'down',
  'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have',
  'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
  'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me',
  'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the',
  'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who',
  'whom', 'why', 'will', 'with', 'would', 'you', 'your', 'yours', 'yourself',
  'yourselves',
];

export const EN_STOPWORDS: ReadonlySet<string> = new Set(EN_STOPWORD_LIST);

// ---- Light suffix-stripping stemmer ---------------------------------------
//
// A deterministic subset of Porter-style rules: plural stripping, -ing/-ed
// with double-consonant collapse, and -ly. Deliberately conservative — no
// multi-step rewriting — so English text stems predictably.

export function stem(word: string): string {
  const w = word;
  if (w.length <= 3) return w;
  // Plurals.
  if (w.endsWith('sses')) return w.slice(0, -2); // classes -> class
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`; // studies -> study
  if (w.endsWith('ss')) return w; // class -> class
  if (w.endsWith('s') && !w.endsWith('us') && w.length > 3) return w.slice(0, -1); // goals -> goal
  // Gerunds / participles with double-consonant collapse.
  let base: string | null = null;
  if (w.endsWith('ing') && w.length > 5) base = w.slice(0, -3); // running -> runn
  else if (w.endsWith('ed') && w.length > 4) base = w.slice(0, -2); // stopped -> stopp
  if (base) {
    if (base.length >= 3 && !/(ll|ss|zz)$/.test(base) && /(.)\1$/.test(base)) {
      base = base.slice(0, -1); // runn -> run
    }
    if (base.length >= 3) return base;
  }
  // Adverbs.
  if (w.endsWith('ly') && w.length > 4) return w.slice(0, -2); // quickly -> quick
  return w;
}

// ---- Tokenization ----------------------------------------------------------
//
// Analysis tokens: lowercased, English stopwords removed, stemmed, CJK runs
// expanded into character unigrams + bigrams (a CJK bigram fallback is the
// standard substitute for word segmentation without a dictionary).
// Surface tokens: lowercased word tokens, nothing removed (used by sentiment,
// where negation words such as "not" must survive).

const TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/;

interface ScriptSegment {
  text: string;
  cjk: boolean;
}

/** Split a token into consecutive same-script segments (CJK vs other). */
function splitScript(word: string): ScriptSegment[] {
  const segments: ScriptSegment[] = [];
  let cur = '';
  let curCjk = false;
  for (const ch of word) {
    const cjk = CJK_RE.test(ch);
    if (cur && cjk !== curCjk) {
      segments.push({ text: cur, cjk: curCjk });
      cur = '';
    }
    cur += ch;
    curCjk = cjk;
  }
  if (cur) segments.push({ text: cur, cjk: curCjk });
  return segments;
}

/** Unicode-aware tokenizer for the analysis pipeline (see module comment). */
export function tokenizeAnalysis(text: string): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();
  for (const m of lower.matchAll(TOKEN_RE)) {
    const raw = m[0];
    if (!raw) continue;
    for (const seg of splitScript(raw)) {
      if (seg.cjk) {
        const chars = [...seg.text];
        for (const c of chars) out.push(c);
        for (let i = 0; i + 1 < chars.length; i += 1) out.push(chars[i]! + chars[i + 1]!);
      } else {
        if (seg.text.length < 2) continue;
        if (EN_STOPWORDS.has(seg.text)) continue;
        out.push(stem(seg.text));
      }
    }
  }
  return out;
}

/** Lowercased word tokens with nothing removed (sentiment view). */
export function tokenizeSurface(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(TOKEN_RE)) {
    if (m[0]) out.push(m[0]);
  }
  return out;
}

// ---- Sentiment lexicon (~150 positive / ~150 negative English words) -------

export const POS_WORDS: readonly string[] = [
  'good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'brilliant',
  'outstanding', 'superb', 'terrific', 'awesome', 'impressive', 'remarkable',
  'exceptional', 'magnificent', 'marvelous', 'splendid', 'phenomenal',
  'superior', 'positive', 'success', 'successful', 'succeed', 'triumph',
  'triumphant', 'victory', 'victorious', 'champion', 'winning', 'win', 'won',
  'gain', 'gains', 'growth', 'growing', 'improve', 'improved', 'improving',
  'improvement', 'better', 'best', 'boost', 'boosted', 'strong', 'stronger',
  'strongest', 'robust', 'healthy', 'healthier', 'profitable', 'profit',
  'profits', 'revenue', 'increased', 'increase', 'rising', 'rise', 'rose',
  'surge', 'surged', 'rally', 'rallied', 'higher', 'breakthrough', 'innovation',
  'innovative', 'advanced', 'advance', 'efficient', 'efficiency', 'effective',
  'reliable', 'love', 'loved', 'lovely', 'enjoy', 'enjoyed', 'enjoyable',
  'like', 'liked', 'happy', 'happier', 'glad', 'pleased', 'delightful',
  'delighted', 'satisfied', 'satisfying', 'recommend', 'recommended', 'praise',
  'praised', 'celebrate', 'celebrated', 'popular', 'favorite', 'perfect',
  'flawless', 'seamless', 'smooth', 'clean', 'fast', 'faster', 'powerful',
  'beautiful', 'elegant', 'safe', 'safer', 'confident', 'hope', 'hopeful',
  'promising', 'bright', 'optimistic', 'opportunity', 'benefit', 'benefits',
  'valuable', 'helpful', 'useful', 'quality', 'premium', 'comfortable',
  'generous', 'honest', 'friendly', 'supported', 'supportive', 'award',
  'awarded', 'honored', 'leading', 'leader', 'pioneer', 'skilled', 'talented',
  'smart', 'clever', 'wise', 'sharp', 'fresh', 'thrive', 'thriving',
  'flourish', 'prosperous', 'abundance', 'bonus', 'reward', 'rewarded',
  'advantage', 'heroic', 'courage', 'brave', 'genius', 'stellar', 'top',
];

export const NEG_WORDS: readonly string[] = [
  'bad', 'terrible', 'awful', 'horrible', 'worst', 'worse', 'poor', 'weak',
  'weaker', 'failure', 'fail', 'failed', 'failing', 'lose', 'loses', 'lost',
  'losing', 'loss', 'losses', 'defeat', 'defeated', 'crash', 'crashed',
  'drop', 'dropped', 'decline', 'declined', 'fell', 'slump', 'slumped',
  'crisis', 'recession', 'debt', 'deficit', 'bankrupt', 'bankruptcy', 'fraud',
  'scandal', 'corruption', 'lawsuit', 'penalty', 'risk', 'risky', 'danger',
  'dangerous', 'threat', 'threatening', 'fear', 'afraid', 'worry', 'worried',
  'anxious', 'panic', 'angry', 'anger', 'outrage', 'furious', 'hate', 'hated',
  'disgust', 'disgusting', 'disappointing', 'disappointed', 'disappointment',
  'sad', 'unhappy', 'miserable', 'painful', 'pain', 'suffering', 'suffered',
  'sick', 'illness', 'disease', 'injury', 'injured', 'harm', 'harmful',
  'damage', 'damaged', 'broken', 'flaw', 'flawed', 'defect', 'defective',
  'bug', 'bugs', 'error', 'errors', 'freeze', 'freezes', 'frozen', 'slow',
  'slower', 'delay', 'delayed', 'expensive', 'costly', 'waste', 'wasted',
  'useless', 'worthless', 'unreliable', 'unstable', 'insecure', 'unsafe',
  'annoying', 'irritating', 'frustrating', 'frustrated', 'confused',
  'confusing', 'boring', 'dull', 'ugly', 'dirty', 'noisy', 'crowded',
  'lacking', 'lacks', 'missing', 'inadequate', 'insufficient', 'inferior',
  'mediocre', 'shallow', 'tired', 'exhausting', 'exhausted', 'stressful',
  'stressed', 'negative', 'problem', 'problems', 'issue', 'issues', 'trouble',
  'difficult', 'difficulty', 'harsh', 'severe', 'deadly', 'fatal', 'lethal',
  'cancer', 'virus', 'pandemic', 'death', 'dying', 'dead', 'killed', 'violent',
  'crime', 'criminal', 'victim', 'poverty', 'starving', 'hopeless',
  'deteriorate', 'deteriorated',
];

const POS_SET: ReadonlySet<string> = new Set(POS_WORDS);
const NEG_SET: ReadonlySet<string> = new Set(NEG_WORDS);

/** Lexicon polarity of one surface token (+1 / -1 / 0), with stem fallback. */
export function lexiconScore(token: string): number {
  if (POS_SET.has(token)) return 1;
  if (NEG_SET.has(token)) return -1;
  const s = stem(token);
  if (POS_SET.has(s)) return 1;
  if (NEG_SET.has(s)) return -1;
  return 0;
}

// ---- Corpus parsing --------------------------------------------------------
//
// Canonical corpus format: one document per line, an optional leading
// `pos`/`neg` label separated from the text by a tab.

export type SentimentLabel = 'pos' | 'neg';

export interface NlpDoc {
  label: SentimentLabel | null;
  text: string;
}

/** Parse `label\tdoc` lines (label optional: 'pos' / 'neg' / blank). */
export function parseCorpus(text: string): NlpDoc[] {
  const docs: NlpDoc[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tab = trimmed.indexOf('\t');
    if (tab > 0) {
      const head = trimmed.slice(0, tab).trim().toLowerCase();
      const body = trimmed.slice(tab + 1).trim();
      if ((head === 'pos' || head === 'neg') && body) {
        docs.push({ label: head, text: body });
        continue;
      }
    }
    docs.push({ label: null, text: trimmed });
  }
  return docs;
}

/**
 * Normalize a loaded CSV file into the canonical `label\tdoc` corpus text.
 * Heuristics: a header row containing "text"/"label"/"doc" is skipped; the
 * first column is treated as a label when it is pos/neg, otherwise the last
 * column is taken as the document text.
 */
export function csvTextToCorpus(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const out: string[] = [];
  const splitRow = (line: string): string[] => {
    const fields: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]!;
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; continue; }
        if (ch === '"') { quoted = false; continue; }
        cur += ch;
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ',') {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    return fields;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const fields = splitRow(lines[i]!).filter((f) => f.length > 0);
    if (fields.length === 0) continue;
    if (i === 0 && /^(label|text|doc|document|class)\b/i.test(fields[0] ?? '')) continue;
    if (fields.length === 1) {
      out.push(fields[0]!);
    } else {
      const head = (fields[0] ?? '').toLowerCase();
      if (head === 'pos' || head === 'neg') out.push(`${head}\t${fields.slice(1).join(' ')}`);
      else out.push(fields[fields.length - 1]!);
    }
  }
  return out.join('\n');
}

// ---- TF-IDF index ----------------------------------------------------------

export interface TermFreqRow {
  term: string;
  /** Total occurrences across the corpus. */
  count: number;
  /** Number of documents containing the term. */
  docs: number;
  /** Smoothed inverse document frequency. */
  idf: number;
}

export interface NlpIndex {
  docs: NlpDoc[];
  /** Analysis tokens per document (all tokens, before the min-Tf filter). */
  docTokens: string[][];
  /** Analysis tokens mapped to vocabulary indices (kept terms only). */
  docTokenIdx: number[][];
  /** Surface tokens per document (sentiment view). */
  docSurface: string[][];
  vocab: string[];
  vocabIndex: Map<string, number>;
  totalFreq: number[];
  df: number[];
  idf: number[];
  /** TF-IDF rows, L2-normalized (a zero row means an empty document). */
  matrix: number[][];
  totalTokens: number;
  avgDocLen: number;
  hapax: number;
  stopRemoved: number;
  termFreqRows: TermFreqRow[];
}

/**
 * Tokenize every document, build the vocabulary filtered by `minTf` (minimum
 * total corpus frequency), compute smoothed idf = ln((1+N)/(1+df)) + 1 and
 * return the L2-normalized TF-IDF document-term matrix. Returns null when the
 * corpus yields no analysable tokens.
 */
export function buildIndex(docs: NlpDoc[], minTf: number): NlpIndex | null {
  const n = docs.length;
  if (n === 0) return null;
  const docTokens: string[][] = [];
  const docSurface: string[][] = [];
  let totalTokens = 0;
  let stopRemoved = 0;
  const freq = new Map<string, number>();

  for (const doc of docs) {
    const tokens = tokenizeAnalysis(doc.text);
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    totalTokens += tokens.length;
    const before = tokenizeSurface(doc.text).length;
    stopRemoved += Math.max(0, before - tokens.length);
    docTokens.push(tokens);
    docSurface.push(tokenizeSurface(doc.text));
  }
  if (totalTokens === 0) return null;

  const minCount = Math.max(1, Math.floor(minTf));
  const kept = [...freq.entries()].filter(([, c]) => c >= minCount).sort((a, b) => a[0].localeCompare(b[0]));
  if (kept.length === 0) return null;

  const vocab = kept.map(([t]) => t);
  const vocabIndex = new Map(vocab.map((t, i) => [t, i] as const));
  const totalFreq = kept.map(([, c]) => c);
  let hapax = 0;
  for (const c of totalFreq) if (c === 1) hapax += 1;

  const df = new Array<number>(vocab.length).fill(0);
  const docTokenIdx: number[][] = [];
  for (const tokens of docTokens) {
    const idxs: number[] = [];
    const seen = new Set<number>();
    for (const t of tokens) {
      const idx = vocabIndex.get(t);
      if (idx === undefined) continue;
      idxs.push(idx);
      if (!seen.has(idx)) { seen.add(idx); df[idx] = (df[idx] ?? 0) + 1; }
    }
    docTokenIdx.push(idxs);
  }

  // Smoothed idf (sklearn convention): ln((1 + N) / (1 + df)) + 1.
  const idf = df.map((d) => Math.log((1 + n) / (1 + d)) + 1);

  // TF-IDF rows: tf = count / docLen, weighted by idf, then L2-normalized.
  const matrix: number[][] = [];
  for (let d = 0; d < n; d += 1) {
    const row = new Array<number>(vocab.length).fill(0);
    const tokens = docTokens[d]!;
    const docLen = tokens.length;
    if (docLen > 0) {
      const counts = new Map<number, number>();
      for (const idx of docTokenIdx[d]!) counts.set(idx, (counts.get(idx) ?? 0) + 1);
      let sq = 0;
      for (const [idx, c] of counts) {
        const v = (c / docLen) * idf[idx]!;
        row[idx] = v;
        sq += v * v;
      }
      const norm = Math.sqrt(sq);
      if (norm > 1e-12) {
        for (let j = 0; j < row.length; j += 1) row[j] = row[j]! / norm;
      }
    }
    matrix.push(row);
  }

  const termFreqRows: TermFreqRow[] = vocab
    .map((term, i) => ({ term, count: totalFreq[i]!, docs: df[i]!, idf: idf[i]! }))
    .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));

  return {
    docs,
    docTokens,
    docTokenIdx,
    docSurface,
    vocab,
    vocabIndex,
    totalFreq,
    df,
    idf,
    matrix,
    totalTokens,
    avgDocLen: totalTokens / n,
    hapax,
    stopRemoved,
    termFreqRows,
  };
}

// ---- LDA topic modelling (collapsed Gibbs sampling) -------------------------

export interface TopicTerm {
  term: string;
  /** p(term | topic) after smoothing. */
  prob: number;
}

export interface LdaResult {
  k: number;
  /** Per-topic top terms, sorted by descending probability. */
  topics: TopicTerm[][];
  /** Mean share of each topic across documents (sums to 1 over topics). */
  weights: number[];
  /** Per-document topic mixture (each row sums to 1). */
  docTopics: number[][];
  /**
   * Coherence proxy: mean probability of each topic's top terms. A larger
   * value means topic mass is concentrated on few terms. Not a substitute
   * for a real coherence measure (e.g. C_v) — hence "proxy".
   */
  coherenceProxy: number;
}

/**
 * Seeded collapsed Gibbs sampler for LDA with symmetric Dirichlet priors
 * alpha (document-topic) and beta (topic-term). Returns null when there is
 * nothing to model.
 */
export function runLda(
  index: NlpIndex,
  k: number,
  iterations: number,
  topTerms: number,
  seed: number,
  onProgress?: (done: number, total: number) => void,
): LdaResult | null {
  const K = Math.max(1, Math.floor(k));
  const D = index.docTokenIdx.length;
  const V = index.vocab.length;
  if (D === 0 || V === 0) return null;

  const alpha = 0.1;
  const beta = 0.01;
  const totalTokens = index.docTokenIdx.reduce((a, t) => a + t.length, 0);
  if (totalTokens === 0) return null;

  const rng = makeRng(seed);
  // topic[k * V + w] counts, doc[d * K + k] counts, topicTotals[k].
  const nwt = new Float64Array(K * V);
  const ndt = new Float64Array(D * K);
  const nt = new Float64Array(K);
  // Flat assignment list parallel to a flattened token stream.
  const docOf = new Int32Array(totalTokens);
  const wordOf = new Int32Array(totalTokens);
  const topicOf = new Int32Array(totalTokens);

  let cursor = 0;
  for (let d = 0; d < D; d += 1) {
    for (const w of index.docTokenIdx[d]!) {
      const t = rngInt(rng, K);
      docOf[cursor] = d;
      wordOf[cursor] = w;
      topicOf[cursor] = t;
      nwt[t * V + w] = (nwt[t * V + w] ?? 0) + 1;
      ndt[d * K + t] = (ndt[d * K + t] ?? 0) + 1;
      nt[t] = (nt[t] ?? 0) + 1;
      cursor += 1;
    }
  }

  const prob = new Float64Array(K);
  const iters = Math.max(1, Math.floor(iterations));
  for (let it = 0; it < iters; it += 1) {
    for (let j = 0; j < totalTokens; j += 1) {
      const d = docOf[j]!;
      const w = wordOf[j]!;
      const old = topicOf[j]!;
      nwt[old * V + w] = (nwt[old * V + w] ?? 0) - 1;
      ndt[d * K + old] = (ndt[d * K + old] ?? 0) - 1;
      nt[old] = (nt[old] ?? 0) - 1;
      let sum = 0;
      for (let kk = 0; kk < K; kk += 1) {
        const p = (nwt[kk * V + w]! + beta) * (ndt[d * K + kk]! + alpha);
        prob[kk] = p;
        sum += p;
      }
      let acc = 0;
      let next = K - 1;
      const r = rng() * sum;
      for (let kk = 0; kk < K; kk += 1) {
        acc += prob[kk]!;
        if (r < acc) { next = kk; break; }
      }
      topicOf[j] = next;
      nwt[next * V + w] = (nwt[next * V + w] ?? 0) + 1;
      ndt[d * K + next] = (ndt[d * K + next] ?? 0) + 1;
      nt[next] = (nt[next] ?? 0) + 1;
    }
    onProgress?.(it + 1, iters);
  }

  // Posterior estimates.
  const topics: TopicTerm[][] = [];
  const topN = Math.max(1, Math.min(Math.floor(topTerms), V));
  for (let kk = 0; kk < K; kk += 1) {
    const norm = nt[kk]! + beta * V;
    const entries: TopicTerm[] = [];
    for (let w = 0; w < V; w += 1) {
      entries.push({ term: index.vocab[w]!, prob: (nwt[kk * V + w]! + beta) / norm });
    }
    entries.sort((a, b) => b.prob - a.prob || a.term.localeCompare(b.term));
    topics.push(entries.slice(0, topN));
  }

  const docTopics: number[][] = [];
  for (let d = 0; d < D; d += 1) {
    const len = index.docTokenIdx[d]!.length;
    const mix: number[] = [];
    for (let kk = 0; kk < K; kk += 1) mix.push((ndt[d * K + kk]! + alpha) / (len + alpha * K));
    docTopics.push(mix);
  }

  const weights: number[] = [];
  for (let kk = 0; kk < K; kk += 1) {
    let s = 0;
    for (let d = 0; d < D; d += 1) s += docTopics[d]![kk]!;
    weights.push(s / D);
  }

  // Coherence proxy: mean top-term probability across topics.
  let coherence = 0;
  for (const topic of topics) {
    let s = 0;
    for (const e of topic) s += e.prob;
    coherence += s / topic.length;
  }
  coherence /= K;

  return { k: K, topics, weights, docTopics, coherenceProxy: coherence };
}

// ---- Sentiment ---------------------------------------------------------------

export interface SentimentDocRow {
  index: number;
  label: SentimentLabel | null;
  /** Rule-based lexicon score (sum of +/-1 over surface tokens). */
  lexScore: number;
  lexClass: 'pos' | 'neg' | 'neutral';
  /** Naive-Bayes P(pos) — null when the model could not be trained. */
  nbPos: number | null;
  nbClass: 'pos' | 'neg' | null;
  /** Lexicon class vs NB class (null when undecided on either side). */
  agree: boolean | null;
}

export interface SentimentResult {
  rows: SentimentDocRow[];
  /** Agreement over documents where both methods decided, in % — or null. */
  agreementPct: number | null;
  nbTrained: boolean;
}

interface NaiveBayesModel {
  posFreq: Map<string, number>;
  negFreq: Map<string, number>;
  posTotal: number;
  negTotal: number;
  vocab: number;
  logPriorPos: number;
  logPriorNeg: number;
}

/** Multinomial NB with Laplace (add-one) smoothing over surface tokens. */
function trainNaiveBayes(docs: NlpDoc[], tokensPerDoc: string[][]): NaiveBayesModel | null {
  let posDocs = 0;
  let negDocs = 0;
  const posFreq = new Map<string, number>();
  const negFreq = new Map<string, number>();
  let posTotal = 0;
  let negTotal = 0;
  const vocab = new Set<string>();
  for (let i = 0; i < docs.length; i += 1) {
    const label = docs[i]!.label;
    if (!label) continue;
    const target = label === 'pos' ? posFreq : negFreq;
    for (const t of tokensPerDoc[i]!) {
      target.set(t, (target.get(t) ?? 0) + 1);
      vocab.add(t);
      if (label === 'pos') posTotal += 1;
      else negTotal += 1;
    }
    if (label === 'pos') posDocs += 1;
    else negDocs += 1;
  }
  if (posDocs === 0 || negDocs === 0) return null;
  return {
    posFreq,
    negFreq,
    posTotal,
    negTotal,
    vocab: vocab.size,
    logPriorPos: Math.log(posDocs / (posDocs + negDocs)),
    logPriorNeg: Math.log(negDocs / (posDocs + negDocs)),
  };
}

function nbLogOdds(model: NaiveBayesModel, tokens: string[]): number {
  let sPos = model.logPriorPos;
  let sNeg = model.logPriorNeg;
  const denomPos = model.posTotal + model.vocab;
  const denomNeg = model.negTotal + model.vocab;
  for (const t of tokens) {
    sPos += Math.log(((model.posFreq.get(t) ?? 0) + 1) / denomPos);
    sNeg += Math.log(((model.negFreq.get(t) ?? 0) + 1) / denomNeg);
  }
  return sPos - sNeg;
}

/** Rule-based lexicon scoring + naive-Bayes classification for every document. */
export function runSentiment(index: NlpIndex): SentimentResult {
  const model = trainNaiveBayes(index.docs, index.docSurface);
  const rows: SentimentDocRow[] = [];
  let considered = 0;
  let matched = 0;
  for (let i = 0; i < index.docs.length; i += 1) {
    const tokens = index.docSurface[i]!;
    let score = 0;
    for (const t of tokens) score += lexiconScore(t);
    const lexClass = score > 0 ? 'pos' : score < 0 ? 'neg' : 'neutral';
    let nbPos: number | null = null;
    let nbClass: 'pos' | 'neg' | null = null;
    if (model) {
      const odds = nbLogOdds(model, tokens);
      nbPos = 1 / (1 + Math.exp(-odds));
      nbClass = nbPos > 0.5 ? 'pos' : 'neg';
    }
    const agree = lexClass !== 'neutral' && nbClass !== null ? lexClass === nbClass : null;
    if (agree !== null) {
      considered += 1;
      if (agree) matched += 1;
    }
    rows.push({ index: i, label: index.docs[i]!.label, lexScore: score, lexClass, nbPos, nbClass, agree });
  }
  return {
    rows,
    agreementPct: considered > 0 ? (matched / considered) * 100 : null,
    nbTrained: model !== null,
  };
}

// ---- Similarity: cosine top-k pairs + k-means + PCA --------------------------

export interface SimilarPair {
  a: number;
  b: number;
  sim: number;
}

export interface SimilarityResult {
  pairs: SimilarPair[];
  /** Cluster id per document. */
  clusters: number[];
  /** 2-D PCA projection of the TF-IDF vectors. */
  pca: Array<{ x: number; y: number }>;
}

/** Squared Euclidean distance (rows have equal length). */
function dist2(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    s += d * d;
  }
  return s;
}

/** Seeded k-means over the TF-IDF rows; returns the cluster id per document. */
function kmeansAssign(rows: number[][], k: number, seed: number): number[] {
  const n = rows.length;
  const kk = Math.max(1, Math.min(Math.floor(k), n));
  const assign = new Array<number>(n).fill(0);
  if (n === 0) return assign;
  const rng = makeRng(seed);
  // Seeded distinct init: Fisher-Yates shuffle of document indices.
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = rngInt(rng, i + 1);
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  const dim = rows[0]?.length ?? 0;
  let centroids: number[][] = order.slice(0, kk).map((i) => rows[i]!.slice());
  for (let it = 0; it < 50; it += 1) {
    let moved = 0;
    for (let i = 0; i < n; i += 1) {
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < kk; c += 1) {
        const d = dist2(rows[i]!, centroids[c]!);
        if (d < bd) { bd = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved += 1; }
    }
    // Centroid update (empty clusters keep their previous centroid).
    const sums = Array.from({ length: kk }, () => new Array<number>(dim).fill(0));
    const counts = new Array<number>(kk).fill(0);
    for (let i = 0; i < n; i += 1) {
      const c = assign[i]!;
      counts[c] = (counts[c] ?? 0) + 1;
      const row = rows[i]!;
      const acc = sums[c]!;
      for (let j = 0; j < dim; j += 1) acc[j] = (acc[j] ?? 0) + (row[j] ?? 0);
    }
    centroids = centroids.map((old, c) => {
      if (counts[c] === 0) return old;
      return sums[c]!.map((v) => v / counts[c]!);
    });
    if (moved === 0) break;
  }
  return assign;
}

/** Snapshot PCA (power iteration on the Gram matrix) to 2 components. */
function pca2d(rows: number[][], seed: number): Array<{ x: number; y: number }> {
  const n = rows.length;
  const pts: Array<{ x: number; y: number }> = new Array(n);
  if (n === 0) return pts;
  if (n === 1) {
    pts[0] = { x: 0, y: 0 };
    return pts;
  }
  const dim = rows[0]!.length;
  const mean = new Array<number>(dim).fill(0);
  for (const r of rows) for (let j = 0; j < dim; j += 1) mean[j] = (mean[j] ?? 0) + (r[j] ?? 0);
  for (let j = 0; j < dim; j += 1) mean[j] = mean[j]! / n;
  const X = rows.map((r) => r.map((v, j) => (v ?? 0) - mean[j]!));

  // Gram matrix G = X X^T (scale is irrelevant for eigenvectors).
  const G = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let s = 0;
      const ri = X[i]!;
      const rj = X[j]!;
      for (let d = 0; d < dim; d += 1) s += (ri[d] ?? 0) * (rj[d] ?? 0);
      G[i]![j] = s;
      G[j]![i] = s;
    }
  }

  const rng = makeRng(seed);
  const power = (M: number[][]): { v: number[]; lambda: number } | null => {
    let v = Array.from({ length: n }, () => rng() * 2 - 1);
    let lambda = 0;
    for (let it = 0; it < 120; it += 1) {
      let normSq = 0;
      const w = new Array<number>(n).fill(0);
      for (let i = 0; i < n; i += 1) {
        let s = 0;
        const row = M[i]!;
        for (let j = 0; j < n; j += 1) s += (row[j] ?? 0) * v[j]!;
        w[i] = s;
        normSq += s * s;
      }
      const norm = Math.sqrt(normSq);
      if (norm < 1e-12) return null;
      v = w.map((x) => x / norm);
      lambda = norm;
    }
    return { v, lambda };
  };

  const first = power(G);
  if (!first) {
    for (let i = 0; i < n; i += 1) pts[i] = { x: i / Math.max(1, n - 1), y: 0 };
    return pts;
  }
  // Deflate and take the second component.
  const G2 = G.map((row, i) => row.map((val, j) => val - first.lambda * first.v[i]! * first.v[j]!));
  const second = power(G2);

  const axis = (vec: number[] | null): { a: number[]; ok: boolean } => {
    if (!vec) return { a: [], ok: false };
    const a = new Array<number>(dim).fill(0);
    let normSq = 0;
    for (let i = 0; i < n; i += 1) {
      const coef = vec[i]!;
      const row = X[i]!;
      for (let d = 0; d < dim; d += 1) {
        a[d] = (a[d] ?? 0) + coef * (row[d] ?? 0);
        normSq += 0; // computed below
      }
    }
    for (let d = 0; d < dim; d += 1) normSq += a[d]! * a[d]!;
    const norm = Math.sqrt(normSq);
    if (norm < 1e-12) return { a: [], ok: false };
    return { a: a.map((v) => v / norm), ok: true };
  };

  const axis1 = axis(first.v);
  const axis2 = axis(second ? second.v : null);
  for (let i = 0; i < n; i += 1) {
    const row = X[i]!;
    if (!axis1.ok) {
      pts[i] = { x: i / Math.max(1, n - 1), y: 0 };
      continue;
    }
    let x = 0;
    let y = 0;
    for (let d = 0; d < dim; d += 1) {
      const v = row[d] ?? 0;
      x += v * axis1.a[d]!;
      if (axis2.ok) y += v * axis2.a[d]!;
    }
    pts[i] = { x, y };
  }
  return pts;
}

/** Cosine top-k pairs (rows are L2-normalized, so cosine = dot product). */
export function runSimilarity(
  index: NlpIndex,
  clusters: number,
  seed: number,
  maxPairs = 12,
): SimilarityResult | null {
  const rows = index.matrix;
  const n = rows.length;
  if (n < 2) return null;
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < n; i += 1) {
    const ri = rows[i]!;
    for (let j = i + 1; j < n; j += 1) {
      const rj = rows[j]!;
      let dot = 0;
      for (let d = 0; d < ri.length; d += 1) dot += (ri[d] ?? 0) * (rj[d] ?? 0);
      if (dot > 1e-9) pairs.push({ a: i, b: j, sim: dot });
    }
  }
  pairs.sort((a, b) => b.sim - a.sim || a.a - b.a || a.b - b.b);
  return {
    pairs: pairs.slice(0, Math.max(1, maxPairs)),
    clusters: kmeansAssign(rows, clusters, seed),
    pca: pca2d(rows, seed + 17),
  };
}

// ---- Heuristic NER -----------------------------------------------------------
//
// Clearly a heuristic: runs of capitalized tokens, classified by org/location
// suffix patterns and a small known-places list. No statistical tagger.

export type EntityType = 'ORG' | 'LOC' | 'MISC';

export interface Entity {
  text: string;
  type: EntityType;
  count: number;
  docCount: number;
}

const ORG_SUFFIX = new Set([
  'inc', 'inc.', 'corp', 'corp.', 'corporation', 'ltd', 'ltd.', 'llc', 'co',
  'company', 'group', 'university', 'institute', 'agency', 'department',
  'ministry', 'association', 'foundation', 'labs', 'laboratories',
  'laboratory', 'systems', 'technologies', 'bank', 'fund', 'school', 'press',
  'media', 'network', 'commission', 'council', 'committee', 'hospital',
  'club', 'airlines', 'motors', 'industries',
]);

const LOC_WORDS = new Set([
  'city', 'state', 'province', 'county', 'river', 'lake', 'mount', 'mountain',
  'street', 'avenue', 'island', 'bay', 'valley', 'park', 'village', 'town',
  'district', 'region', 'coast', 'sea', 'ocean',
]);

const KNOWN_PLACES = new Set([
  'america', 'europe', 'asia', 'africa', 'china', 'japan', 'germany', 'france',
  'britain', 'england', 'london', 'paris', 'berlin', 'tokyo', 'beijing',
  'shanghai', 'boston', 'chicago', 'seattle', 'toronto', 'canada', 'india',
  'brazil', 'russia', 'pacific', 'atlantic', 'york', 'vegas',
]);

/** Function words never counted as entities even when capitalized. */
const SKIP_WORDS = new Set([
  'the', 'this', 'that', 'these', 'those', 'a', 'an', 'in', 'on', 'at', 'for',
  'with', 'from', 'but', 'and', 'it', 'if', 'as', 'we', 'they', 'he', 'she',
  'his', 'her', 'their', 'our', 'your', 'its', 'when', 'while', 'after',
  'before', 'during', 'not', 'no', 'there', 'then', 'than', 'so', 'how', 'why',
]);

const SURFACE_TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;

function classifyRun(tokens: string[]): EntityType {
  const last = (tokens[tokens.length - 1] ?? '').toLowerCase();
  if (ORG_SUFFIX.has(last)) return 'ORG';
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (LOC_WORDS.has(low) || KNOWN_PLACES.has(low)) return 'LOC';
  }
  return 'MISC';
}

/** Rule-based entity extraction (capitalized runs + suffix patterns). */
export function extractEntities(docs: NlpDoc[]): Entity[] {
  const map = new Map<string, { type: EntityType; count: number; docSet: Set<number> }>();
  for (let d = 0; d < docs.length; d += 1) {
    for (const sentence of docs[d]!.text.split(/[.!?;\n]+/)) {
      const tokens = [...sentence.matchAll(SURFACE_TOKEN_RE)].map((m) => m[0]!).filter((t) => /\p{L}/u.test(t));
      let i = 0;
      while (i < tokens.length) {
        if (!/^\p{Lu}/u.test(tokens[i]!) || SKIP_WORDS.has(tokens[i]!.toLowerCase())) {
          i += 1;
          continue;
        }
        let j = i;
        while (
          j + 1 < tokens.length &&
          /^\p{Lu}/u.test(tokens[j + 1]!) &&
          !SKIP_WORDS.has(tokens[j + 1]!.toLowerCase())
        ) {
          j += 1;
        }
        const run = tokens.slice(i, j + 1);
        // A single capitalized token at sentence start is usually an ordinary
        // word — keep it only if it is a known place, an org suffix or an
        // all-caps acronym (e.g. AI, NASA).
        const firstLow = run[0]!.toLowerCase();
        const isAcronym = run[0]!.length >= 2 && run[0] === run[0]!.toUpperCase();
        const keepSingle =
          i > 0 ||
          KNOWN_PLACES.has(firstLow) ||
          ORG_SUFFIX.has(firstLow) ||
          (isAcronym && run.length === 1 && run[0]!.length <= 5);
        if (run.length >= 2 || keepSingle) {
          const text = run.join(' ');
          const type = classifyRun(run);
          const key = `${type}|${text}`;
          const entry = map.get(key) ?? { type, count: 0, docSet: new Set<number>() };
          entry.count += 1;
          entry.docSet.add(d);
          map.set(key, entry);
        }
        i = j + 1;
      }
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({ text: key.slice(key.indexOf('|') + 1), type: v.type, count: v.count, docCount: v.docSet.size }))
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
}

// ---- Pipeline -----------------------------------------------------------------

export type NlpMode = 'overview' | 'topics' | 'sentiment' | 'similarity' | 'entities';

export interface NlpOptions {
  mode: NlpMode;
  topics: number;
  iterations: number;
  topTerms: number;
  seed: number;
  minTf: number;
  /** Compute every stage regardless of the selected mode (benchmarks). */
  fullPipeline?: boolean;
}

export interface NlpProgress {
  done: number;
  total: number;
  label?: string;
}

export interface NlpPipelineResult {
  index: NlpIndex;
  lda: LdaResult | null;
  sentiment: SentimentResult;
  similarity: SimilarityResult | null;
  entities: Entity[];
}

/** Run the full analysis pipeline. Returns null when the corpus is unusable. */
export function runNlpPipeline(
  docs: NlpDoc[],
  opts: NlpOptions,
  onProgress?: (p: NlpProgress) => void,
): NlpPipelineResult | null {
  onProgress?.({ done: 0, total: 100, label: 'tokenize' });
  const index = buildIndex(docs, opts.minTf);
  if (!index) return null;
  onProgress?.({ done: 20, total: 100, label: 'tf-idf' });

  const wantTopics = opts.fullPipeline || opts.mode === 'topics';
  const lda = wantTopics
    ? runLda(index, opts.topics, opts.iterations, opts.topTerms, opts.seed, (done, total) => {
        onProgress?.({ done: 20 + Math.round((60 * done) / Math.max(1, total)), total: 100, label: 'lda' });
      })
    : null;
  onProgress?.({ done: 85, total: 100, label: 'sentiment' });
  const sentiment = runSentiment(index);
  const similarity =
    opts.fullPipeline || opts.mode === 'similarity' ? runSimilarity(index, opts.topics, opts.seed) : null;
  const entities = opts.fullPipeline || opts.mode === 'entities' ? extractEntities(docs) : [];
  onProgress?.({ done: 100, total: 100, label: 'done' });

  return { index, lda, sentiment, similarity, entities };
}

// ---- Benchmark support ----------------------------------------------------------

type Theme = 'tech' | 'sports' | 'finance' | 'health';

const THEME_POOLS: Record<Theme, string[]> = {
  tech: [
    'processor', 'memory', 'software', 'algorithm', 'compiler', 'network',
    'server', 'database', 'machine', 'learning', 'model', 'cloud', 'battery',
    'screen', 'device', 'engineer', 'framework', 'code', 'data', 'signal',
  ],
  sports: [
    'team', 'match', 'goal', 'player', 'coach', 'season', 'stadium',
    'champion', 'race', 'runner', 'score', 'league', 'training', 'injury',
    'victory', 'game', 'crowd', 'record', 'athlete', 'cup',
  ],
  finance: [
    'market', 'stock', 'bank', 'investor', 'revenue', 'profit', 'dividend',
    'inflation', 'interest', 'rates', 'fund', 'merger', 'shares', 'economy',
    'trader', 'bond', 'currency', 'growth', 'capital', 'analyst',
  ],
  health: [
    'doctor', 'patient', 'hospital', 'vaccine', 'trial', 'disease', 'diet',
    'exercise', 'sleep', 'stress', 'therapy', 'clinic', 'drug', 'symptom',
    'recovery', 'memory', 'heart', 'risk', 'study', 'treatment',
  ],
};

const FILLER_WORDS = [
  'the', 'and', 'of', 'in', 'on', 'with', 'for', 'after', 'during', 'new',
  'major', 'local', 'national', 'recent', 'annual', 'early', 'public', 'first',
  'this', 'that',
];

/** Seeded synthetic corpus (theme word pools) used by the perf benchmark. */
export function generateSyntheticCorpus(count: number, seed: number): NlpDoc[] {
  const rng = makeRng(seed);
  const themes = Object.keys(THEME_POOLS) as Theme[];
  const docs: NlpDoc[] = [];
  for (let i = 0; i < count; i += 1) {
    const theme = themes[i % themes.length]!;
    const pool = THEME_POOLS[theme]!;
    const len = 10 + rngInt(rng, 8);
    const words: string[] = [];
    for (let j = 0; j < len; j += 1) {
      if (rng() < 0.3) words.push(FILLER_WORDS[rngInt(rng, FILLER_WORDS.length)]!);
      else words.push(pool[rngInt(rng, pool.length)]!);
    }
    let label: SentimentLabel | null = null;
    const roll = rng();
    if (roll < 0.2) {
      label = 'pos';
      words.push(POS_WORDS[rngInt(rng, POS_WORDS.length)]!, POS_WORDS[rngInt(rng, POS_WORDS.length)]!);
    } else if (roll < 0.4) {
      label = 'neg';
      words.push(NEG_WORDS[rngInt(rng, NEG_WORDS.length)]!, NEG_WORDS[rngInt(rng, NEG_WORDS.length)]!);
    }
    const themeTitle = theme.charAt(0).toUpperCase() + theme.slice(1);
    docs.push({ label, text: `${themeTitle} report: ${words.join(' ')}.` });
  }
  return docs;
}

/**
 * tfidf-sanity benchmark: every non-empty TF-IDF row must be L2-normalized
 * (||v||₂ = 1 within 1e-6) and idf values must be strictly positive.
 */
export function checkTfidfSanity(index: NlpIndex): boolean {
  for (const v of index.idf) if (!(v > 0)) return false;
  for (const row of index.matrix) {
    let sq = 0;
    for (const v of row) sq += v * v;
    if (sq > 1e-12 && Math.abs(Math.sqrt(sq) - 1) > 1e-6) return false;
  }
  return true;
}

/**
 * lda-topics benchmark: every document-topic mixture must sum to 1 (within
 * 1e-6) and, with K >= 2, at least two distinct lead terms must emerge.
 */
export function checkLdaTopics(lda: LdaResult | null): boolean {
  if (!lda || lda.k < 2) return false;
  for (const mix of lda.docTopics) {
    const s = mix.reduce((a, b) => a + b, 0);
    if (Math.abs(s - 1) > 1e-6) return false;
  }
  const leaders = new Set(lda.topics.map((t) => t[0]?.term ?? ''));
  return leaders.size >= 2;
}
