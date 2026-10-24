import studio

# Load a project data file (telemetry.csv is a bundled example)
df = studio.load('telemetry.csv')
print('Loaded:', df)

# Table-level stats: mean / std / min / max / median
stats = studio.summary(df, 'temp')
print('temp stats:', stats)

# Render a line chart (reuses the timeseries plugin)
studio.plot('line', df, {'x': 'time', 'y': 'temp'})
