// Shared types for the AI Training plugin.

export type ModelKind = 'linear' | 'nonlinear-nn' | 'logistic' | 'mnist';
export type TaskType = 'regression' | 'classification';

export interface Hyperparams {
  learningRate: number;
  epochs: number;
  batchSize: number;
}

export interface EpochRecord {
  epoch: number;
  loss: number;
  accuracy?: number;
}

export type TrainingPhase = 'idle' | 'training' | 'stopped' | 'done' | 'error';

export interface TrainingStatus {
  phase: TrainingPhase;
  currentEpoch: number;
  totalEpochs: number;
  currentLoss: number;
  currentAccuracy: number | null;
  history: EpochRecord[];
  message: string;
}

export interface RawDataset {
  columnNames: string[];
  rows: number[][];
  /** True for image datasets (MNIST), where `images`/`labels` carry the data. */
  isImage: boolean;
  /** [n][28][28] grayscale values in [0,1]. */
  images?: number[][][];
  labels?: number[];
}

export interface ScatterPoint {
  x: number;
  y: number;
}

export interface DecisionPoint {
  x: number;
  y: number;
  label: number;
}
