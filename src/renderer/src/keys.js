// Human-readable names for KeyboardEvent.code values.
export function formatKeyLabel(code) {
  if (!code) return 'Not set'
  const map = {
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    MetaLeft: 'Left Meta',
    MetaRight: 'Right Meta',
    Space: 'Space',
    Backquote: '`',
    CapsLock: 'Caps Lock'
  }
  return map[code] || code.replace(/^Key/, '').replace(/^Digit/, '')
}
