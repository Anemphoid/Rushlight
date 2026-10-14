// The skins the app ships. The ids are what people already have saved (`rushlight-skin` in localStorage), so they
// stay as they were; only the names people see changed (Parchment became Lantern, Cool Slate became Slate). The
// colours themselves are in styles/skins/<file>.css, one block per mode, and are checked against styles/contract.js.
export const SKINS = [
  { id: 'parchment', name: 'Lantern', blurb: 'Warm amber on brown', file: 'lantern', preview: { bg: '#17120e', panel: '#1e1812', accent: '#e8a33d', text: '#f1e6d3' } },
  { id: 'cool-slate', name: 'Slate', blurb: 'Cool teal on blue-black', file: 'slate', preview: { bg: '#0f141a', panel: '#151c24', accent: '#4fd1c5', text: '#e6edf5' } }
]
export const MODES = ['dark', 'light']
export const DEFAULT_SKIN = 'parchment'
export const DEFAULT_MODE = 'dark'

export const skinName = (id) => (SKINS.find((s) => s.id === id) || SKINS[0]).name
