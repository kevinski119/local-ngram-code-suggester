def sum_values(values):
    total = 0
    for value in values:
        total += value
    return total


async def load_value():
    response = await fetch_value()
    return response
