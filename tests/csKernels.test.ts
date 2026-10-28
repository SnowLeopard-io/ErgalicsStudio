import { describe, expect, it } from 'vitest';
import {
  graphTrace,
  parseArrayInput,
  runAlgorithmBenchmarks,
  searchTrace,
  sortTrace,
} from '../src/plugins/builtin/cs/algorithms/kernel';
import {
  buildHeap,
  deleteKey,
  hashTable,
  inOrder,
  insertKey,
  isMaxHeap,
  parseTreeOps,
  runDataStructureBenchmarks,
  runTreeOps,
  treeHeight,
} from '../src/plugins/builtin/cs/datastructures/kernel';
import {
  accepts,
  buildAutomata,
  minimiseDfa,
  parseAutomataInput,
  runAutomataBenchmarks,
} from '../src/plugins/builtin/cs/automata/kernel';
import {
  P256,
  aesEncryptBlock,
  bytesToHex,
  ecMultiply,
  hexToBytes,
  modInverse,
  modPow,
  rsaDecryptInt,
  rsaEncryptInt,
  rsaFromPrimes,
  runCryptoBenchmarks,
  sha256Hex,
} from '../src/plugins/builtin/cs/crypto/kernel';
import {
  accuracy,
  createMlp,
  makeDataset,
  runNeuralBenchmarks,
  train,
} from '../src/plugins/builtin/cs/neuralviz/kernel';
import {
  analyseComplexity,
  fitModel,
  powerLaw,
  runComplexityBenchmarks,
  syntheticRuns,
} from '../src/plugins/builtin/cs/complexity/kernel';
import {
  congestionTrace,
  parseScenario,
  runNetProtocolBenchmarks,
  tcpHandshake,
  tls13Handshake,
} from '../src/plugins/builtin/cs/netproto/kernel';

function expectAllBenchmarksPass(cases: ReadonlyArray<{ id: string; passed: boolean; relErr: number }>) {
  for (const c of cases) {
    expect(c.passed, `${c.id} relErr=${c.relErr}`).toBe(true);
  }
}

describe('algorithms kernel', () => {
  it('sorts every algorithm correctly with deterministic counters', () => {
    const input = [5, 2, 9, 1, 5, 6];
    for (const id of ['bubble', 'insertion', 'selection', 'merge', 'quick', 'heap'] as const) {
      const trace = sortTrace(id, input);
      expect(trace.frames.at(-1)!.array).toEqual([1, 2, 5, 5, 6, 9]);
    }
    expect(sortTrace('bubble', [6, 5, 4, 3, 2, 1]).comparisons).toBe(15);
  });

  it('binary search finds with logarithmic probes', () => {
    const values = Array.from({ length: 15 }, (_, i) => i + 1);
    const hit = searchTrace('binary', values, 13);
    expect(hit.index).toBe(12);
    expect(hit.probes).toBe(4);
    expect(searchTrace('binary', values, 99).index).toBe(-1);
  });

  it('graph traversals and Dijkstra agree on the example graph', () => {
    expect(graphTrace('bfs').order.slice(0, 3).join('')).toBe('ABC');
    expect(graphTrace('dijkstra').distances.F).toBe(13);
  });

  it('parses numeric CSV with header and comments', () => {
    expect(parseArrayInput('# input\nvalue\n3,1\n2\n')).toEqual([3, 1, 2]);
  });

  it('passes its published benchmarks', () => {
    expectAllBenchmarksPass(runAlgorithmBenchmarks());
  });
});

