// Runs the client's real api.js against a real Rushlight server process.
//
// The server lives in its own repository. Point RUSHLIGHT_SERVER_DIR at a
// checkout of it (with `npm ci` already run). CI checks out a pinned release;
// locally, a checkout next to this one at ../rushlight-server is picked up.
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function serverDir() {
  const dir = process.env.RUSHLIGHT_SERVER_DIR || resolve(here, '..', '..', 'rushlight-server')
  if (!existsSync(join(dir, 'src', 'index.js')) || !existsSync(join(dir, 'node_modules'))) {
    throw new Error(
      `No runnable Rushlight server at ${dir}. Check out Anemphoid/Rushlight-Server, run npm ci in it, ` +
        'and set RUSHLIGHT_SERVER_DIR to that folder.'
    )
  }
  return dir
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => resolvePort(port))
    })
    s.on('error', reject)
  })
}

export async function startServer(env = {}) {
  const dir = serverDir()
  const tmp = mkdtempSync(join(tmpdir(), 'rushlight-client-test-'))
  const port = await freePort()
  const child = spawn('node', ['src/index.js'], {
    cwd: dir,
    env: {
      ...process.env,
      JWT_SECRET: 'test-secret-test-secret-test-secret-test',
      LIVEKIT_URL: 'ws://127.0.0.1:9',
      LIVEKIT_API_KEY: 'testkey',
      LIVEKIT_API_SECRET: 'test-secret-test-secret-test-secret-12',
      DB_PATH: join(tmp, 'test.db'),
      PORT: String(port),
      LOGIN_LIMIT: '1000',
      REGISTER_LIMIT: '1000',
      JOIN_LIMIT: '1000',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let log = ''
  child.stdout.on('data', (d) => (log += d))
  child.stderr.on('data', (d) => (log += d))
  let exited = false
  child.on('exit', () => (exited = true))

  const url = `http://127.0.0.1:${port}`
  for (let i = 0; i < 100; i++) {
    if (exited) throw new Error('the server exited while starting:\n' + log)
    try {
      if ((await fetch(url + '/api/health')).ok) break
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  return {
    url,
    log: () => log,
    stop: async () => {
      child.kill()
      await new Promise((r) => (exited ? r() : child.on('exit', r)))
      rmSync(tmp, { recursive: true, force: true })
    }
  }
}

// api.js reads the server address through the Electron preload bridge. In a test
// there is no Electron, so provide the same one-function bridge.
export function installBridge(url) {
  globalThis.window = { api: { getServerConfig: async () => ({ serverUrl: url }) } }
}

export async function rejection(promise) {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected the call to be rejected, but it succeeded')
}
