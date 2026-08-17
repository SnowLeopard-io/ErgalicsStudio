import studio

# Deterministic random (fixed seed, reproducible)
df = studio.random(1000, seed=42)
print('Generated:', df)

# Bin statistics
h = studio.histogram(df, 'x', 20)
print(h)

# Histogram rendering
studio.plot('histogram', df, {'column': 'x', 'bins': 20})
