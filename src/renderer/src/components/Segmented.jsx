// A row of choices where exactly one is on (mode, text size, microphone mode...). Real buttons, so it works with
// the keyboard, and aria-pressed says which one is on.
function Segmented({ label, value, options, onChange, className = '' }) {
  return (
    <div role="group" aria-label={label} className={'rl-seg ' + className}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export default Segmented
