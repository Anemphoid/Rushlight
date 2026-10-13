// A tiny stand-in for Jellyfin, just enough for the screens' calls: sign-in check, search and cover art.
// (No audio: the client tests never play anything.)
import { createServer } from 'node:http'

export const TOKEN = 'good-token-123'
export const SONG_ID = '00000000000000000000000000000001'
export const ARTIST_ID = '00000000000000000000000000000020'
export const ALBUM_ID = '00000000000000000000000000000030'
export const MISSING_ID = '00000000000000000000000000000099'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')

export async function startFakeJellyfin() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    const token = (/Token="([^"]*)"/.exec(req.headers['x-emby-authorization'] || '') || [])[1]
    const json = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/System/Info/Public') return json(200, { ServerName: 'Fake Jelly' })
    if (token !== TOKEN) return json(401, {})
    if (url.pathname === '/System/Info') return json(200, { ServerName: 'Fake Jelly' })
    if (url.pathname === '/Artists/AlbumArtists') {
      const items = [{ Id: ARTIST_ID, Name: 'Album Band', Type: 'MusicArtist' }, { Id: '00000000000000000000000000000021', Name: 'Nightingale', Type: 'MusicArtist' }]
      const l = url.searchParams.get('NameStartsWith')
      const list = l ? items.filter((i) => i.Name.toUpperCase().startsWith(l)) : items
      return json(200, { Items: list, TotalRecordCount: list.length })
    }
    if (url.pathname === '/Items' && url.searchParams.get('AlbumArtistIds') === ARTIST_ID) {
      return json(200, { Items: [{ Id: ALBUM_ID, Name: 'Four Tracks', Type: 'MusicAlbum', AlbumArtist: 'Album Band' }] })
    }
    if (url.pathname === '/Items' && url.searchParams.get('SortBy') === 'SortName' && url.searchParams.get('IncludeItemTypes') === 'MusicAlbum') {
      return json(200, { Items: [{ Id: ALBUM_ID, Name: 'Four Tracks', Type: 'MusicAlbum', AlbumArtist: 'Album Band' }], TotalRecordCount: 1 })
    }
    if (url.pathname === '/Items') {
      return json(200, { Items: [{ Id: SONG_ID, Name: 'Sunrise Song', Type: 'Audio', Artists: ['The Sunbeams'], Album: 'Sunny Album', AlbumId: '00000000000000000000000000000010' }] })
    }
    if (url.pathname === `/Items/${SONG_ID}/Images/Primary`) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(PNG)
    }
    json(404, {})
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, stop: () => new Promise((r) => server.close(r)) }
}
