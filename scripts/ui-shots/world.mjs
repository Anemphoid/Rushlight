// A real Rushlight server with a small, fixed world in it, for taking screenshots of the real client.
// Needs a checkout of Anemphoid/Rushlight-Server with `npm ci` run (RUSHLIGHT_SERVER_DIR, or ../rushlight-server),
// and ffmpeg (its test Jellyfin makes a sine tone). Everything is fixed (names, colours, message times) so two
// runs of the same build give the same pictures.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
export const NOW = Date.UTC(2026, 9, 13, 21, 30, 0) // the clock the browser is given: Oct 13 2026, 21:30 UTC
export const MIN = 60 * 1000
export const HOUR = 60 * MIN
export const DAY = 24 * HOUR

export function serverDir() {
  const dir = process.env.RUSHLIGHT_SERVER_DIR || resolve(here, '..', '..', '..', 'rushlight-server')
  if (!existsSync(join(dir, 'src', 'index.js')) || !existsSync(join(dir, 'node_modules'))) {
    throw new Error(`No runnable Rushlight server at ${dir}. Set RUSHLIGHT_SERVER_DIR to a checkout with npm ci run.`)
  }
  return dir
}

const freePort = () =>
  new Promise((ok, bad) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
    s.on('error', bad)
  })

export async function startWorld() {
  const dir = serverDir()
  const tmp = mkdtempSync(join(tmpdir(), 'rushlight-shots-'))
  const sinks = join(tmp, 'sinks')
  const dbPath = join(tmp, 'shots.db')
  const port = await freePort()
  // the server's own stand-in Jellyfin (a real tone through ffmpeg, so Jellybox really plays)
  const { startFakeJellyfin, TOKEN } = await import(pathToFileURL(join(dir, 'test', 'fake-jellyfin.js')).href)
  const jelly = await startFakeJellyfin({ seconds: 300, ticks: 300 * 1e7 })
  const child = spawn('node', ['src/index.js'], {
    cwd: dir,
    env: {
      ...process.env,
      JWT_SECRET: 'shots-secret-shots-secret-shots-secret-1',
      LIVEKIT_URL: 'ws://127.0.0.1:9',
      LIVEKIT_API_KEY: 'shotskey',
      LIVEKIT_API_SECRET: 'shots-secret-shots-secret-shots-secret-2',
      DB_PATH: dbPath,
      PORT: String(port),
      NODE_OPTIONS: `--require=${join(here, 'fixed-clock.cjs')}`,
      FIXED_NOW: String(NOW),
      JELLYBOX_TEST_SINK_DIR: sinks,
      JELLYBOX_RATE_MAX: '1000',
      LOGIN_LIMIT: '1000',
      REGISTER_LIMIT: '1000',
      JOIN_LIMIT: '1000',
      ACCOUNT_LIMIT: '1000',
      RECOVER_LIMIT: '1000',
      PRESENCE_LIMIT: '100000',
      MUSIC_LIMIT: '100000',
      MUSIC_LINK_LIMIT: '1000'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + '/api/health')).ok) break
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  const call = async (method, path, body, token) => {
    const res = await fetch(url + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`)
    return data
  }
  const stop = async () => {
    child.kill()
    await new Promise((r) => (child.exitCode !== null ? r() : child.on('exit', r)))
    await jelly.stop()
    rmSync(tmp, { recursive: true, force: true })
  }
  return { url, dir, dbPath, call, stop, log: () => log, jelly, jellyToken: TOKEN, password: 'password123' }
}

// The fixed cast and places. Message times are written straight into the database so they are
// relative to NOW (the browser's frozen clock), not to when the script happened to run.
export async function seed(w) {
  const reg = async (name, ack = true) => {
    const a = await w.call('POST', '/api/register', { username: name, password: w.password })
    if (ack) await w.call('POST', '/api/me/recovery-key/ack', {}, a.token)
    return a
  }
  const owner = await reg('Anemphoid')
  const dad = await reg('Dad')
  const mia = await reg('Mia')
  const lone = await reg('Lone') // no servers yet
  const fresh = await reg('Fresh', false) // has not saved a recovery key
  const server = await w.call('POST', '/api/servers', { name: 'Catacombs' }, owner.token)
  const code = await w.call('POST', `/api/servers/${server.id}/codes`, { singleUse: false, expiresInMinutes: null }, owner.token)
  for (const a of [dad, mia]) await w.call('POST', '/api/servers/join', { code: code.code }, a.token)
  await w.call('POST', `/api/servers/${server.id}/members/${dad.id}/admin`, { admin: true }, owner.token)
  // someone who was banned, so the banned list has a row
  const spam = await reg('Spammer')
  await w.call('POST', '/api/servers/join', { code: code.code }, spam.token)
  await w.call('POST', `/api/servers/${server.id}/members/${spam.id}/ban`, { reason: 'posting links' }, owner.token)
  const gaming = await w.call('POST', `/api/servers/${server.id}/channels`, { name: 'Gaming', mode: 'both', persistent: true }, owner.token)
  const lounge = await w.call('POST', `/api/servers/${server.id}/channels`, { name: 'Lounge', mode: 'voice', persistent: false }, owner.token)
  const dnd = await w.call('POST', `/api/servers/${server.id}/channels`, { name: 'D&D', mode: 'both', persistent: true }, owner.token)
  const notes = await w.call('POST', `/api/servers/${server.id}/channels/${dnd.id}/rooms`, { name: 'Session notes', mode: 'text', persistent: true }, owner.token)
  const priv = await w.call('POST', `/api/servers/${server.id}/channels/${gaming.id}/rooms`, { name: 'Private chat', mode: 'both', persistent: false }, owner.token)
  await w.call('PUT', `/api/servers/${server.id}/music`, { address: w.jelly.url, apiKey: w.jellyToken }, owner.token)

  // chat history at fixed times: two days ago, yesterday, today
  const say = async (who, text) => (await w.call('POST', `/api/channels/${gaming.id}/messages`, { text, avatarColor: who.color }, who.token)).id
  const people = { owner: { ...owner, color: '#d9903f' }, dad: { ...dad, color: '#4f8fd6' }, mia: { ...mia, color: '#8fbf6a' } }
  const script = [
    [people.dad, 'Anyone up for the raid on Friday?', 2 * DAY + 3 * HOUR],
    [people.mia, 'I am in. Can we start a bit earlier?', 2 * DAY + 2 * HOUR + 50 * MIN],
    [people.owner, 'Yes, 7 works for me.', 1 * DAY + 20 * HOUR],
    [people.dad, 'Booked. I will bring the snacks.', 1 * DAY + 19 * HOUR + 30 * MIN],
    [people.mia, 'Good morning! Did the patch go out?', 3 * HOUR + 10 * MIN],
    [people.owner, 'It did. Change log is pinned in the Lounge.', 2 * HOUR + 55 * MIN],
    [people.dad, 'This is a much longer message so that the wrapping of long lines in the chat can be seen, including how the time and the name sit above it and how the text lines up with the avatar on the left.', 40 * MIN]
  ]
  const ids = []
  for (const [who, text, ago] of script) ids.push({ id: await say(who, text), ago })
  const wr = createRequire(join(w.dir, 'package.json'))
  const Database = wr('better-sqlite3')
  const db = new Database(w.dbPath)
  for (const { id, ago } of ids) db.prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(NOW - ago, id)
  db.close()
  return { owner, dad, mia, lone, fresh, server, code: code.code, gaming, lounge, dnd, notes, priv }
}
