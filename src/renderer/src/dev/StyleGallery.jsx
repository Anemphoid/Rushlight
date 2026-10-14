import { useEffect, useMemo, useRef, useState } from 'react'
import Avatar from '../components/Avatar'
import RushlightLogo from '../components/RushlightLogo'
import { parseColor, contrastRatio } from './contrast'
import { COLOUR_TOKENS, SKIN_TOKENS, CONTRAST_PAIRS } from '../styles/contract'
import { SKINS } from '../skins'
import './gallery.css'

// The dev-only style gallery (pull request 1 of the UI refresh): a page that shows what the client's styling
// is made of, with switches for skin, mode, density and icon size, so a change can be checked in one place
// instead of by walking every screen. It is the shell: it shows the colour variables the skins set, the
// contrast of the pairs that matter, the type in use, and today's controls exactly as they are. The shared
// components arrive in pull request 3 and get their own section here.

const DENSITIES = ['compact', 'cozy', 'comfortable']
const ICON_SIZES = ['small', 'medium', 'large']
const MODES = ['dark', 'light']

function Segmented({ label, value, options, onChange }) {
  return (
    <div className="gal-switch">
      <span className="gal-switch-label">{label}</span>
      <div className="gal-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={o === value} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

function Section({ title, note, children }) {
  return (
    <section className="gal-section">
      <h2>{title}</h2>
      {note && <p className="gal-note">{note}</p>}
      {children}
    </section>
  )
}

function StyleGallery({ onClose }) {
  const root = document.documentElement
  const original = useRef({
    skin: root.dataset.skin,
    mode: root.dataset.mode,
    density: root.dataset.density,
    iconSize: root.dataset.iconSize
  })
  const [skin, setSkin] = useState(root.dataset.skin || 'parchment')
  const [mode, setMode] = useState(root.dataset.mode || 'dark')
  const [density, setDensity] = useState(root.dataset.density || 'cozy')
  const [iconSize, setIconSize] = useState(root.dataset.iconSize || 'medium')
  const skinIds = useMemo(() => SKINS.map((k) => k.id), [])
  const [tick, setTick] = useState(0) // recompute the readings after a switch has been applied

  // switches act on the same attributes the app itself sets, so what is shown is what the app would show
  useEffect(() => {
    root.dataset.skin = skin
    root.dataset.mode = mode
    root.dataset.density = density
    root.dataset.iconSize = iconSize
    const id = requestAnimationFrame(() => setTick((t) => t + 1))
    return () => cancelAnimationFrame(id)
  }, [skin, mode, density, iconSize, root])

  // put everything back when the gallery closes
  useEffect(() => {
    const o = original.current
    return () => {
      for (const [key, value] of Object.entries(o)) {
        if (value === undefined) delete root.dataset[key]
        else root.dataset[key] = value
      }
    }
  }, [root])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const read = (name) => getComputedStyle(root).getPropertyValue(name).trim()
  void tick // readings below depend on the attributes just applied

  const typeRows = [
    { sample: 'Heading one', cls: 'card-h1', el: 'h1' },
    { sample: 'A line under a heading', cls: 'sub', el: 'p' },
    { sample: 'Section label', cls: 'gal-section-label', el: 'h2' },
    { sample: 'Field label', cls: 'gal-field-label', el: 'span' },
    { sample: 'A note under a setting that explains it in a sentence.', cls: 'settings-note', el: 'p' },
    { sample: 'Body text in the chat', cls: 'text-chat-message-body', el: 'p' }
  ]

  return (
    <div className="gal-page" role="dialog" aria-label="Style gallery">
      <header className="gal-header">
        <div>
          <h1>Style gallery</h1>
          <p className="gal-note">Development builds only. Ctrl+Shift+G or Esc to leave.</p>
        </div>
        <button type="button" className="btn-secondary gal-close" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="gal-switches">
        <Segmented label="Skin" value={skin} options={skinIds} onChange={setSkin} />
        <Segmented label="Mode" value={mode} options={MODES} onChange={setMode} />
        <Segmented label="Density" value={density} options={DENSITIES} onChange={setDensity} />
        <Segmented label="Icon size" value={iconSize} options={ICON_SIZES} onChange={setIconSize} />
      </div>

      <Section title="Skin tokens" note="Every name a skin must set (styles/contract.js), as it reads for the skin and mode chosen. The tests fail if a skin leaves one out.">
        <div className="gal-swatches">
          {[...COLOUR_TOKENS, ...SKIN_TOKENS].map((name) => {
            const value = read(name)
            return (
              <div className="gal-swatch" key={name}>
                <span className="gal-chip" style={{ background: `var(${name})` }} />
                <code>{name}</code>
                <span className="gal-value">{value}</span>
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Contrast" note="Text needs 4.5 to 1, controls and icons 3 to 1. Measured on the values above, for the skin and mode chosen.">
        <table className="gal-table">
          <tbody>
            {CONTRAST_PAIRS.map(([pfg, pbg, pneed]) => {
              const p = { fg: pfg, bg: pbg, need: pneed, what: pfg.slice(2) + ' on ' + pbg.slice(2) }
              const fg = parseColor(read(p.fg))
              const bg = parseColor(read(p.bg))
              const ratio = fg && bg ? contrastRatio(fg, bg) : null
              const ok = ratio !== null && ratio >= p.need
              return (
                <tr key={p.fg + p.bg}>
                  <td>
                    <span className="gal-chip small" style={{ background: `var(${p.bg})`, color: `var(${p.fg})` }}>
                      Aa
                    </span>
                  </td>
                  <td>{p.need === 3 ? 'control or icon' : 'text'}</td>
                  <td>
                    <code>
                      {p.fg} on {p.bg}
                    </code>
                  </td>
                  <td className="gal-num">{ratio === null ? 'not measurable' : ratio.toFixed(2) + ' to 1'}</td>
                  <td className={ok ? 'gal-pass' : 'gal-fail'}>{ratio === null ? 'check' : ok ? 'passes ' + p.need : 'below ' + p.need}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Section>

      <Section title="Type" note="The size each style comes out at under the chosen density (text sizes are rem, so they follow it).">
        <div className="gal-type">
          {typeRows.map((r) => {
            const Tag = r.el
            return (
              <TypeRow key={r.sample} label={r.cls}>
                <Tag className={r.cls}>{r.sample}</Tag>
              </TypeRow>
            )
          })}
        </div>
      </Section>

      <Section title="Shape" note="The radius tokens, which differ by skin: Lantern is rounder, Slate crisper.">
        <div className="gal-row">
          {['--radius-sm', '--radius-md', '--radius-lg', '--radius-pill'].map((name) => (
            <div className="gal-radius" key={name} style={{ borderRadius: `var(${name})` }}>
              <code>{name.slice(2)}</code>
              <span className="gal-value">{read(name)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Controls as they are today" note="Real classes from the app, unchanged. Pull request 3 replaces these with the shared components.">
        <div className="gal-controls card">
          <div className="gal-row">
            <button type="button" className="btn-primary">Primary</button>
            <button type="button" className="btn-secondary">Secondary</button>
            <button type="button" className="link-btn">Link button</button>
            <button type="button" className="link-btn danger">Danger link</button>
          </div>
          <div className="gal-row">
            <button type="button" className="btn-primary" disabled>Primary, disabled</button>
            <button type="button" className="btn-secondary" disabled>Secondary, disabled</button>
          </div>
          <div className="field">
            <label>Text field</label>
            <input defaultValue="Something typed" />
          </div>
          <div className="field">
            <label>Empty text field</label>
            <input placeholder="Placeholder text" />
          </div>
          <label className="checkbox-row">
            <input type="checkbox" defaultChecked /> A checkbox row
          </label>
          <div className="gal-row">
            <span className="member-badge">owner</span>
            <span className="persistent-tag">persistent</span>
            <span className="unread-dot" />
            <span className="tree-add-btn">+</span>
            <span className="error-text">An error message</span>
          </div>
          <div className="divider">or</div>
          <div className="day-divider" role="separator">
            <span>Today</span>
          </div>
          <div className="gal-row">
            <Avatar color="#d9903f" name="Anemphoid" size={24} />
            <Avatar color="#4f8fd6" name="Dad" size={36} />
            <Avatar color="#8fbf6a" name="Mia" size={56} />
            <RushlightLogo size={32} />
            <RushlightLogo size={72} />
          </div>
          <div className="gal-row">
            <span className="redacted-author" role="img" aria-label="Redacted author" />
            <div className="redacted-bars" role="img" aria-label="Redacted message">
              <span className="redacted-bar" style={{ width: '60%' }} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Shared components" note="Arrive in pull request 3: Button, IconButton, text field, select, checkbox, switch, slider, Dialog, Menu, Tooltip, Tabs, Tag, list row, Toast, EmptyState, spinner, Panel and the scroll area. Each gets a row here with its states." />
    </div>
  )
}

// shows the computed font size next to the sample, read after it is on screen
function TypeRow({ label, children }) {
  const ref = useRef(null)
  const [size, setSize] = useState('')
  useEffect(() => {
    const el = ref.current && ref.current.firstElementChild
    if (el) setSize(getComputedStyle(el).fontSize)
  })
  return (
    <div className="gal-type-row" ref={ref}>
      <code>{label}</code>
      <span className="gal-value">{size}</span>
      <div className="gal-type-sample">{children}</div>
    </div>
  )
}

export default StyleGallery