describe('datastructures kernel', () => {
  it('keeps BST in-order sorted and AVL height bounded', () => {
    const values = [50, 30, 70, 20, 40, 60, 80];
    const bst = runTreeOps(values.map((value) => ({ op: 'insert', value })), 'bst');
    expect(bst.at(-1)!.order).toEqual([20, 30, 40, 50, 60, 70, 80]);
    const avl = runTreeOps(Array.from({ length: 15 }, (_, i) => ({ op: 'insert' as const, value: i + 1 })), 'avl');
    expect(avl.at(-1)!.height).toBe(4);
  });

  it('deletes and searches tree keys', () => {
    let root = null;
    for (const v of [50, 30, 70, 20, 40]) root = insertKey(root, v, false);
    expect(inOrder(root)).toEqual([20, 30, 40, 50, 70]);
    const after = deleteKey(root, 30, false);
    expect(inOrder(after)).toEqual([20, 40, 50, 70]);
    expect(treeHeight(after)).toBeGreaterThan(0);
  });

  it('heapifies and hashes without violating invariants', () => {
    const heap = buildHeap([3, 9, 2, 1, 7, 5, 8, 4, 6]);
    expect(isMaxHeap(heap.array)).toBe(true);
    const hash = hashTable(Array.from({ length: 20 }, (_, i) => i), 7);
    expect(hash.maxChain).toBe(3);
    expect(hash.buckets.flat().sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });

  it('parses operation lines', () => {
    expect(parseTreeOps('insert 5\ndelete 3\nsearch 7\n')).toEqual([
      { op: 'insert', value: 5 },
      { op: 'delete', value: 3 },
      { op: 'search', value: 7 },
    ]);
  });

  it('passes its published benchmarks', () => {
    expectAllBenchmarksPass(runDataStructureBenchmarks());
  });
});

describe('automata kernel', () => {
  it('builds a minimal DFA for (a|b)*abb', () => {
    const built = buildAutomata('(a|b)*abb');
    expect(built.minDfa.states.length).toBe(4);
    expect(accepts(built.dfa, 'ababb')).toBe(true);
    expect(accepts(built.dfa, 'aba')).toBe(false);
  });

  it('minimises redundant states', () => {
    const built = buildAutomata('a|a');
    expect(minimiseDfa(built.dfa).states.length).toBe(2);
  });

  it('parses regex: and test: input', () => {
    expect(parseAutomataInput('regex: a*\ntest: aaa\ntest: b\n')).toEqual({ regex: 'a*', tests: ['aaa', 'b'] });
  });

  it('passes its published benchmarks', () => {
    expectAllBenchmarksPass(runAutomataBenchmarks());
  });
});

describe('crypto kernel', () => {
  it('matches the FIPS-197 AES-128 vector', () => {
    const key = hexToBytes('000102030405060708090a0b0c0d0e0f');
    const plain = hexToBytes('00112233445566778899aabbccddeeff');
    expect(bytesToHex(aesEncryptBlock(plain, key))).toBe('69c4e0d86a7b0430d8cdb78070b4c55a');
  });

  it('matches SHA-256("abc")', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('round-trips RSA and inverts modular exponents', () => {
    const key = rsaFromPrimes(61n, 53n, 17n);
    expect(rsaDecryptInt(rsaEncryptInt(65n, key), key)).toBe(65n);
    expect(modInverse(17n, key.phi)).toBe(key.d);
    expect(modPow(2n, 10n, 1000n)).toBe(24n);
  });

  it('validates P-256 and n·G = infinity', () => {
    expect(ecMultiply(P256.order, P256.generator, P256)).toBeNull();
    expect(ecMultiply(2n, P256.generator, P256)).not.toBeNull();
  });

  it('passes its published benchmarks', () => {
    expectAllBenchmarksPass(runCryptoBenchmarks());
  });
});

describe('neuralviz kernel', () => {
  it('trains an MLP to solve XOR', () => {
    const data = makeDataset('xor');
    const net = createMlp({ sizes: [2, 8, 1], activation: 'tanh', seed: 42 });
    const result = train(net, data, { epochs: 600, learningRate: 0.3 });
    expect(result.accuracy).toBe(1);
    expect(accuracy(net, data)).toBe(1);
  });

  it('passes its published benchmarks', () => {
    expectAllBenchmarksPass(runNeuralBenchmarks());
  });
});

describe('complexity kernel', () => {
  it('classifies synthetic growth curves', () => {
    const sizes = [8, 16, 32, 64, 128];
    expect(analyseComplexity(syntheticRuns('linear', sizes)).best.id).toBe('n');
    expect(analyseComplexity(syntheticRuns('nlogn', sizes)).best.id).toBe('nlogn');
    expect(analyseComplexity(syntheticRuns('constant', sizes)).best.id).toBe('1');
    expect(powerLaw(syntheticRuns('quadratic', sizes)).slope).toBeCloseTo(2, 9);
  });

  it('reports a perfect fit for exact measurements', () => {
    const data = [8, 16, 32, 64, 128].map((n) => ({ n, time: 3 * n }));
    expect(fitModel('n', data).r2).toBeCloseTo(1, 9);
  });

  it('passes its published benchmarks', () => {
    expectAllBenchmarksPass(runComplexityBenchmarks());
  });
});

describe('netproto kernel', () => {
  it('completes TCP and TLS handshakes', () => {
    const tcp = tcpHandshake();
    expect(tcp.rtts).toBe(1);
    expect(tls13Handshake().steps).toHaveLength(9);
  });

  it('models Reno slow start and loss response', () => {
    const trace = congestionTrace({ initialCwnd: 1, initialSsthresh: 16, rounds: 8 });
    expect(trace.steps.slice(0, 4).map((s) => s.cwnd)).toEqual([1, 2, 4, 8]);
    const loss = congestionTrace({ initialCwnd: 8, initialSsthresh: 16, rounds: 3, lossAt: [0] });
    expect(loss.steps[1]?.cwnd).toBe(4);
  });

  it('parses scenario JSON with defaults', () => {
    const scenario = parseScenario('{"protocol":"reno","initialCwnd":2,"rounds":4}');
    expect(scenario.protocol).toBe('reno');
    expect(scenario.initialCwnd).toBe(2);
  });

  it('passes its published benchmarks', () => {
    expectAllBenchmarksPass(runNetProtocolBenchmarks());
  });
});
