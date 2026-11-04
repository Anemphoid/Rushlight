// Small helpers for the recovery key screen: a key is 12 words, and to be sure the
// person really wrote it down they have to type a few of them back.
import { RECOVERY_WORDS } from './recoveryWords.js'

const WORD_SET = new Set(RECOVERY_WORDS)

// The app makes the key itself (since server v0.22.0), so the server never sees the words: 12 words from the list of 2048
// is 132 bits from the system's secure random source. 2048 divides 65536, so masking a random 16 bit number is unbiased.
export function generateRecoveryWords(fill = (a) => globalThis.crypto.getRandomValues(a)) {
  const numbers = fill(new Uint16Array(12))
  return Array.from(numbers, (n) => RECOVERY_WORDS[n & 0x7ff]).join(' ')
}

// True when `text` is 12 words that are all on the list (any case, any spacing, dashes or commas between).
export function wordsAreKnown(text) {
  const words = typeof text === 'string' ? text.toLowerCase().split(/[\s,.\-_]+/).filter(Boolean) : []
  return words.length === 12 && words.every((w) => WORD_SET.has(w))
}

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
