import type { PluginManifest } from '@/types/plugin';

export const automataManifest: PluginManifest = {
  id: 'example.automata',
  name: 'Automata & Regular Expression Engine',
  nameI18n: { 'zh-CN': '自动机与正则表达式引擎', 'en-US': 'Automata & Regular Expression Engine' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Parse a regular expression into a Thompson NFA, convert it to a DFA by subset construction, minimise the DFA by partition refinement, and trace matches character by character. State diagrams, transition tables and a formal-language benchmark suite are included.',
  descriptionI18n: {
    'zh-CN':
      '将正则表达式解析为 Thompson NFA，用子集构造转成 DFA，再以划分细化最小化 DFA，并逐字符追踪匹配过程。包含状态图、转移表与形式语言基准套件。',
    'en-US':
      'Parse a regular expression into a Thompson NFA, convert it to a DFA by subset construction, minimise the DFA by partition refinement, and trace matches character by character. State diagrams, transition tables and a formal-language benchmark suite are included.',
  },
  license: 'MIT',
  entry: 'example.automata',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'quasi-research',
    units: { states: 'count', transitions: 'count', inputLength: 'characters' },
    benchmarks: ['thompson-star', 'subset-abb', 'dfa-minimise', 'regex-match', 'regex-reject'],
    reproducible: true,
    notes:
      'The regex subset supports literals, ., |, concatenation, ?, * and +, parentheses and single-character classes [abc]/[a-z]. Matching is full-strip DFA simulation on ASCII input; anchored (^…$) semantics are the default. Thompson NFAs are ε-closed exactly, and minimisation uses Moore partition refinement, whose state count is canonical for the accepted language.',
    notesI18n: {
      'zh-CN':
        '正则子集支持字面量、.、|、连接、?、*、+、括号与单字符类 [abc]/[a-z]。匹配为 ASCII 输入上的完整 DFA 模拟，默认采用 ^…$ 锚定语义。Thompson NFA 精确求 ε-闭包，最小化使用 Moore 划分细化，其状态数在语言层面是规范的。',
      'en-US':
        'The regex subset supports literals, ., |, concatenation, ?, * and +, parentheses and single-character classes [abc]/[a-z]. Matching is full-strip DFA simulation on ASCII input; anchored (^…$) semantics are the default. Thompson NFAs are ε-closed exactly, and minimisation uses Moore partition refinement, whose state count is canonical for the accepted language.',
    },
  },
  formats: [
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'regex: … and test: … lines' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'regex,test_string rows' },
  ],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: 'b742d40dff89364d83b8f7443f1e73fe41c69d6c4d3b0ecfbfc0dd360b85a290b257a192ef0f84c7130b7dc06c6667a8d6f7d64dd73a09730ba534b987422107',
    signer: 'Ergalics Studio (cs pack)',
    signedAt: '2026-10-28T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
