import studio
import math
import random as _random

# --------------------------------------------------------------------------
# Monte-Carlo estimation of pi: sample uniform points in the unit square,
# count how many land inside the quarter circle, then pi ~ 4 * inside / n.
# We also scatter the samples, colored by hit (1) / miss (0).
# --------------------------------------------------------------------------

rng = _random.Random(123)  # fixed seed -> reproducible estimate
n = 2000

xs = [rng.random() for _ in range(n)]
ys = [rng.random() for _ in range(n)]

inside = [1.0 if x * x + y * y <= 1.0 else 0.0 for x, y in zip(xs, ys)]
hits = sum(inside)
pi_est = 4 * hits / n
print(f'pi estimate from {n} samples: {pi_est:.4f} (math.pi = {math.pi:.4f})')
print(f'error: {abs(pi_est - math.pi):.4f}')

# Build a table from the raw samples (x, y default column names)
df = studio.loadCSV('\n'.join(f'{x},{y}' for x, y in zip(xs, ys)))
df = studio.addColumn(df, 'inside', inside)

# Scatter with the hit/miss flag as the color channel
studio.plot('scatter', df, {'x': 'x', 'y': 'y', 'color': 'inside'})

# Compare the estimate across growing sample sizes
print('--- convergence ---')
for k in (200, 500, 1000, 2000):
    est = 4 * sum(1 for i in range(k) if xs[i] * xs[i] + ys[i] * ys[i] <= 1.0) / k
    print(f'n={k:>5}  pi ~ {est:.4f}')
