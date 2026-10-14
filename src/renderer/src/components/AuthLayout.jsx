import { useEffect, useState, useSyncExternalStore } from 'react'
import RushlightLogo from './RushlightLogo'
import { authLayoutFor, DEFAULT_SKIN } from '../skins'

// The skin the page is showing now, read from the data-skin attribute App keeps on <html>.
function subscribeSkin(onChange) {
  const mo = new MutationObserver(onChange)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin'] })
  return () => mo.disconnect()
}
const readSkin = () => document.documentElement.dataset.skin || DEFAULT_SKIN
export function useAuthLayout() {
  return authLayoutFor(useSyncExternalStore(subscribeSkin, readSkin))
}

export const AUTH_TABS = [
  { id: 'login', label: 'Log in' },
  { id: 'join', label: 'Join with a code' },
  { id: 'create', label: 'Create account' }
]

// The frame of every sign-in screen (log in, join, create an account, recover, save a recovery key). Two
// layouts, chosen by the skin: 'split' puts the brand on the left and the form on the right; 'card' puts one
// card on a plain background with the three ways in as tabs. `tab` and `onTab` are given only by the screens that
// are one of those three ways in. `heading` and `sub` are shown by the split layout always, and by the card
// layout when there are no tabs to say where you are.
function AuthLayout({ heading, sub, tab, onTab, wide = false, children }) {
  const layout = useAuthLayout()
  const [version, setVersion] = useState('')
  const [server, setServer] = useState('')
  useEffect(() => {
    try {
      window.api?.getVersion?.().then(setVersion)
      window.api?.getServerConfig?.().then((c) => setServer(c && c.serverUrl ? c.serverUrl.replace(/^https?:\/\//, '') : ''))
    } catch {
      // no window API (tests)
    }
  }, [])

  const head = heading && (
    <>
      <h2 className="auth-heading">{heading}</h2>
      {sub && <p className="auth-sub">{sub}</p>}
    </>
  )

  if (layout === 'split') {
    return (
      <div className="auth auth-split">
        <aside className="auth-brand">
          <RushlightLogo size={200} title="Rushlight logo, a lit candle inside broken rings" />
          <h1>Rushlight</h1>
          <p>Voice and text chat for your own community, on a server you trust.</p>
          {version && <div className="auth-version">Version {version}</div>}
        </aside>
        <main className="auth-main">
          <div className={'auth-panel' + (wide ? ' wide' : '')}>
            {head}
            {children}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="auth auth-card">
      <main className={'auth-box' + (wide ? ' wide' : '')}>
        <div className="auth-brandrow">
          <RushlightLogo size={64} title="Rushlight logo, a lit candle inside broken rings" />
          <div>
            <h1>Rushlight</h1>
            <div className="auth-tagline">Voice and text chat you control</div>
          </div>
        </div>
        {onTab ? (
          <div className="auth-tabs" role="tablist" aria-label="Ways to get in">
            {AUTH_TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className="auth-tab" onClick={() => onTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="auth-headbox">{head}</div>
        )}
        <div className="auth-body">{children}</div>
        {server && (
          <div className="auth-server">
            Server <span>{server}</span>
          </div>
        )}
      </main>
      {version && <div className="auth-version">Version {version}</div>}
    </div>
  )
}

export default AuthLayout
