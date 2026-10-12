// What a redacted message looks like. The server wipes the text of a message when its author
// deletes their account, so there is nothing to size the bars from: their lengths come from
// the message id alone. That keeps them the same on every refresh and says nothing about
// what was written. One to three bars, the last one shorter, like a redacted document.
export function redactionBars(id) {
  // a small integer hash (a few rounds of multiply and xorshift), so neighbouring ids look different
  let h = (Number(id) | 0) ^ 0x9e3779b9
  const next = () => {
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
    h ^= h >>> 15
    return (h >>> 0) / 4294967296
  }
  const count = 1 + Math.floor(next() * 3)
  const widths = []
  for (let i = 0; i < count; i++) {
    const last = i === count - 1 && count > 1
    widths.push(Math.round(last ? 25 + next() * 40 : 62 + next() * 33))
  }
  return widths
}
