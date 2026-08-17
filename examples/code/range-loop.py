import studio

# Plain Python loop + studio.print (goes to the console)
for i in range(1, 6):
    studio.print(f'hello #{i}')

# studio.range -> a single-column table
nums = studio.range(0, 50, 5)
print('rows:', len(nums))
print('columns:', nums.column_names())
print('values:', nums.columns[0][1])
