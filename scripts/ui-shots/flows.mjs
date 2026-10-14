// The screens, in the order a person meets them. Each `shot` is one picture named for what it shows.
// Steps that cannot be reached are logged and skipped, so one change in a screen does not stop the rest.
export async function flows(s) {
  const { newPage, world, cast, browser } = s
  const shot = async (p, name, o) => {
    await mask(p).catch(() => {})
    return s.shot(p, name, o)
  }
  const owner = cast.owner.token
  const skipped = []
  const step = async (name, fn) => {
    try {
      await fn()
    } catch (e) {
      skipped.push(`${name}: ${String(e.message).split('\n')[0]}`)
      console.log('  SKIPPED', name, '-', String(e.message).split('\n')[0])
    }
  }
  const tall = async (p, height, fn) => {
    const vp = p.viewportSize()
    await p.setViewportSize({ width: vp.width, height })
    await p.waitForTimeout(200)
    await fn()
    await p.setViewportSize(vp)
  }
  // text the server makes up at random (join codes, recovery words) is replaced by the same text every run
  const mask = (p) =>
    p.evaluate(() => {
      document.querySelectorAll('.code-row-code').forEach((n, i) => (n.textContent = `amber-wolf-${String(1000 + i)}`))
      // the same for any join code or test-server port that shows up in plain text
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      for (let n; (n = walker.nextNode()); ) {
        const t = n.nodeValue
        const u = t.replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:8096').replace(/\b[a-z]+-[a-z]+-\d{4}\b/g, 'amber-wolf-1000')
        if (u !== t) n.nodeValue = u
      }
      document.querySelectorAll('.key-word').forEach((n, i) => {
        const num = n.querySelector('.key-num')
        ;[...n.childNodes].forEach((c) => c !== num && c.remove())
        n.append(document.createTextNode(`word${i + 1}`))
      })
    })
  const look = (p, { density, iconSize } = {}) =>
    p.evaluate(({ density, iconSize }) => {
      if (density) document.documentElement.dataset.density = density
      if (iconSize) document.documentElement.dataset.iconSize = iconSize
    }, { density, iconSize })
  const open = async (p, name) => {
    await p.click(`.channel-row:has-text("${name}"), .room-row:has-text("${name}")`)
    await p.waitForTimeout(700)
  }
  const openServer = async (p) => {
    await p.click('.rail-btn[title="Catacombs"]')
    await p.waitForSelector('.tree-screen')
    await p.waitForTimeout(800)
  }

  // ---------- logged out ----------
  await step('login', async () => {
    const p = await newPage()
    await p.waitForSelector('.card')
    await p.waitForTimeout(400)
    await shot(p, '01-login')
    await p.fill('.field input >> nth=0', 'Anemphoid')
    await p.fill('.field input >> nth=1', 'not the password')
    await p.click('button:has-text("Log In")')
    await p.waitForSelector('.error-text')
    await shot(p, '02-login-error')
    await p.click('button:has-text("Forgot your password")')
    await p.waitForTimeout(500)
    await shot(p, '03-forgot-password')
    await p.context().close()
  })
  await step('create account', async () => {
    const p = await newPage()
    await p.waitForSelector('.card')
    await p.click('button:has-text("Create one")')
    await p.waitForTimeout(500)
    await shot(p, '04-create-account')
    const inputs = p.locator('.field input')
    await inputs.nth(0).fill('Newcomer')
    await inputs.nth(1).fill('short')
    await p.click('button[type=submit]')
    await p.waitForTimeout(500)
    await shot(p, '05-create-account-error')
    await inputs.nth(1).fill('password123')
    if ((await inputs.count()) > 2) await inputs.nth(2).fill('password123')
    await p.click('button[type=submit]')
    await p.waitForTimeout(1200)
    await shot(p, '06-recovery-key-new-account')
    await p.context().close()
  })
  await step('guest join', async () => {
    const p = await newPage()
    await p.waitForSelector('.card')
    await p.fill('input[placeholder^="e.g. amber"]', cast.code)
    await p.click('button:has-text("Join")')
    await p.waitForTimeout(900)
    await shot(p, '07-guest-screen-name')
    await p.context().close()
  })

  // ---------- logged in, before a server is open ----------
  await step('recovery key prompt', async () => {
    const p = await newPage({ session: cast.fresh.token })
    await p.waitForSelector('text=Save a recovery key')
    await shot(p, '08-recovery-key-prompt')
    await p.context().close()
  })
  await step('home', async () => {
    const p = await newPage({ session: owner })
    await p.waitForSelector('.home-screen')
    await p.waitForTimeout(500)
    await shot(p, '10-home')
    await p.click('.big-plus')
    await p.waitForSelector('text=Add a server')
    await shot(p, '11-add-server-dialog')
    await p.context().close()
  })
  await step('home, no servers', async () => {
    const p = await newPage({ session: cast.lone.token })
    await p.waitForSelector('.home-screen')
    await p.waitForTimeout(500)
    await shot(p, '12-home-no-servers')
    await p.context().close()
  })
  await step('update banner', async () => {
    const p = await newPage({ session: owner })
    await p.waitForSelector('.home-screen')
    await p.evaluate(() => window.__cb.updateReady && window.__cb.updateReady({ version: '0.15.0' }))
    await p.waitForTimeout(400)
    await shot(p, '13-update-banner')
    await p.context().close()
  })

  // ---------- a server: tree, voice panel, chat ----------
  const p = await newPage({ session: owner })
  await p.waitForSelector('.home-screen')
  await openServer(p)
  await step('tree nothing open', async () => shot(p, '20-tree-nothing-open'))
  await step('chat and voice', async () => {
    await open(p, 'Gaming')
    await shot(p, '21-chat-and-voice')
  })
  await step('text only room', async () => {
    await open(p, 'Session notes')
    await shot(p, '22-chat-text-only')
  })
  await step('voice only', async () => {
    await open(p, 'Lounge')
    await shot(p, '23-voice-only')
  })
  await step('empty chat', async () => {
    await open(p, 'Private chat')
    await shot(p, '24-chat-empty')
  })
  await step('add channel form', async () => {
    await p.click('.tree-add-btn[title="Add channel"]')
    await p.waitForSelector('.create-form')
    await shot(p, '25-add-channel-form')
    await p.click('.create-form button:has-text("Cancel")')
  })
  await step('add room form', async () => {
    await p.click('.tree-add-btn[title="Add room"] >> nth=0')
    await p.waitForSelector('.create-form')
    await shot(p, '26-add-room-form')
    await p.click('.create-form button:has-text("Cancel")')
  })
  await step('context menu', async () => {
    await p.click('.room-row:has-text("Session notes")', { button: 'right' })
    await p.waitForTimeout(300)
    await shot(p, '27-room-context-menu')
    await p.keyboard.press('Escape')
    await p.mouse.click(600, 400)
  })
  await step('delete confirm', async () => {
    await p.click('.tree-add-btn[title="Delete room"] >> nth=0')
    await p.waitForTimeout(400)
    await shot(p, '28-delete-room-confirm')
    await p.keyboard.press('Escape')
    const no = p.locator('button:has-text("Cancel"), button:has-text("No")')
    if (await no.count()) await no.first().click()
  })
  await step('unread dot', async () => {
    await open(p, 'Gaming')
    await world.call('POST', `/api/channels/${cast.dnd.id}/messages`, { text: 'New session notes are up.' }, cast.dad.token)
    await p.waitForSelector('.unread-dot', { timeout: 15000 })
    await p.waitForTimeout(1500)
    await shot(p, '29-tree-unread-dot')
  })
  await p.context().close()
  await step('session ended notice', async () => {
    const t = await world.call('POST', '/api/register', { username: 'Stale', password: world.password })
    await world.call('POST', '/api/me/recovery-key/ack', {}, t.token)
    await world.call('POST', '/api/me/password', { currentPassword: world.password, newPassword: 'password456' }, t.token)
    const q = await newPage({ session: t.token })
    await q.waitForSelector('.card')
    await q.waitForTimeout(800)
    await shot(q, '09-login-session-ended')
    await q.context().close()
  })

  // ---------- Jellybox column and the visualizer ----------
  await step('jellybox', async () => {
    const j = await newPage({ session: owner, width: 1240, height: 670 })
    await j.waitForSelector('.home-screen')
    await openServer(j)
    await open(j, 'Gaming')
    await j.fill('.text-chat-composer input:not([type=file])', '/play sunrise')
    await j.click('.text-chat-composer button[type=submit]')
    await j.waitForSelector('.now-playing', { timeout: 20000 })
    await j.waitForTimeout(2500)
    await shot(j, '30-jellybox-column')
    await j.click('.np-tabbtn:has-text("Search")')
    await j.waitForTimeout(300)
    await shot(j, '30-jellybox-search-tab')
    await j.click('.np-tabbtn:has-text("Library")')
    await j.waitForTimeout(1200)
    await shot(j, '30-jellybox-library-tab')
    await j.click('.np-tabbtn:has-text("Up next")')
    await j.click('.viz-toggle')
    await j.waitForTimeout(1500)
    await shot(j, '31-visualizer-small-bars')
    const style = j.locator('button:has-text("style:")')
    await style.click()
    await style.click()
    await j.waitForTimeout(2500)
    await shot(j, '32-visualizer-small-milkdrop')
    await j.locator('.viz-canvas, .viz-small canvas, .now-playing canvas').first().click()
    await j.waitForTimeout(3000)
    await shot(j, '33-visualizer-large')
    await j.keyboard.press('Escape')
    await j.waitForTimeout(500)
    await j.click('button[aria-label="Hide Jellybox"]')
    await j.waitForTimeout(500)
    await shot(j, '34-jellybox-folded')
    await j.context().close()
  })

  // ---------- Settings, Profile, Admin Tools ----------
  await step('settings', async () => {
    const q = await newPage({ session: owner })
    await q.waitForSelector('.home-screen')
    await q.click('button:has-text("Settings")')
    await q.waitForSelector('.rl-page-header')
    await shot(q, '40-settings-top')
    // every section in turn
    const nav = (name) => q.click(`.rl-nav-item:has-text("${name}")`)
    for (const [name, file] of [['Audio', '41-settings-audio'], ['Push to talk', '42-settings-ptt'], ['Music', '43-settings-music'], ['Notifications', '46-settings-notifications'], ['About', '47-settings-about']]) {
      await nav(name)
      await q.waitForTimeout(300)
      await shot(q, file)
    }
    // the account forms, answered with an error
    await nav('Account')
    const press = (label) =>
      q.evaluate((label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label).click(), label)
    await press('Change password')
    await q.waitForTimeout(300)
    await press('Delete my account')
    await q.waitForTimeout(400)
    await tall(q, 2300, () => shot(q, '44-settings-form-errors'))
    await q.context().close()
  })
  await step('new recovery key', async () => {
    const q = await newPage({ session: owner })
    await q.waitForSelector('.home-screen')
    await q.click('button:has-text("Settings")')
    await q.waitForSelector('.rl-page-header')
    await q.click('.rl-nav-item:has-text("Account")')
    const pw = q.locator('input[type=password]')
    await pw.nth(3).fill(world.password)
    await q.click('button:has-text("Make a new recovery key")')
    await q.waitForSelector('text=Save your new recovery key')
    await shot(q, '45-settings-new-recovery-key')
    await q.context().close()
  })
  await step('avatar cropper', async () => {
    const q = await newPage({ session: owner })
    await q.waitForSelector('.home-screen')
    await openServer(q)
    await q.click('.user-footer-top')
    await q.waitForTimeout(600)
    const b64 = await q.evaluate(() => {
      const c = document.createElement('canvas')
      c.width = 400
      c.height = 300
      const g = c.getContext('2d')
      const grad = g.createLinearGradient(0, 0, 400, 300)
      grad.addColorStop(0, '#d9903f')
      grad.addColorStop(1, '#4f8fd6')
      g.fillStyle = grad
      g.fillRect(0, 0, 400, 300)
      return c.toDataURL('image/png').split(',')[1]
    })
    await q.click('button:has-text("Upload a picture")')
    await q.waitForSelector('input[type=file]', { state: 'attached' })
    await q.waitForTimeout(400)
    await shot(q, '46-avatar-cropper-empty')
    await q.setInputFiles('input[type=file]', { name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from(b64, 'base64') })
    await q.waitForTimeout(800)
    await shot(q, '47-avatar-cropper')
    await q.context().close()
  })
  await step('profile', async () => {
    const q = await newPage({ session: owner })
    await q.waitForSelector('.home-screen')
    await openServer(q)
    await q.click('.user-footer-top')
    await q.waitForTimeout(600)
    await shot(q, '43-profile')
    await q.context().close()
  })
  await step('admin tools', async () => {
    const q = await newPage({ session: owner })
    await q.waitForSelector('.home-screen')
    await openServer(q)
    await q.click('.admin-tools-btn')
    await q.waitForTimeout(1200)
    await shot(q, '50-admin-tools-top')
    await tall(q, 2300, () => shot(q, '51-admin-tools-full'))
    await q.click('button:has-text("Ban") >> nth=0')
    await q.waitForTimeout(400)
    await shot(q, '52-admin-ban-confirm')
    await q.click('.poll-backdrop button:has-text("Cancel")')
    await q.click('button:has-text("Timed access") >> nth=0')
    await q.waitForTimeout(400)
    await shot(q, '53-admin-timed-access')
    await q.context().close()
  })
  await step('admin tools with a guest', async () => {
    const g = await world.call('POST', '/api/join', { code: cast.code, screenName: 'Visitor' })
    const q = await newPage({ session: owner })
    await q.waitForSelector('.home-screen')
    await openServer(q)
    await q.click('.admin-tools-btn')
    await q.waitForTimeout(800)
    await world.call('POST', '/api/presence', { type: 'channel', id: cast.lounge.id }, g.guestToken)
    await q.waitForSelector('text=Visitor', { timeout: 15000 })
    await tall(q, 2300, () => shot(q, '54-admin-tools-with-guest'))
    await q.context().close()
  })

  // ---------- skins, modes, densities, icon sizes ----------
  for (const [skin, mode] of [['parchment', 'dark'], ['parchment', 'light'], ['cool-slate', 'dark'], ['cool-slate', 'light']]) {
    await step(`look ${skin} ${mode}`, async () => {
      const q = await newPage({ session: owner, skin, mode })
      await q.waitForSelector('.home-screen')
      await openServer(q)
      await open(q, 'Gaming')
      await shot(q, `60-look-${skin}-${mode}-chat`)
      await q.context().close()
    })
  }
  for (const [density, iconSize] of [['compact', 'small'], ['comfortable', 'large']]) {
    await step(`look ${density}`, async () => {
      const q = await newPage({ session: owner })
      await q.waitForSelector('.home-screen')
      await openServer(q)
      await open(q, 'Gaming')
      await look(q, { density, iconSize })
      await q.waitForTimeout(300)
      await shot(q, `61-look-${density}-icons-${iconSize}`)
      await q.context().close()
    })
  }
  if (skipped.length) console.log('\nSkipped steps:\n' + skipped.join('\n'))
  s.skipped = skipped
}
