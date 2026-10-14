// The Rushlight mark: a candle inside three broken rings, drawn flat. It is one SVG symbol, coloured entirely by the
// --logo-* tokens, so a skin changes the logo by changing values. LogoSprite holds the symbol once (App renders it
// at the top); every logo on screen is a <use> of it, so the size is the only thing a place chooses.
export function LogoSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <symbol id="rl-mark" viewBox="0 0 260 260">
          <g fill="none" strokeLinecap="round" transform="rotate(-90 130 130)">
            <circle cx="130" cy="130" r="122" style={{ stroke: 'var(--logo-ring1)' }} strokeWidth="3" pathLength="360" strokeDasharray="170 8 110 8 56 8" />
            <circle cx="130" cy="130" r="98" style={{ stroke: 'var(--logo-ring2)' }} strokeWidth="3" pathLength="360" strokeDasharray="36 9" />
            <circle cx="130" cy="130" r="72" style={{ stroke: 'var(--logo-ring3)' }} strokeWidth="3.5" pathLength="360" strokeDasharray="74 14 52 14 70 14 108 14" />
          </g>
          <path d="M114 146 Q114 138 130 138 Q146 138 146 146 L152 222 Q153 233 140 234 L120 234 Q107 233 108 222 Z" style={{ fill: 'var(--logo-wax)' }} />
          <path d="M130 138 V130" style={{ stroke: 'var(--logo-wick)' }} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M130 84 C137 97 145 104 145 117 C145 127 138 134 130 134 C122 134 115 127 115 117 C115 105 125 98 130 84 Z" style={{ fill: 'var(--logo-flame)' }} />
          <path d="M130 104 C134 111 138 115 138 122 C138 128 134 132 130 132 C126 132 122 128 122 122 C122 115 127 111 130 104 Z" style={{ fill: 'var(--logo-flame-core)' }} />
        </symbol>
      </defs>
    </svg>
  )
}

function RushlightLogo({ size = 72, title }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 260 260"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : 'true'}
      focusable="false"
    >
      <use href="#rl-mark" width="260" height="260" />
    </svg>
  )
}

export default RushlightLogo
