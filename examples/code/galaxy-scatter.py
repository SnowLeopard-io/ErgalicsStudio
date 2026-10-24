import studio

# Header-less data: default column names x / y / z / w
df = studio.load('galaxy.dat')
print('Loaded:', df)
print('Columns:', df.column_names())

# Scatter plot on the x, y channels
studio.plot('scatter', df, {'x': 'x', 'y': 'y'})
