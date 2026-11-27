// ==========================================================================
// algorithms — pure kernel
//
// Deterministic traces for sorting, searching and graph traversal. Every
// frame is a plain snapshot so the renderer can scrub back and forth without
// re-running the algorithm. No DOM, no timers: directly unit-testable.
// ==========================================================================

export type SortId = 'bubble' | 'insertion' | 'selection' | 'merge' | 'quick' | 'heap';

export interface SortFrame {
  array: number[];
  /** Primary highlighted index. */
  a: number;
  /** Secondary highlighted index. */
  b: number;
  comparisons: number;
  swaps: number;
  /** Indices already in their final position. */
  sorted: number[];
  note: string;
}

export interface SortTrace {
  id: SortId;
  input: number[];
  frames: SortFrame[];
  comparisons: number;
  swaps: number;
}

export const SORT_IDS: SortId[] = ['bubble', 'insertion', 'selection', 'merge', 'quick', 'heap'];

export const SORT_META: Record<SortId, { en: string; zh: string; best: string; average: string; worst: string; stable: boolean }> = {
  bubble: { en: 'Bubble sort', zh: '冒泡排序', best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', stable: true },
  insertion: { en: 'Insertion sort', zh: '插入排序', best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', stable: true },
  selection: { en: 'Selection sort', zh: '选择排序', best: 'O(n²)', average: 'O(n²)', worst: 'O(n²)', stable: false },
  merge: { en: 'Merge sort', zh: '归并排序', best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', stable: true },
  quick: { en: 'Quick sort (Lomuto)', zh: '快速排序（Lomuto）', best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n²)', stable: false },
  heap: { en: 'Heap sort', zh: '堆排序', best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', stable: false },
};

/** Run a sorting algorithm and record every comparison/swap as a frame. */
export function sortTrace(id: SortId, input: ArrayLike<number>): SortTrace {
  const array = Array.from(input, (v) => (Number.isFinite(v) ? v : 0));
  const frames: SortFrame[] = [];
  let comparisons = 0;
  let swaps = 0;
  const sorted = new Set<number>();

  const snap = (a: number, b: number, note: string): void => {
    frames.push({ array: [...array], a, b, comparisons, swaps, sorted: [...sorted].sort((x, y) => x - y), note });
  };
  const swap = (i: number, j: number): void => {
    const t = array[i]!;
    array[i] = array[j]!;
    array[j] = t;
    swaps += 1;
  };
  const compare = (i: number, j: number): number => {
    comparisons += 1;
    return array[i]! - array[j]!;
  };

  snap(-1, -1, 'start');

  switch (id) {
    case 'bubble':
      for (let end = array.length - 1; end > 0; end -= 1) {
        let moved = false;
        for (let i = 0; i < end; i += 1) {
          if (compare(i, i + 1) > 0) {
            swap(i, i + 1);
            moved = true;
            snap(i, i + 1, 'swap');
          } else {
            snap(i, i + 1, 'compare');
          }
        }
        sorted.add(end);
        snap(end, end, 'settled');
        if (!moved) break;
      }
      break;
    case 'insertion':
      if (array.length > 0) sorted.add(0);
      for (let i = 1; i < array.length; i += 1) {
        let j = i;
        while (j > 0 && compare(j - 1, j) > 0) {
          swap(j - 1, j);
          snap(j - 1, j, 'shift');
          j -= 1;
        }
        for (let k = 0; k <= i; k += 1) sorted.add(k);
        snap(j, i, 'inserted');
      }
      break;
    case 'selection':
      for (let i = 0; i < array.length - 1; i += 1) {
        let min = i;
        for (let j = i + 1; j < array.length; j += 1) {
          if (compare(j, min) < 0) min = j;
          snap(min, j, 'scan');
        }
        if (min !== i) {
          swap(i, min);
          snap(i, min, 'swap');
        }
        sorted.add(i);
      }
      if (array.length > 0) sorted.add(array.length - 1);
      break;
    case 'merge':
      mergeSort(0, array.length - 1);
      break;
    case 'quick':
      quickSort(0, array.length - 1);
      break;
    case 'heap':
      heapSort();
      break;
  }

  for (let i = 0; i < array.length; i += 1) sorted.add(i);
  snap(-1, -1, 'done');

  return { id, input: Array.from(input), frames, comparisons, swaps };

  function mergeSort(lo: number, hi: number): void {
    if (lo >= hi) return;
    const mid = (lo + hi) >> 1;
    mergeSort(lo, mid);
    mergeSort(mid + 1, hi);
    const left = array.slice(lo, mid + 1);
    const right = array.slice(mid + 1, hi + 1);
    let i = 0;
    let j = 0;
    let k = lo;
    while (i < left.length && j < right.length) {
      comparisons += 1;
      if (left[i]! <= right[j]!) {
        array[k] = left[i]!;
        i += 1;
      } else {
        array[k] = right[j]!;
        j += 1;
      }
      swaps += 1;
      snap(k, k, 'merge');
      k += 1;
    }
    while (i < left.length) {
      array[k] = left[i]!;
      i += 1;
      swaps += 1;
      snap(k, k, 'merge');
      k += 1;
    }
    while (j < right.length) {
      array[k] = right[j]!;
      j += 1;
      swaps += 1;
      snap(k, k, 'merge');
      k += 1;
    }
  }

  function quickSort(lo: number, hi: number): void {
    if (lo >= hi) return;
    const pivot = array[hi]!;
    let i = lo;
    for (let j = lo; j < hi; j += 1) {
      comparisons += 1;
      if (array[j]! <= pivot) {
        if (i !== j) swap(i, j);
        snap(i, j, 'partition');
        i += 1;
      } else {
        snap(j, hi, 'compare');
      }
    }
    if (i !== hi) swap(i, hi);
    sorted.add(i);
    snap(i, hi, 'pivot placed');
    quickSort(lo, i - 1);
    quickSort(i + 1, hi);
  }

  function siftDown(start: number, end: number): void {
    let root = start;
    for (;;) {
      const left = root * 2 + 1;
      if (left > end) break;
      let child = left;
      if (left + 1 <= end) {
        comparisons += 1;
        if (array[left + 1]! > array[left]!) child = left + 1;
      }
      comparisons += 1;
      if (array[root]! < array[child]!) {
        swap(root, child);
        snap(root, child, 'sift');
        root = child;
      } else break;
    }
  }

  function heapSort(): void {
    const n = array.length;
    for (let start = Math.floor((n - 2) / 2); start >= 0; start -= 1) siftDown(start, n - 1);
    for (let end = n - 1; end > 0; end -= 1) {
      swap(0, end);
      sorted.add(end);
      snap(0, end, 'extract max');
      siftDown(0, end - 1);
    }
    if (n > 0) sorted.add(0);
  }
}

export type SearchId = 'linear' | 'binary';

export interface SearchTrace {
  id: SearchId;
  target: number;
  index: number;
  probes: number;
  steps: Array<{ lo: number; hi: number; mid: number; value: number; note: string }>;
}

/** Search a sorted copy of `values`; binary search assumes ascending order. */
export function searchTrace(id: SearchId, values: ArrayLike<number>, target: number): SearchTrace {
  const data = Array.from(values).sort((a, b) => a - b);
  const steps: SearchTrace['steps'] = [];
  if (id === 'linear') {
    for (let i = 0; i < data.length; i += 1) {
      steps.push({ lo: 0, hi: data.length - 1, mid: i, value: data[i]!, note: 'probe' });
      if (data[i] === target) return { id, target, index: i, probes: i + 1, steps };
    }
    return { id, target, index: -1, probes: data.length, steps };
  }
  let lo = 0;
  let hi = data.length - 1;
  let probes = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    probes += 1;
    const value = data[mid]!;
    steps.push({ lo, hi, mid, value, note: value === target ? 'found' : value < target ? 'go right' : 'go left' });
    if (value === target) return { id, target, index: mid, probes, steps };
    if (value < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return { id, target, index: -1, probes, steps };
}

// ---- example weighted graph (undirected, integer weights) ------------------

export interface GraphEdge {
  from: string;
  to: string;
  weight: number;
}

export const EXAMPLE_GRAPH = {
  nodes: ['A', 'B', 'C', 'D', 'E', 'F'],
  edges: [
    { from: 'A', to: 'B', weight: 4 },
    { from: 'A', to: 'C', weight: 2 },
    { from: 'B', to: 'C', weight: 1 },
    { from: 'B', to: 'D', weight: 5 },
    { from: 'C', to: 'D', weight: 8 },
    { from: 'C', to: 'E', weight: 10 },
    { from: 'D', to: 'E', weight: 2 },
    { from: 'D', to: 'F', weight: 6 },
    { from: 'E', to: 'F', weight: 3 },
  ] as GraphEdge[],
};

export type GraphId = 'bfs' | 'dfs' | 'dijkstra';

/** One renderable snapshot of a graph traversal. */
export interface GraphStep {
  /** Nodes finalised so far, in visit order. */
  visited: string[];
  /** Tentative distances as of this step. */
  distances: Record<string, number>;
  /** Node being expanded, or null before the first visit. */
  current: string | null;
  /** Queue / stack / candidate set at this step. */
  frontier: string[];
  /** Edge considered at this step, if any. */
  edge: { from: string; to: string } | null;
  relaxations: number;
  note: string;
}

export interface GraphTrace {
  id: GraphId;
  order: string[];
  distances: Record<string, number>;
  relaxations: number;
  /** Step-by-step snapshots for animation; the last one equals the final state. */
  steps: GraphStep[];
}

function adjacency(): Map<string, Array<{ to: string; weight: number }>> {
  const adj = new Map<string, Array<{ to: string; weight: number }>>();
  for (const n of EXAMPLE_GRAPH.nodes) adj.set(n, []);
  for (const e of EXAMPLE_GRAPH.edges) {
    adj.get(e.from)!.push({ to: e.to, weight: e.weight });
    adj.get(e.to)!.push({ to: e.from, weight: e.weight });
  }
  for (const list of adj.values()) list.sort((a, b) => a.to.localeCompare(b.to));
  return adj;
}

export function graphTrace(id: GraphId, start = 'A'): GraphTrace {
  const adj = adjacency();
  const distances: Record<string, number> = {};
  for (const n of EXAMPLE_GRAPH.nodes) distances[n] = Infinity;
  distances[start] = 0;
  const order: string[] = [];
  const steps: GraphStep[] = [];
  let relaxations = 0;

  const snapshot = (
    note: string,
    current: string | null,
    frontier: string[],
    edge: GraphStep['edge'] = null,
  ): void => {
    steps.push({
      visited: [...order],
      distances: { ...distances },
      current,
      frontier: [...frontier],
      edge,
      relaxations,
      note,
    });
  };

  if (id === 'dijkstra') {
    const done = new Set<string>();
    const frontier = (): string[] =>
      EXAMPLE_GRAPH.nodes.filter((n) => !done.has(n) && Number.isFinite(distances[n]!));
    snapshot(`start at ${start} (d=0)`, null, frontier());
    while (done.size < EXAMPLE_GRAPH.nodes.length) {
      let best: string | null = null;
      for (const n of EXAMPLE_GRAPH.nodes) {
        if (done.has(n)) continue;
        if (best === null || distances[n]! < distances[best]!) best = n;
      }
      if (best === null || !Number.isFinite(distances[best]!)) break;
      done.add(best);
      order.push(best);
      snapshot(`select ${best} (d=${distances[best]})`, best, frontier());
      for (const edge of adj.get(best) ?? []) {
        relaxations += 1;
        const candidate = distances[best]! + edge.weight;
        if (candidate < distances[edge.to]!) {
          distances[edge.to] = candidate;
          snapshot(
            `relax ${best}→${edge.to}: ${candidate}`,
            best,
            frontier(),
            { from: best, to: edge.to },
          );
        }
      }
    }
    return { id, order, distances, relaxations, steps };
  }

  const seen = new Set<string>([start]);
  if (id === 'bfs') {
    const queue = [start];
    snapshot(`enqueue ${start}`, null, [...queue]);
    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      snapshot(`visit ${node}`, node, [...queue]);
      for (const edge of adj.get(node) ?? []) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          distances[edge.to] = distances[node]! + 1;
          queue.push(edge.to);
          snapshot(
            `enqueue ${edge.to} (d=${distances[edge.to]})`,
            node,
            [...queue],
            { from: node, to: edge.to },
          );
        }
      }
    }
  } else {
    const stack: Array<{ node: string; depth: number }> = [{ node: start, depth: 0 }];
    snapshot(`push ${start}`, null, stack.map((s) => s.node));
    while (stack.length > 0) {
      const { node, depth } = stack.pop()!;
      if (order.includes(node)) continue;
      order.push(node);
      distances[node] = depth;
      snapshot(`visit ${node} (depth ${depth})`, node, stack.map((s) => s.node));
      const neighbours = adj.get(node) ?? [];
      for (let i = neighbours.length - 1; i >= 0; i -= 1) {
        const to = neighbours[i]!.to;
        if (!seen.has(to)) {
          seen.add(to);
          stack.push({ node: to, depth: depth + 1 });
          snapshot(
            `push ${to}`,
            node,
            stack.map((s) => s.node),
            { from: node, to },
          );
        }
      }
    }
  }
  return { id, order, distances, relaxations, steps };
}

export interface AlgorithmBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

export function runAlgorithmBenchmarks(): AlgorithmBenchmark[] {
  const reversed = [6, 5, 4, 3, 2, 1];
  const bubble = sortTrace('bubble', reversed);
  const insertion = sortTrace('insertion', [1, 2, 3, 4, 5, 6, 7, 8]);
  const sortedOk = insertion.frames.at(-1)!.array.every((v, i, arr) => i === 0 || arr[i - 1]! <= v);
  const binary = searchTrace('binary', Array.from({ length: 15 }, (_, i) => i + 1), 13);
  const bfs = graphTrace('bfs');
  const dij = graphTrace('dijkstra');

  const cases = [
    {
      id: 'insertion-sorted',
      labelEn: 'Insertion sort on sorted input uses n−1 comparisons and 0 swaps',
      labelZh: '插入排序在已排序输入上用 n−1 次比较、0 次交换',
      measured: sortedOk && insertion.comparisons === 7 && insertion.swaps === 0 ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'bubble-comparisons',
      labelEn: 'Bubble sort on reversed n=6 uses n(n−1)/2 = 15 comparisons',
      labelZh: '冒泡排序在逆序 n=6 输入上用 n(n−1)/2 = 15 次比较',
      measured: bubble.comparisons,
      expected: 15,
      tol: 0,
    },
    {
      id: 'binary-search-steps',
      labelEn: 'Binary search in n=15 finds the 13th element in 4 probes',
      labelZh: '二分查找在 n=15 中第 4 次探测命中第 13 个元素',
      measured: binary.probes,
      expected: 4,
      tol: 0,
    },
    {
      id: 'bfs-order',
      labelEn: 'BFS from A visits A, B, C first',
      labelZh: '从 A 出发的 BFS 先访问 A、B、C',
      measured: bfs.order.slice(0, 3).join('') === 'ABC' ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'dijkstra-shortest',
      labelEn: 'Dijkstra A→F distance = 13',
      labelZh: 'Dijkstra A→F 最短距离 = 13',
      measured: dij.distances.F ?? Number.NaN,
      expected: 13,
      tol: 0,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
}

/** Parse a numeric CSV/whitespace input; accepts a header and ignores # lines. */
export function parseArrayInput(text: string): number[] {
  const out: number[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.split(/[,\t;\s]+/).filter(Boolean);
    for (const cell of cells) {
      const v = Number(cell);
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}
