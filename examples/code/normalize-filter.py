import studio

df = studio.load('telemetry.csv')

# Min-max normalize -> adds a temp_minmax column
norm = studio.normalize(df, 'temp', 'minmax')

# Keep only rows above 0.6 after normalization (the hot segment)
hot = studio.filter(norm, 'temp_minmax', '>', 0.6)
print(f'{len(hot)} hot samples (of {len(norm)})')

# Sort descending, then plot
hot = studio.sort(hot, 'temp_minmax', 'desc')
studio.plot('scatter', hot, {'x': 'time', 'y': 'temp_minmax'})
