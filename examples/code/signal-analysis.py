import studio
import math
import random as _random

# --------------------------------------------------------------------------
# Signal analysis: synthesize a clean sine wave, add per-sample noise, then
# smooth it with a moving average and compare the three series on line plots.
# --------------------------------------------------------------------------

n = 200
freq = 4  # cycles over the window

# 1) Clean sine wave
t = [2 * math.pi * freq * i / n for i in range(n)]
signal = [math.sin(v) for v in t]

# 2) Add independent uniform noise
noise = [(_random.Random(i).random() - 0.5) * 0.4 for i in range(n)]
noisy = [s + e for s, e in zip(signal, noise)]

# 3) Simple moving average (window = 5)
def moving_average(values, window):
    half = window // 2
    out = []
    for i in range(len(values)):
        lo = max(0, i - half)
        hi = min(len(values), i + half + 1)
        window_vals = values[lo:hi]
        out.append(sum(window_vals) / len(window_vals))
    return out

smoothed = moving_average(noisy, 5)

# 4) Pack all three series into one table (time axis via studio.range)
df = studio.range(0, n, 1)  # column 'value' = sample index
df = studio.addColumn(df, 'signal', signal)
df = studio.addColumn(df, 'noisy', noisy)
df = studio.addColumn(df, 'smoothed', smoothed)

print('table:', df.column_names())
print('first noisy values:', [round(v, 3) for v in noisy[:5]])

# 5) Compare: clean vs noisy, then noisy vs smoothed
studio.plot('line', df, {'x': 'value', 'y': 'signal'})
studio.plot('line', df, {'x': 'value', 'y': 'noisy'})
studio.plot('line', df, {'x': 'value', 'y': 'smoothed'})

# 6) Quantify the smoothing: noise power before vs after
def rms(values):
    return math.sqrt(sum(v * v for v in values) / len(values))

noise_before = rms([s - n for s, n in zip(signal, noisy)])
noise_after = rms([s - n for s, n in zip(signal, smoothed)])
print(f'rms noise before smoothing: {noise_before:.4f}')
print(f'rms noise after  smoothing: {noise_after:.4f}')
print(f'reduction: {(1 - noise_after / noise_before) * 100:.1f}%')
