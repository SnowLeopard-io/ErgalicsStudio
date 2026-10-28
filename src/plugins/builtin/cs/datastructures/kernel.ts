// ==========================================================================
// datastructures — pure kernel
//
// Binary search tree, AVL tree, binary max-heap and separate-chaining hash
// table. Every operation returns an immutable snapshot plus a rotation log so
// the UI can scrub through the history. No DOM dependencies.
// ==========================================================================

export interface TreeNode {
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
  height: number;
}

export type TreeOpKind = 'insert' | 'delete' | 'search';

export interface TreeOp {
  op: TreeOpKind;
  value: number;
}

export interface TreeStep {
  index: number;
  op: TreeOpKind;
  value: number;
  /** `null` for insert/delete, true/false for search. */
  found: boolean | null;
  rotations: string[];
  root: TreeNode | null;
  height: number;
  order: number[];
}

export interface LayoutNode {
  value: number;
  height: number;
  x: number;
  y: number;
  parent: number | null;
}

export interface TreeLayout {
  nodes: LayoutNode[];
  edges: Array<[number, number]>;
  width: number;
  depth: number;
}

const heightOf = (node: TreeNode | null): number => node?.height ?? 0;

function node(value: number): TreeNode {
  return { value, left: null, right: null, height: 1 };
}

function update(node: TreeNode): TreeNode {
  node.height = 1 + Math.max(heightOf(node.left), heightOf(node.right));
  return node;
}

function balanceFactor(node: TreeNode): number {
  return heightOf(node.left) - heightOf(node.right);
}

function rotateRight(root: TreeNode): TreeNode {
  const pivot = root.left!;
  root.left = pivot.right;
  pivot.right = update(root);
  return update(pivot);
}

function rotateLeft(root: TreeNode): TreeNode {
  const pivot = root.right!;
  root.right = pivot.left;
  pivot.left = update(root);
  return update(pivot);
}

export function cloneTree(root: TreeNode | null): TreeNode | null {
  if (!root) return null;
  return {
    value: root.value,
    height: root.height,
    left: cloneTree(root.left),
    right: cloneTree(root.right),
  };
}

export function inOrder(root: TreeNode | null, out: number[] = []): number[] {
  if (!root) return out;
  inOrder(root.left, out);
  out.push(root.value);
  inOrder(root.right, out);
  return out;
}

export function treeHeight(root: TreeNode | null): number {
  return heightOf(root);
}

/** Insert a key; when `balanced` is set, rebalance with AVL rotations. */
export function insertKey(root: TreeNode | null, value: number, balanced: boolean, log?: string[]): TreeNode {
  if (!root) return node(value);
  if (value < root.value) root.left = insertKey(root.left, value, balanced, log);
  else if (value > root.value) root.right = insertKey(root.right, value, balanced, log);
  else return update(root);
  update(root);
  if (!balanced) return root;
  const bf = balanceFactor(root);
  if (bf > 1) {
    if (value < root.left!.value) {
      log?.push(`right rotate @ ${root.value}`);
      return rotateRight(root);
    }
    log?.push(`left-right rotate @ ${root.value}`);
    root.left = rotateLeft(root.left!);
    return rotateRight(root);
  }
  if (bf < -1) {
    if (value > root.right!.value) {
      log?.push(`left rotate @ ${root.value}`);
      return rotateLeft(root);
    }
    log?.push(`right-left rotate @ ${root.value}`);
    root.right = rotateRight(root.right!);
    return rotateLeft(root);
  }
  return root;
}

