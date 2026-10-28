// Model definitions. Each model is a small factory returning a compiled-ready
// tf.LayersModel plus metadata the trainer/UI need. Kept independent so the
// four models can be developed in parallel.

import type { TF, LayersModel } from './tf';
import type { Hyperparams, ModelKind, TaskType } from './types';

export interface ModelSpec {
  kind: ModelKind;
  label: string;
  task: TaskType;
  needsImage: boolean;
  needsNormalization: boolean;
  loss: string;
  optimizer: 'sgd' | 'adam';
  metrics: string[];
  description: string;
  /**
   * Per-model starting point. A CNN needs a handful of epochs at a small
   * Adam step, while a single-neuron regressor needs hundreds of cheap SGD
   * passes — sharing one set of numbers across all four makes at least one
   * of them either untrainable or effectively hang the browser.
   */
  defaults: Hyperparams;
  /** Upper bound offered in the UI for this model. */
  maxEpochs: number;
  build(tf: TF, inputShape: number[]): LayersModel;
}

function linear(tf: TF, inputShape: number[]): LayersModel {
  const model = tf.sequential();
  model.add(
    tf.layers.dense({ units: 1, inputShape: [inputShape[0]!], activation: 'linear' }),
  );
  return model;
}

function nonLinearNN(tf: TF, inputShape: number[]): LayersModel {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 64, inputShape: [inputShape[0]!], activation: 'relu' }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'linear' }));
  return model;
}

function logistic(tf: TF, inputShape: number[]): LayersModel {
  const model = tf.sequential();
  model.add(
    tf.layers.dense({ units: 1, inputShape: [inputShape[0]!], activation: 'sigmoid' }),
  );
  return model;
}

function mnistCNN(tf: TF, _inputShape: number[]): LayersModel {
  const model = tf.sequential();
  model.add(
    tf.layers.conv2d({ inputShape: [28, 28, 1], filters: 32, kernelSize: 3, activation: 'relu' }),
  );
  model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));
  model.add(tf.layers.conv2d({ filters: 64, kernelSize: 3, activation: 'relu' }));
  model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));
  model.add(tf.layers.flatten());
  model.add(tf.layers.dense({ units: 128, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 10, activation: 'softmax' }));
  return model;
}

export const MODEL_SPECS: Record<ModelKind, ModelSpec> = {
  linear: {
    kind: 'linear',
    label: 'Linear Regression',
    task: 'regression',
    needsImage: false,
    needsNormalization: true,
    loss: 'meanSquaredError',
    optimizer: 'sgd',
    metrics: ['mse'],
    description: 'Single dense layer, MSE loss, SGD.',
    defaults: { learningRate: 0.01, epochs: 200, batchSize: 32 },
    maxEpochs: 2000,
    build: linear,
  },
  'nonlinear-nn': {
    kind: 'nonlinear-nn',
    label: 'Neural Net (Regression)',
    task: 'regression',
    needsImage: false,
    needsNormalization: true,
    loss: 'meanSquaredError',
    optimizer: 'adam',
    metrics: ['mse'],
    description: '64->32->1 ReLU MLP, MSE loss, Adam.',
    defaults: { learningRate: 0.01, epochs: 300, batchSize: 32 },
    maxEpochs: 2000,
    build: nonLinearNN,
  },
  logistic: {
    kind: 'logistic',
    label: 'Logistic Regression',
    task: 'classification',
    needsImage: false,
    needsNormalization: true,
    loss: 'binaryCrossentropy',
    optimizer: 'sgd',
    metrics: ['accuracy'],
    description: 'Single dense sigmoid, binary cross-entropy, SGD.',
    defaults: { learningRate: 0.05, epochs: 200, batchSize: 32 },
    maxEpochs: 2000,
    build: logistic,
  },
  mnist: {
    kind: 'mnist',
    label: 'MNIST CNN',
    task: 'classification',
    needsImage: true,
    needsNormalization: false,
    loss: 'categoricalCrossentropy',
    optimizer: 'adam',
    metrics: ['accuracy'],
    description: 'Conv->Pool->Conv->Pool->Dense, 10-class softmax, Adam.',
    // A convolutional net over 28x28 images costs orders of magnitude more per
    // epoch than the dense models, so it trains in tens of epochs, not hundreds.
    defaults: { learningRate: 0.001, epochs: 10, batchSize: 64 },
    maxEpochs: 100,
    build: mnistCNN,
  },
};

export function makeOptimizer(tf: TF, kind: 'sgd' | 'adam', lr: number) {
  return kind === 'adam' ? tf.train.adam(lr) : tf.train.sgd(lr);
}
