// Small helpers for the recovery key screen: a key is 12 words, and to be sure the
// person really wrote it down they have to type a few of them back.

export const CHECK_COUNT = 3

export function keyWords(key) {
  return typeof key === 'string' ? key.trim().split(/\s+/).filter(Boolean) : []
}

// Which words (0-based positions) to ask for: `count` different ones, in order.
// `random` is injectable so tests are deterministic.
export function pickCheckPositions(wordCount, count = CHECK_COUNT, random = Math.random) {
  const positions = new Set()
  const want = Math.min(count, wordCount)
  while (positions.size < want) positions.add(Math.floor(random() * wordCount))
  return [...positions].sort((a, b) => a - b)
}

// True when every asked-for word was typed correctly (any case, stray spaces ignored).
export function checkAnswers(key, positions, answers) {
  const words = keyWords(key)
  if (!positions.length || positions.length !== answers.length) return false
  return positions.every((pos, i) => (answers[i] || '').trim().toLowerCase() === words[pos])
}
