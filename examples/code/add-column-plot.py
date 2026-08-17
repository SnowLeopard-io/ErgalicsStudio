import studio
import math

df = studio.random(200, seed=7)
xs = df.columns[0][1]  # first column, named x

# Derived column: sine wave plus a slight noise trend
ys = [math.sin(v * 6.28) + (v - 0.5) for v in xs]
df2 = studio.addColumn(df, 'y', ys)

print('table now has', df2.column_names())
studio.plot('scatter', df2, {'x': 'x', 'y': 'y'})
