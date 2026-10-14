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
  // The sign-in screens have a layout per skin (split for Lantern, a card with tabs for Slate), so the first
  // two are photographed in each skin and mode too.
  const forgot = (p) => p.click('.auth-link:has-text("Forgot password"), .auth-link:has-text("recovery key")')
  const toCreate = (p) => p.click('.auth-link:has-text("Create an account"), .auth-tab:has-text("Create account")')
  await step('login', async () => {
    const p = await newPage()
    await p.waitForSelector('.auth')
    await p.waitForTimeout(400)
    await shot(p, '01-login')
    await p.fill('#auth-username', 'Anemphoid')
    await p.fill('#auth-password', 'not the password')
    await p.click('button:has-text("Log in") >> nth=-1')
    await p.waitForSelector('.auth-error')
    await shot(p, '02-login-error')
    await forgot(p)
    await p.waitForTimeout(500)
    await shot(p, '03-forgot-password')
    await p.context().close()
  })
  for (const [skin, mode, tag] of [['cool-slate', 'dark', 'slate-dark'], ['parchment', 'light', 'lantern-light'], ['cool-slate', 'light', 'slate-light']]) {
    await step('login ' + tag, async () => {
      const p = await newPage({ skin, mode })
      await p.waitForSelector('.auth')
      await p.waitForTimeout(400)
      await shot(p, `01-login-${tag}`)
      const join = p.locator('.auth-tab:has-text("Join with a code")')
      if (await join.count()) {
        await join.click()
        await p.waitForTimeout(400)
        await shot(p, `01-login-join-${tag}`)
      }
      await toCreate(p)
      await p.waitForTimeout(500)
      await shot(p, `04-create-account-${tag}`)
      await p.context().close()
    })
  }
  await step('create account', async () => {
    const p = await newPage()
    await p.waitForSelector('.auth')
    await toCreate(p)
    await p.waitForTimeout(500)
    await shot(p, '04-create-account')
    await p.fill('#auth-new-username', 'Newcomer')
    await p.fill('#auth-new-password', 'short')
    await p.click('button[type=submit]')
    await p.waitForTimeout(500)
    await shot(p, '05-create-account-error')
    await p.fill('#auth-new-password', 'password123')
    await p.fill('#auth-new-confirm', 'password123')
    await p.click('button[type=submit]')
    await p.waitForTimeout(1200)
    await shot(p, '06-recovery-key-new-account')
    await p.context().close()
  })
  await step('guest join', async () => {
    const p = await newPage()
    await p.waitForSelector('.auth')
    await p.fill('#auth-join', cast.code)
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
    await p.click('.home-server-add')
    await p.waitForSelector('text=Add a server')
    await shot(p, '11-add-server-dialog')
    await p.context().close()
  })
  await step('home, long server names', async () => {
    const t = await world.call('POST', '/api/register', { username: 'Wanderer', password: world.password })
    await world.call('POST', '/api/me/recovery-key/ack', {}, t.token)
    for (const name of ['The Ironwood Company of Wandering Lanterns and Lost Maps', 'Quiet Corner', 'Friday Night Raiders']) {
      await world.call('POST', '/api/servers', { name }, t.token)
    }
    const p = await newPage({ session: t.token })
    await p.waitForSelector('.home-server')
    await p.waitForTimeout(500)
    await shot(p, '10-home-long-names')
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
    await q.waitForSelector('.auth')
    await q.waitForTimeout(800)
    await shot(q, '09-login-session-ended')
    await q.context().close()
  })

  // ---------- Jellybox column and the visualizer ----------
  await step('jellybox', async () => {
    const j = await newPage({ session: owner, width: 1240, height: 800 })
    await j.waitForSelector('.home-screen')
    await openServer(j)
    await open(j, 'Gaming')
    await j.fill('.text-chat-composer input:not([type=file])', '/play sunrise')
    await j.click('.text-chat-composer button[type=submit]')
    await j.waitForSelector('.now-playing', { timeout: 20000 })
    await j.waitForTimeout(2500)
    await shot(j, '30-jellybox-column')
    // search and the library: one sheet in place of the player
    await j.click('button[aria-label="Search and library"]')
    await j.waitForTimeout(1200)
    await shot(j, '30-jellybox-library-sheet')
    await j.fill('.np-sheet input[placeholder^="Search songs"]', 'sunrise')
    await j.click('.np-sheet button:has-text("Search")')
    await j.waitForTimeout(800)
    await shot(j, '30-jellybox-search-sheet')
    await j.keyboard.press('Escape')
    await j.waitForTimeout(400)
    if (await j.locator('.np-sheet').count()) throw new Error('Esc did not close the Jellybox sheet')
    await j.click('.np-next')
    await j.waitForTimeout(500)
    await shot(j, '30-jellybox-queue-sheet')
    await j.click('button[aria-label="Back to the player"]')
    await j.waitForTimeout(400)
    if (process.env.UI_SHOTS_MOTION) {
      // with motion allowed, the cover should be part way between big and small shortly after the switch is pressed
      const width = () => j.evaluate(() => Math.round(document.querySelector('.np-cover').getBoundingClientRect().width))
      const before = await width()
      await j.click('.viz-toggle')
      await j.waitForTimeout(120)
      const mid = await width()
      await j.waitForTimeout(700)
      console.log(`cover width: ${before} -> ${mid} (120 ms) -> ${await width()}`)
    } else {
      await j.click('.viz-toggle')
    }
    await j.waitForTimeout(1500)
    await shot(j, '31-visualizer-small-bars')
    const style = j.locator('button:has-text("style:")')
    await style.click()
    await style.click()
    await j.waitForTimeout(2500)
    await shot(j, '32-visualizer-small-milkdrop')
    // two new messages in another room: the open server's icon in the rail gets a red bubble with the count
    await world.call('POST', `/api/channels/${cast.dnd.id}/messages`, { text: 'New session notes are up.' }, cast.dad.token)
    await world.call('POST', `/api/channels/${cast.dnd.id}/messages`, { text: 'And a map.' }, cast.dad.token)
    await j.waitForSelector('.rail-bubble', { timeout: 15000 })
    await j.locator('.viz-canvas, .viz-small canvas, .now-playing canvas').first().click()
    await j.waitForTimeout(3000)
    await shot(j, '33-visualizer-large')
    await j.click('button[aria-label="full screen"]')
    await j.waitForTimeout(800)
    if (!(await j.evaluate(() => !!document.fullscreenElement))) throw new Error('Full screen did not go full screen')
    await shot(j, '33-visualizer-full-screen')
    await j.keyboard.press('Escape')
    await j.waitForTimeout(800)
    if (await j.locator('.viz-large').count()) throw new Error('Esc did not close the big view from full screen')
    if (process.env.UI_SHOTS_MOTION) {
      const w = () => j.evaluate(() => Math.round(document.querySelector('.now-playing')?.getBoundingClientRect().width ?? -1))
      const full = await w()
      await j.click('button[aria-label="Hide Jellybox"]')
      await j.waitForTimeout(120)
      const mid = await w()
      await j.waitForTimeout(500)
      console.log(`  Jellybox column width: ${full} -> ${mid} (120 ms) -> ${await w()} (gone)`)
      if (!(mid > 0 && mid < full)) throw new Error('the Jellybox column does not slide shut')
    } else {
      await j.click('button[aria-label="Hide Jellybox"]')
    }
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
    await q.click('.member-row-actions button:text-is("Ban") >> nth=0')
    await q.waitForTimeout(400)
    await shot(q, '52-admin-ban-confirm')
    await q.click('.rl-dialog button:has-text("Cancel")')
    await q.click('button:has-text("Timed access") >> nth=0')
    await q.waitForTimeout(400)
    await shot(q, '53-admin-timed-access')
    // the other sections, one picture each
    for (const [name, file] of [['Join codes', '51-admin-codes'], ['Banned', '51-admin-banned'], ['Music', '51-admin-music'], ['History', '51-admin-history'], ['Ownership', '51-admin-ownership']]) {
      await q.click(`.rl-nav-item:has-text("${name}")`)
      await q.waitForTimeout(500)
      await tall(q, 1100, () => shot(q, file))
    }
    await q.context().close()
  })
  await step('admin tools with a guest', async () => {
    const g = await world.call('POST', '/api/join', { code: cast.code, screenName: 'Visitor' })
    const q = await newPage({ session: owner })
    await q.waitForSelector('.home-screen')
    await openServer(q)
    await q.click('.admin-tools-btn')
    await q.waitForTimeout(800)
    await q.click('.rl-nav-item:has-text("Guests")')
    await world.call('POST', '/api/presence', { type: 'channel', id: cast.lounge.id }, g.guestToken)
    await q.waitForSelector('text=Visitor', { timeout: 15000 })
    await tall(q, 2300, () => shot(q, '54-admin-tools-with-guest'))
    await q.context().close()
  })

  // ---------- motion (only with UI_SHOTS_MOTION=1: animations are otherwise switched off so pictures match) ----------
  if (process.env.UI_SHOTS_MOTION) {
    await step('motion', async () => {
      const q = await newPage({ session: owner })
      await q.waitForSelector('.home-screen')
      // home -> Settings: the page being left stays under the new one while it fades in
      await q.click('button:has-text("Settings")')
      await q.waitForTimeout(120)
      const mid = await q.evaluate(() => ({
        layers: document.querySelectorAll('.app-content > .vt > .vt-layer').length,
        opacity: Math.round(parseFloat(getComputedStyle(document.querySelector('.app-content > .vt > .vt-in')).opacity) * 100) / 100
      }))
      await q.waitForTimeout(500)
      const after = await q.evaluate(() => document.querySelectorAll('.app-content > .vt > .vt-layer').length)
      console.log(`  screen change: ${mid.layers} layers at 120 ms (incoming opacity ${mid.opacity}), ${after} after`)
      if (mid.layers !== 2 || !(mid.opacity > 0 && mid.opacity < 1) || after !== 1) throw new Error('screen change does not crossfade')
      // Settings -> back
      await q.click('.rl-back')
      await q.waitForTimeout(120)
      const back = await q.evaluate(() => document.querySelectorAll('.app-content > .vt > .vt-layer').length)
      console.log(`  back: ${back} layers at 120 ms`)
      // a mode change fades
      await q.click('button:has-text("Settings")')
      await q.waitForSelector('.rl-skin-card')
      await q.click('.rl-seg button:has-text("Light")')
      await q.waitForTimeout(80)
      const fading = await q.evaluate(() => document.documentElement.classList.contains('look-fade'))
      console.log(`  look change: fade class on = ${fading}`)
      if (!fading) throw new Error('a mode change does not fade')
      await q.context().close()
    })
    await step('motion, overlay over a server', async () => {
      const q = await newPage({ session: owner })
      await q.waitForSelector('.home-screen')
      await openServer(q)
      await q.click('.gear-btn[title="Settings"]')
      await q.waitForTimeout(120)
      const during = await q.evaluate(() => ({
        overlay: document.querySelector('.overlay-layer')?.className,
        treeShown: getComputedStyle(document.querySelector('.tree-screen').closest('.rail-layout').parentElement).display !== 'none'
      }))
      await q.waitForTimeout(500)
      const covered = await q.evaluate(() => getComputedStyle(document.querySelector('.tree-screen').closest('.rail-layout').parentElement).display === 'none')
      await q.click('.rl-back')
      await q.waitForTimeout(120)
      const closing = await q.evaluate(() => ({
        overlay: document.querySelector('.overlay-layer')?.className,
        treeShown: getComputedStyle(document.querySelector('.tree-screen').closest('.rail-layout').parentElement).display !== 'none'
      }))
      await q.waitForTimeout(500)
      const gone = await q.evaluate(() => !document.querySelector('.overlay-layer'))
      console.log(`  overlay: opening ${JSON.stringify(during)}, covered after ${covered}; closing ${JSON.stringify(closing)}, removed ${gone}`)
      if (!during.treeShown || !covered || !closing.treeShown || !/is-out/.test(closing.overlay || '') || !gone) throw new Error('the overlay does not slide in and out over the server')
      await q.context().close()
    })
  }

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
