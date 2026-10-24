// Training loop built on tf.Model.fit. Progress is streamed through onEpoch;
// interruption is honored via the shouldStop predicate (sets model.stopTraining).

import type { LayersModel, Tensor } from './tf';
import type { EpochRecord, Hyperparams } from './types';

export interface TrainResult {
  history: EpochRecord[];
  finalLoss: number;
  finalAccuracy: number | null;
}

export async function trainModel(
  model: LayersModel,
  xs: Tensor,
  ys: Tensor,
  hyper: Hyperparams,
  onEpoch: (rec: EpochRecord) => void,
  shouldStop: () => boolean,
): Promise<TrainResult> {
  const history: EpochRecord[] = [];

  await model.fit(xs, ys, {
    epochs: Math.max(1, Math.floor(hyper.epochs)),
    batchSize: Math.max(1, Math.floor(hyper.batchSize)),
    validationSplit: 0.15,
    shuffle: true,
    callbacks: {
      onEpochEnd: (epoch: number, logs: any) => {
        const loss = Number(logs.loss);
        const accRaw = logs.acc ?? logs.accuracy;
        const acc = typeof accRaw === 'number' ? accRaw : undefined;
        const rec: EpochRecord = { epoch: epoch + 1, loss, accuracy: acc };
        history.push(rec);
        onEpoch(rec);
        if (shouldStop()) {
          // TF.js stops at the end of the current epoch once this is set.
          (model as unknown as { stopTraining: boolean }).stopTraining = true;
        }
      },
    },
  });

  const last = history.at(-1);
  return {
    history,
    finalLoss: last?.loss ?? NaN,
    finalAccuracy: last?.accuracy ?? null,
  };
}
