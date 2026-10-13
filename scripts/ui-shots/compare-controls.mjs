// Compares what a person can do on each screen before and after a change: the *.controls.json files the
// screenshot run writes next to the pictures. A restyle may move and reshape anything, but every control that
// could be used before must still be there, shown, and not covered by something else.
//
//   node scripts/ui-shots/compare-controls.mjs beforeDir afterDir [--allow "picture: Name"]...
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const allow = new Set()
const dirs = []
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--allow') allow.add(args[++i])
  else dirs.push(args[i])
}
if (dirs.length !== 2) {
  console.error('usage: compare-controls.mjs beforeDir afterDir [--allow "picture: Name"]')
  process.exit(2)
}
const [before, after] = dirs.map((d) => resolve(d))
const key = (c) => `${c.tag} | ${c.name}`
const bag = (list) => {
  const m = new Map()
  for (const c of list) m.set(key(c), [...(m.get(key(c)) || []), c])
  return m
}

let lost = 0
let newlyCovered = 0
let added = 0
let pictures = 0
let controls = 0
for (const f of readdirSync(before).filter((n) => n.endsWith('.controls.json')).sort()) {
  const pic = f.replace('.controls.json', '')
  if (!existsSync(join(after, f))) {
    console.log(`MISSING PICTURE  ${pic}`)
    lost++
    continue
  }
  pictures++
  const a = bag(JSON.parse(readFileSync(join(before, f), 'utf8')))
  const b = bag(JSON.parse(readFileSync(join(after, f), 'utf8')))
  for (const [k, list] of a) {
    const now = b.get(k) || []
    list.forEach((c, i) => {
      if (!c.shown) return // it was not usable before either
      controls++
      const n = now[i]
      const id = `${pic}: ${k}`
      if (allow.has(id)) return
      if (!n) {
        console.log(`LOST      ${id}`)
        lost++
      } else if (!n.shown) {
        console.log(`HIDDEN    ${id}`)
        lost++
      } else if (n.covered && !c.covered) {
        console.log(`COVERED   ${id}`)
        newlyCovered++
      } else if (n.disabled && !c.disabled) {
        console.log(`DISABLED  ${id}`)
        lost++
      }
    })
  }
  for (const [k, list] of b) if ((a.get(k) || []).length < list.length) added += list.length - (a.get(k) || []).length
}
console.log(`\n${pictures} screens, ${controls} usable controls checked: ${lost} lost or hidden, ${newlyCovered} newly covered, ${added} new controls`)
process.exit(lost || newlyCovered ? 1 : 0)
