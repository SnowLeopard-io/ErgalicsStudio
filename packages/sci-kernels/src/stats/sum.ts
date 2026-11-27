// ==========================================================================
// Ergalics Studio — compensated summation
//
// 朴素累加在大数相消时会丢掉整个有效位：
//   [1e16, 1, -1e16, 1] 的朴素和是 1，真实值是 2。
// mean 是 variance / std / correlation / 假设检验的共同输入，一个坏的和会
// 顺着这些指标一路传下去，看起来就像"每个板块都算不准"。
//
// Neumaier 补偿求和把每一步的舍入误差单独累加，代价是一个分支。
// ==========================================================================

/**
 * Neumaier 补偿求和。比 Kahan 多处理"新项比累加和更大"的分支，
 * 因此 [1e16, 1, -1e16, 1] 也能得到正确的 2。
 */
export function compensatedSum(values: ArrayLike<number>): number {
  let sum = 0;
  let compensation = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (!Number.isFinite(v)) return Number.NaN;
    const t = sum + v;
    if (Math.abs(sum) >= Math.abs(v)) {
      compensation += sum - t + v;
    } else {
      compensation += v - t + sum;
    }
    sum = t;
  }
  return sum + compensation;
}