export function deleteKey(root: TreeNode | null, value: number, balanced: boolean, log?: string[]): TreeNode | null {
  if (!root) return null;
  if (value < root.value) root.left = deleteKey(root.left, value, balanced, log);
  else if (value > root.value) root.right = deleteKey(root.right, value, balanced, log);
  else {
    if (!root.left) return root.right;
    if (!root.right) return root.left;
    let successor = root.right;
    while (successor.left) successor = successor.left;
    root.value = successor.value;
    root.right = deleteKey(root.right, successor.value, balanced, log);
  }
  update(root);
  if (!balanced) return root;
  const bf = balanceFactor(root);
  if (bf > 1) {
    if (balanceFactor(root.left!) >= 0) {
      log?.push(`right rotate @ ${root.value}`);
      return rotateRight(root);
    }
    log?.push(`left-right rotate @ ${root.value}`);
    root.left = rotateLeft(root.left!);
    return rotateRight(root);
  }
  if (bf < -1) {
    if (balanceFactor(root.right!) <= 0) {
      log?.push(`left rotate @ ${root.value}`);
      return rotateLeft(root);
    }
    log?.push(`right-left rotate @ ${root.value}`);
    root.right = rotateRight(root.right!);
    return rotateLeft(root);
  }
  return root;
}

export function contains(root: TreeNode | null, value: number): boolean {
  let cur = root;
  while (cur) {
    if (value === cur.value) return true;
    cur = value < cur.value ? cur.left : cur.right;
  }
  return false;
}

export function runTreeOps(ops: TreeOp[], kind: 'bst' | 'avl'): TreeStep[] {
  let root: TreeNode | null = null;
  const steps: TreeStep[] = [];
  const balanced = kind === 'avl';
  ops.forEach((op, index) => {
    const rotations: string[] = [];
    let found: boolean | null = null;
    if (op.op === 'insert') root = insertKey(root, op.value, balanced, rotations);
    else if (op.op === 'delete') root = deleteKey(root, op.value, balanced, rotations);
    else found = contains(root, op.value);
    steps.push({
      index,
      op: op.op,
      value: op.value,
      found,
      rotations,
      root: cloneTree(root),
      height: treeHeight(root),
      order: inOrder(root),
    });
  });
  return steps;
}

/** Assign each node an in-order x slot and a depth-based y level. */
export function layoutTree(root: TreeNode | null): TreeLayout {
  const nodes: LayoutNode[] = [];
  const edges: Array<[number, number]> = [];
  if (!root) return { nodes, edges, width: 0, depth: 0 };
  let slot = 0;
  let maxDepth = 0;

  const walk = (cur: TreeNode, depth: number, parent: number | null): number => {
    maxDepth = Math.max(maxDepth, depth);
    const id = nodes.length;
    nodes.push({ value: cur.value, height: cur.height, x: 0, y: depth, parent });
    if (cur.left) {
      const child = walk(cur.left, depth + 1, id);
      edges.push([id, child]);
    }
    nodes[id]!.x = slot;
    slot += 1;
    if (cur.right) {
      const child = walk(cur.right, depth + 1, id);
      edges.push([id, child]);
    }
    return id;
  };
  walk(root, 0, null);
  return { nodes, edges, width: nodes.length, depth: maxDepth + 1 };
}

// ---- binary max-heap --------------------------------------------------------

export interface HeapStep {
  array: number[];
  highlight: number;
  comparisons: number;
  swaps: number;
  note: string;
}

export function buildHeap(values: ArrayLike<number>): { array: number[]; steps: HeapStep[] } {
  const array = Array.from(values);
  const steps: HeapStep[] = [];
  let comparisons = 0;
  let swaps = 0;
  const snap = (highlight: number, note: string): void => {
    steps.push({ array: [...array], highlight, comparisons, swaps, note });
  };
  const swap = (i: number, j: number): void => {
    const t = array[i]!;
    array[i] = array[j]!;
    array[j] = t;
    swaps += 1;
  };
  const siftDown = (start: number, end: number): void => {
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
        snap(child, 'sift down');
        root = child;
      } else break;
    }
  };
  snap(-1, 'start');
  for (let start = Math.floor((array.length - 2) / 2); start >= 0; start -= 1) siftDown(start, array.length - 1);
  snap(-1, 'heap built');
  return { array, steps };
}

