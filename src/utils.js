export const split = (list, func) => {
  const { result, rest } = list.reduce((acc, item, index, array) => {
    acc[func(item, index, array) ? 'result' : 'rest'].push(item)
    return acc
  }, { result: [], rest: [] })
  return [result, rest]
}