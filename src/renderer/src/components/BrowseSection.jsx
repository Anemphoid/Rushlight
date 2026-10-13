import { useState, useEffect, useCallback } from 'react'
import * as api from '../api'

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
const KINDS = [
  { key: 'artists', label: 'Artists' },
  { key: 'albums', label: 'Albums' },
  { key: 'songs', label: 'Songs' }
]

// Browse the library without searching: artists, albums or songs in alphabetical order, by first letter, 50 at a
// time. Open an artist to see their albums and an album to see its songs, and pick what to play from any of them.
// act(body) sends a control to the bot (play-now, queue, play-album).
function BrowseSection({ sessionToken, serverId, act }) {
  const [kind, setKind] = useState('artists')
  const [letter, setLetter] = useState('')
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [trail, setTrail] = useState([]) // [{ kind: 'artist'|'album', id, title }] while looking inside something
  const [inside, setInside] = useState(null) // the children of the last item on the trail

  const load = useCallback(
    async (start) => {
      setLoading(true)
      setError('')
      try {
        const out = await api.browseMusic(sessionToken, serverId, { kind, letter, start })
        setItems((prev) => (start === 0 ? out.items : [...prev, ...out.items]))
        setTotal(out.total)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    },
    [sessionToken, serverId, kind, letter]
  )

  useEffect(() => {
    setItems([])
    setTotal(0)
    load(0)
  }, [load])

  async function open(item) {
    const entry = { kind: item.kind, id: item.id, title: item.title }
    setError('')
    try {
      const out = await api.musicChildren(sessionToken, serverId, item.kind, item.id)
      setTrail((t) => [...t, entry])
      setInside(out.items)
    } catch (err) {
      setError(err.message)
    }
  }
  async function back() {
    const next = trail.slice(0, -1)
    setTrail(next)
    if (next.length === 0) {
      setInside(null)
      return
    }
    const last = next[next.length - 1]
    try {
      setInside((await api.musicChildren(sessionToken, serverId, last.kind, last.id)).items)
    } catch (err) {
      setError(err.message)
    }
  }

  const list = inside || items
  const here = trail.length ? trail[trail.length - 1] : null

  return (
    <div className="np-browse">
      <div className="np-browse-title">Browse the library</div>
      {!here && (
        <>
          <div className="np-browse-tabs" role="tablist">
            {KINDS.map((k) => (
              <button key={k.key} type="button" role="tab" aria-selected={kind === k.key} className={'mode-chip' + (kind === k.key ? ' active' : '')} onClick={() => { setKind(k.key); setLetter('') }}>
                {k.label}
              </button>
            ))}
          </div>
          <div className="np-letters">
            <button type="button" className={'np-letter' + (letter === '' ? ' active' : '')} onClick={() => setLetter('')}>all</button>
            {LETTERS.map((l) => (
              <button key={l} type="button" className={'np-letter' + (letter === l ? ' active' : '')} onClick={() => setLetter(l)}>{l}</button>
            ))}
          </div>
        </>
      )}
      {here && (
        <div className="np-browse-here">
          <button type="button" className="link-btn" onClick={back}>back</button>
          <strong>{here.title}</strong>
        </div>
      )}
      {error && <div className="error-text">{error}</div>}
      <ul className="np-browse-list">
        {list.length === 0 && !loading && <li className="settings-note">Nothing here{letter ? ` starting with ${letter}` : ''}.</li>}
        {list.map((it) => (
          <li key={it.kind + it.id}>
            <span className="np-browse-name" title={it.title}>
              {it.kind === 'song' || it.kind === 'album' ? it.title : <button type="button" className="link-btn" onClick={() => open(it)}>{it.title}</button>}
              {it.kind === 'album' && (
                <>
                  {' '}
                  <button type="button" className="link-btn" onClick={() => open(it)}>songs</button>
                </>
              )}
              {it.artist ? <span className="settings-note" style={{ margin: 0 }}> {it.artist}</span> : null}
            </span>
            <span className="np-result-actions">
              <button type="button" className="link-btn" onClick={() => act({ action: 'play-now', itemId: it.id, kind: it.kind })}>Play</button>
              <button type="button" className="link-btn" onClick={() => act({ action: 'queue', itemId: it.id, kind: it.kind })}>Add</button>
            </span>
          </li>
        ))}
      </ul>
      {!inside && items.length < total && (
        <button type="button" className="btn-secondary np-btn" disabled={loading} onClick={() => load(items.length)}>
          {loading ? 'Loading...' : `More (${total - items.length} left)`}
        </button>
      )}
      {loading && items.length === 0 && <div className="settings-note">Loading...</div>}
    </div>
  )
}

export default BrowseSection