export function isMaxHeap(array: ArrayLike<number>): boolean {
  for (let i = 1; i < array.length; i += 1) {
    const parent = (i - 1) >> 1;
    if (array[parent]! < array[i]!) return false;
  }
  return true;
}

// ---- hash table with separate chaining -------------------------------------

export interface HashResult {
  buckets: number[][];
  maxChain: number;
  collisions: number;
  loadFactor: number;
  probes: number;
}

export function hashTable(values: ArrayLike<number>, bucketCount = 7): HashResult {
  const buckets: number[][] = Array.from({ length: Math.max(1, bucketCount) }, () => []);
  let collisions = 0;
  let probes = 0;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i]!;
    const key = ((Math.trunc(value) % bucketCount) + bucketCount) % bucketCount;
    probes += buckets[key]!.length + 1;
    if (buckets[key]!.length > 0) collisions += 1;
    buckets[key]!.push(Math.trunc(value));
  }
  return {
    buckets,
    maxChain: Math.max(0, ...buckets.map((b) => b.length)),
    collisions,
    loadFactor: values.length / bucketCount,
    probes,
  };
}

/** Parse `op,value` lines (header optional, # comments allowed). */
export function parseTreeOps(text: string): TreeOp[] {
  const out: TreeOp[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells = line.split(/[\s,;]+/).map((c) => c.trim().toLowerCase());
    if (cells.length < 2) continue;
    const op = cells[0];
    if (op !== 'insert' && op !== 'delete' && op !== 'search') continue;
    const value = Number(cells[1]);
    if (!Number.isFinite(value)) continue;
    out.push({ op, value: Math.trunc(value) });
  }
  return out;
}

export interface DataStructureBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  measured: number;
  expected: number;
  relErr: number;
  passed: boolean;
}

export function runDataStructureBenchmarks(): DataStructureBenchmark[] {
  const ops: TreeOp[] = [50, 30, 70, 20, 40, 60, 80].map((value) => ({ op: 'insert' as const, value }));
  const bst = runTreeOps(ops, 'bst');
  const order = bst.at(-1)!.order;
  const sortedOk = order.every((v, i, arr) => i === 0 || arr[i - 1]! <= v);

  const sequential: TreeOp[] = Array.from({ length: 15 }, (_, i) => ({ op: 'insert' as const, value: i + 1 }));
  const avl = runTreeOps(sequential, 'avl');
  const avlHeight = avl.at(-1)!.height;

  const heap = buildHeap([3, 9, 2, 1, 7, 5, 8, 4, 6]);
  const hash = hashTable(Array.from({ length: 20 }, (_, i) => i), 7);

  const cases = [
    {
      id: 'bst-inorder',
      labelEn: 'BST in-order traversal is sorted',
      labelZh: 'BST 中序遍历有序',
      measured: sortedOk ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'avl-height-bound',
      labelEn: 'AVL height after 15 sequential inserts = 4',
      labelZh: '连续插入 15 个键后 AVL 高度 = 4',
      measured: avlHeight,
      expected: 4,
      tol: 0,
    },
    {
      id: 'heap-property',
      labelEn: 'Heapify of 9 keys satisfies the max-heap property',
      labelZh: '9 个键建堆后满足大根堆性质',
      measured: isMaxHeap(heap.array) ? 1 : 0,
      expected: 1,
      tol: 0,
    },
    {
      id: 'hash-distribution',
      labelEn: '20 keys in 7 buckets → longest chain = 3',
      labelZh: '20 个键放入 7 个桶 → 最长链 = 3',
      measured: hash.maxChain,
      expected: 3,
      tol: 0,
    },
  ];
  return cases.map((c) => {
    const denom = Math.abs(c.expected) || 1;
    const relErr = Math.abs(c.measured - c.expected) / denom;
    return { ...c, relErr, passed: relErr <= c.tol };
  });
}
