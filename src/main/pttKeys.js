// Settings captures a KeyboardEvent.code (e.g. 'ControlLeft', 'KeyV', 'F9');
// the global hook (uiohook-napi) names keys differently. This maps one to the
// other. Anything not listed can't be used as a *global* push-to-talk key.
const DIRECT = new Set([
  'Backspace', 'Tab', 'Enter', 'CapsLock', 'Escape', 'Space', 'PageUp', 'PageDown', 'End', 'Home',
  'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Insert', 'Delete',
  'Semicolon', 'Equal', 'Comma', 'Minus', 'Period', 'Slash', 'Backquote',
  'BracketLeft', 'Backslash', 'BracketRight', 'Quote',
  'NumLock', 'ScrollLock', 'PrintScreen',
  'NumpadMultiply', 'NumpadAdd', 'NumpadSubtract', 'NumpadDecimal', 'NumpadDivide', 'NumpadEnter'
])

const MODIFIERS = {
  ControlLeft: 'Ctrl',
  ControlRight: 'CtrlRight',
  ShiftLeft: 'Shift',
  ShiftRight: 'ShiftRight',
  AltLeft: 'Alt',
  AltRight: 'AltRight',
  MetaLeft: 'Meta',
  MetaRight: 'MetaRight'
}

export function uiohookNameForCode(code) {
  if (typeof code !== 'string') return null
  if (MODIFIERS[code]) return MODIFIERS[code]
  if (DIRECT.has(code)) return code
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit([0-9])$/.exec(code)
  if (m) return m[1]
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return 'Numpad' + m[1]
  m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)
  if (m) return code
  return null
}
