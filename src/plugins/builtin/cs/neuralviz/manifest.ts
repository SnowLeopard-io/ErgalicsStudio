import type { PluginManifest } from '@/types/plugin';

export const neuralVizManifest: PluginManifest = {
  id: 'example.neuralviz',
  name: 'Neural Network Visualizer',
  nameI18n: { 'zh-CN': '神经网络可视化器', 'en-US': 'Neural Network Visualizer' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Teaching-focused multi-layer perceptron: layer-by-layer activation diagrams, forward/backward passes with gradient flow arrows, loss curves and decision boundaries on XOR / circle / spiral datasets. Complements AI Trainer with an explainable view of every weight and gradient.',
  descriptionI18n: {
    'zh-CN':
      '面向教学的多层感知机：逐层激活图、带梯度流箭头的正向/反向传播、损失曲线，以及 XOR / 同心圆 / 螺旋数据集上的决策边界。以可解释的权重与梯度视图补充 AI Trainer。',
    'en-US':
      'Teaching-focused multi-layer perceptron: layer-by-layer activation diagrams, forward/backward passes with gradient flow arrows, loss curves and decision boundaries on XOR / circle / spiral datasets. Complements AI Trainer with an explainable view of every weight and gradient.',
  },
  license: 'MIT',
  entry: 'example.neuralviz',
  category: 'scientific',
  sandbox: 'trusted',
  research: {
    tier: 'educational',
    units: { loss: 'nats', learningRate: '1/step', activation: 'dimensionless' },
    benchmarks: ['xor-convergence', 'softmax-normalisation', 'gradient-check', 'activation-derivative'],
    reproducible: true,
    notes:
      'The MLP is a small fully-connected network trained with mini-batch gradient descent on a seeded synthetic dataset; results are deterministic. Gradients are verified against central finite differences on a random subset of weights. The decision boundary is a 48×48 grid evaluation, not an analytic contour.',
    notesI18n: {
      'zh-CN':
        '该 MLP 为小型全连接网络，在固定种子的合成数据集上用迷你批次梯度下降训练，结果确定。梯度用随机权重子集上的中心差分校验。决策边界为 48×48 网格求值，而非解析等值线。',
      'en-US':
        'The MLP is a small fully-connected network trained with mini-batch gradient descent on a seeded synthetic dataset; results are deterministic. Gradients are verified against central finite differences on a random subset of weights. The decision boundary is a 48×48 grid evaluation, not an analytic contour.',
    },
  },
  formats: [{ extension: '.json', mimeTypes: ['application/json'], description: 'network + dataset JSON export' }],
  signature: {
    alg: 'ed25519',
    fingerprint: 'ed25519:790901b82a89fe505b5f98e2b7bf28e3',
    sig: '6266c88e9c1a7d98af095279482673024296c6fd4dbd0873ff6723da950929f982804ab3175e114aea140f7a139de47e615dd09b770c9a49f0bfba67aa542d03',
    signer: 'Ergalics Studio (cs pack)',
    signedAt: '2026-10-28T00:00:00.000Z',
    pub: '0d7550754e0800a5d237eef5826035766b9b3e5a15868a940ab289958788e3b0',
  },
};
