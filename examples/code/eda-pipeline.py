import studio

# --------------------------------------------------------------------------
# Full exploratory data-analysis pipeline over the telemetry dataset:
# load -> per-column stats -> z-score everything except time -> correlation
# scatter -> filter extreme samples -> report + scatter.
# --------------------------------------------------------------------------

# 1) Load the bundled telemetry sample
df = studio.load('telemetry.csv')
print('shape:', len(df), 'rows x', len(df.columns), 'cols')
print('columns:', df.column_names())

# 2) Summary statistics for every column
for col in df.column_names():
    stats = studio.summary(df, col)
    print(f'--- {col} ---')
    print(stats)

# 3) Z-score normalize every numeric column except the time axis
norm = df
for col in df.column_names():
    if col != 'time':
        norm = studio.normalize(norm, col, 'zscore')
print('after normalize, columns:', norm.column_names())

# 4) Correlation scatter: z-scored temperature vs z-scored pressure
studio.plot('scatter', norm, {'x': 'temp_zscore', 'y': 'pressure_zscore'})

# 5) Keep the hottest samples (z > 1.5) and inspect them
extreme = studio.filter(norm, 'temp_zscore', '>', 1.5)
print(f'extreme samples (temp z > 1.5): {len(extreme)} of {len(norm)}')

# 6) Sort by how extreme they are, then visualize
extreme = studio.sort(extreme, 'temp_zscore', 'desc')
studio.plot('scatter', extreme, {'x': 'time', 'y': 'temp_zscore'})
