# UI audit (step 0 of the UI refresh)

Written for the owner to read before pull request 2. Nothing in the app was changed to produce it. It comes from
reading the code, from `scripts/ui-audit.mjs` (the counts), and from screenshots of the real production build
against a real server (`scripts/ui-shots/`, pictures in `docs/ui-audit/screens/`).

Build audited: `main` at `46a7d69` (client v0.14.0, server v0.12.0), default look (Parchment, dark, cozy, medium
icons), a 900 by 670 window unless a picture says otherwise.

**Read this first: what the audit could not see.** There is no LiveKit server in the sandbox, so voice never
connects. The voice panel is shown in its "Connection problem" state, nobody is speaking or muted anywhere, and
the visualizer's large view shows "Waiting for Jellybox" instead of a picture. Real window chrome (Electron's
transparent frameless window) is not there either: the title bar is drawn by the app, but the window edge and
shadow are not. The fonts in the pictures are the sandbox's sans-serif, not the owner's system font.

## The short version

1. **The blank bar has a root cause, and it is the Back button's own wrapper.** Section 1.
2. **The corner squares could not be reproduced.** Nothing in the code draws a corner piece, and a 4x zoom of
   fields and buttons in all four looks shows clean rounded corners. Section 2 says what is needed from the owner.
3. **Skins change 9 colour variables and nothing else.** Radii, shadows, spacing, fonts and the logo are all fixed
   in the code, so "a new skin is only a file of values" is not true yet. Adding a skin today also means editing
   `SettingsScreen.jsx` and `App.jsx`, not just the CSS.
4. **Back, close and cancel are said a dozen different ways** (twelve labels, five looks) and the Back button sits in
   three different places. Section 3.
5. **All four skin and mode combinations fail the contrast bar somewhere.** The worst is Cool Slate light, where
   the text on an accent button is 3.61 to 1 (dark brown text on blue). Section 7.
6. **The logo ignores the skin.** Its colours are written into the SVG, so on a light skin it stays a dark disc.
7. **Almost nothing animates.** There are five real `transition` rules and no keyframes in 2,150 lines of CSS, and
   no screen change has any transition at all. The "smooth and relaxing" requirement is a new build, not a polish.
8. **Dialogs are two different things.** Six uses in four components are modal and share a class called
   `poll-backdrop` (named for the persistence vote that came first), and eleven confirmations are inline. None has `role="dialog"`, a
   focus trap or Esc.
9. **Keyboard focus is mostly unstyled.** `:focus-visible` appears once in the whole stylesheet, so buttons show the
   browser's default ring, or none. Esc goes back nowhere.
10. **The unread bubble on server icons is not cheap with today's polling.** Unread is only worked out for the one
    open server. Section 12 has the cost and the way out.
11. **94 inline `style={{ }}` blocks in 26 files** hold margins, widths, colours and font sizes that no skin can
    reach. 17 distinct rem font sizes, 10 radii, 7 shadows and 42 pixel sizes are in use.
12. **Pages are three different widths** (Settings 460, Admin Tools 440, Recovery key 480, the rest 320).

## 1. The blank bar after Settings' Back button

Picture: `41-settings-scrolled-back-bar.png` (and `42-settings-full.png` for the top of the page).

`SettingsScreen.jsx:77` wraps the Back button in `<div className="screen-top-bar">`, and that class is

```css
.screen-top-bar { position: sticky; top: 0; z-index: 5; display: flex; justify-content: flex-end;
                  padding: 0 0 8px; margin-top: -16px; background: var(--bg); }
```

It lives inside `.card`, inside `.screen`, and `.screen` is the scrolling box with 32 px of padding. So:

- The bar is sticky to the top of the scroll box, as intended ("so it never scrolls away").
- Its background is a solid `--bg`, and it spans the whole card width (460 px) although the only thing in it is a
  small button on the right. When the page is scrolled, the content slides under it, and what the owner sees is a
  blank strip across the top of the content, with a lone Back button in it, cutting text off mid-line (the
  "desktop notifications" label in the picture is half hidden).
- The `margin-top: -16px` pulls the bar up over the page title, so even at the top of the page the word
  "Settings" is clipped by it (visible in `40-settings-top.png`: only the lower half of the heading shows).

So the cause is not a stray element: it is a sticky, opaque, card-wide strip that was used to keep one button
reachable. Covering it over (a transparent background, say) would just let the text show through the button.

**Fix, in pull request 3:** a page header outside the scrolling body (the PageShell in step 3), with Back at the
left, the title next to it, and the body scrolling underneath. The `.screen-top-bar` class is then deleted, not
adjusted. Admin Tools has no such bar: its Back button is the last thing at the bottom of a page about 2,000 px
tall (`51-admin-tools-full.png`), which is the other known quirk. Profile and the guest screen-name page have
a third version (an underlined link at the bottom).

## 2. The squares in the corners of text fields and buttons

Pictures: none, because there is nothing to show. 4x crops of a field, a focused field and a button (all four
skin and mode combinations were checked at default size) show clean rounded corners.

What was searched:

- Every `::before` and `::after` in `index.css`: the window icons, the "or" divider lines, the voice status dot, the
  day dividers and the redaction label. None is on a field or a button.
- `clip-path`, `border-image`, `background-image` and gradients: one gradient, the fade under the visualizer
  controls (`.viz-controls`), nowhere else.
- No element in the components draws a decorative corner either.
- The `.field input` rule has `background: transparent` and `border-radius: 8px`, and nothing square sits on top.

So whatever the owner sees, it does not come from the app's own drawing in Chromium. The likely candidate is
Electron's transparent, frameless window on the owner's desktop: `main/index.js` creates the window with
`transparent: true` and the whole app sits in a rounded `.app-shell`, and some Linux compositors draw hard
squares where a transparent window meets translucent or anti-aliased edges. That is a guess, not a finding.

**What would settle it:** a screenshot from the owner's machine with the squares in it (any screen, ideally a
login field), and whether it is the same with `--disable-gpu` or on another desktop. Pull request 8 removes any
decoration from the base skins in any case, so if it is a rendering artifact of rounded boxes on a transparent
window, step 7 is the place to look at it again.

## 3. Back, close, cancel: every pattern in use

| Where | What it says | Looks like | Where on the page |
| --- | --- | --- | --- |
| Settings | Back | secondary button | top right, inside the sticky bar (section 1) |
| Admin Tools | Back | secondary button, full width | bottom of a 2,000 px page |
| Profile | Back | underlined link | bottom |
| Guest screen name | Back | underlined link | bottom |
| Create account, Recover | Back to login | underlined link | bottom |
| Home (tree, nothing open) | Back to home | secondary button | middle of the empty state |
| Server dialog, avatar cropper | Cancel | underlined link | bottom |
| Add channel or room form | Cancel | secondary button | beside Create |
| Delete channel, delete room, ban, revoke, unban, unlink, retention, delete account | Cancel | secondary button | inline, beside the red button |
| Persistence vote | Cancel vote, Hide, OK | secondary, primary, primary | different per mode |
| Home notice | Dismiss | underlined link | top |
| Update banner | Later | button with no class | right |
| Jellybox column | hide > | underlined link | top right of the column |
| Visualizer large view | close (Esc) | secondary button | bottom bar |
| Browse section | back | underlined link, lower case | in the trail |
| Context menus, volume menu | (click away) | backdrop | none |

Esc is handled by exactly two things: the picture lightbox and the large visualizer. No page or dialog closes with
Esc. The decision in the plan (an arrow and the word "Back" at top left, Esc goes back) replaces all of the above.

## 4. How skins, density and icon size work today

- `index.css` lines 1 to 40: `:root` holds Parchment dark, and three `html[data-skin][data-mode]` blocks hold the
  other combinations. Each sets the same **nine** variables: `--bg --panel --line --text --dim --accent --danger
  --label --on-accent` (and `--redact-outline` once, derived from `--text`).
- `App.jsx` keeps `skin` and `mode` in state, writes them to `rushlight-skin` and `rushlight-mode` in localStorage
  and onto `<html>`. The stored ids are `parchment` and `cool-slate`, `dark` and `light`. Plan: keep them.
- `SettingsScreen.jsx` draws the skin buttons from a hard-coded pair, `s === 'parchment' ? 'Parchment' : 'Cool
  Slate'`. **A third skin cannot appear in Settings without editing that file.** The skin list should come from
  one registry (the plan's step 1 file) that the Settings page, the gallery and the checks all read. The gallery
  shell in this pull request already reads the list from the stylesheet, which shows it can be done.
- `--on-accent` is set once, in `:root`, and never by a skin block. That is the cause of the Cool Slate light
  failure in section 7: the dark brown text colour is used on every accent, including blue.
- Density: three root font sizes, 13, 16 and 19 px (`html[data-density]`), plus extra padding on two tree row
  classes (`.channel-row`, `.room-row`, lines 574 to 585). Everything else follows the root size through rem.
  Spacing in pixels does not scale (42 distinct px values for padding, margin, gap and sizes).
- Icon size: two selectors per tier. `[data-icon-size] .user-avatar` and `.tree-add-btn` change; nothing else
  does (not the rail, the title bar icons, the message avatars, the Jellybox cover or the logo). So the "three
  icon tiers" are really two things.
- Fonts: none are bundled and no `@font-face` exists. The body is `-apple-system, system-ui, sans-serif` (one
  rule), codes use `ui-monospace, monospace` (two), everything else says `inherit` (ten). There is no heading
  font. Bundling the four open-licence fonts of the spec is new work, and the content security policy already
  allows same-origin font files (`default-src 'self'`).

## 5. Hard-coded values

From `node scripts/ui-audit.mjs` (its full output is in `docs/ui-audit/numbers.md`):

**Colours outside the skin blocks.** 20 uses, 11 distinct, all in the CSS, plus 10 in the components.

| Value | Uses | Where |
| --- | --- | --- |
| `#000` | 5 | redaction bars and name box, text shadows on the visualizer |
| `#fff`, `#ccc` | 3 and 2 | redacted author text, visualizer messages |
| `rgba(0,0,0, .35 to .85)` | 9 | context menu, poll backdrop, member menu, visualizer controls, song toast |
| `rgba(255,255,255,.2)` | 1 | visualizer search results |

The black and white ones are deliberate (a redaction is black on any skin; the visualizer sits on black). The
translucent blacks are shadows and scrims and should become tokens (overlay, shadow) in step 1.

In the components: `RushlightLogo.jsx` holds four colours in seven places (`#241c11 #3d2f1c #b8622a #d9903f`), so the
logo never changes with the skin or mode (title bar, rail, login, fallback avatar: four uses). `ProfileScreen.jsx`
line 7 holds the five avatar colour choices (`#e0836b #4a9d8f #7a9d6e #6e89b8 #a878b8`), which are data and may
stay. `imagePrep.js` uses white to flatten a picture before saving it as a JPEG, which is also right.

**Type.** 17 distinct rem sizes (`0.5625` to `3`; the commonest are `0.8125` x20, `0.75` x18, `0.6875` x14).
There are no pixel sizes except the three root sizes. A scale of 7 or 8 steps would cover them.

**Radius.** 10 distinct values: `6px` x16, `8px` x15, `50%` x7, `4px` x5, `5px` x5, `10px` x2, `12px` x2, `0`, and two
one-sided ones for joined button groups. Four tokens (small, medium, large, pill) would cover all but the
joined groups.

**Shadows.** 7: four drop shadows on popups (`0 4px 14px .35`, `0 4px 16px .4`, `0 4px 18px .4`, `0 6px 20px .45`:
four values for what is one idea), two text shadows on the visualizer, and one ring made of a shadow.

**Layers.** `z-index` has 8 values: 5, 10, 40, 41, 50 (twice), 60, 1000, 1100. None is named. The picture lightbox
(60), the song toast and the context menu overlap by accident of numbers, not by rule.

**Inline styles.** 94 `style={{ }}` blocks. The most: `ChannelTreeScreen` 12, `AdminToolsScreen` 11,
`SettingsScreen` 10, `ProfileScreen` 7, `AvatarCropper` 6, `TextChatView` 6, `JoinCodesSection` 5. The properties:
margin (19) and marginBottom (15), colour (14), background (14), width (14), fontSize (13), display (9),
marginTop (9). The colours and font sizes written inline are invisible to any skin.

**Pixel widths of the frame.** Sidebar default 260 (resizable), title bar 32, Jellybox column 340, window 900 by 670
with a 640 by 480 minimum, pages 440, 460 and 480 wide.

**CSS hygiene.** No `!important`, no undefined variables, no unused variables (good). 32 class names are styled
and never appear as a string in a component. Most are state classes added with a computed name (`active`, `on`,
`speaking`, `connected`) and are fine, but these look dead and should be checked in pull request 4:
`poll-add-form poll-btn poll-row poll-row-actions` (from an older persistence vote), `channel-level`, `room-presence`,
`fallback`, `poor`, `lost`, `viz-idle`, `clickable`, `compact`. Two classes are used with no style at all:
`side` and `redacted-message`.

## 6. One-off buttons and controls

Class use across the components (counts of `<button>` elements): `btn-secondary` 37, `link-btn` 36, `btn-primary`
28, and 18 more with a computed class. Beyond those three there are at least sixteen more button classes: `np-btn` (15), `tree-add-btn` (4, and also
used on a `<span>` in the Settings preview), `link-btn danger` (3), and one or two each of `context-menu-item`,
`win-btn`, `rail-btn`, `rail-add`, `big-plus`, `gear-btn`, `admin-tools-btn`, `foot-toggle`, `np-tab`, `np-toggle`,
`chat-image-frame`, `composer-picture-btn`, `update-banner-primary` and `retry-btn`.

Four `<button>`s have no class at all: the update banner's "Later", the timed-access options in Admin Tools, and
the 7 avatar swatches in Profile (styled by inline `style`, 26 px circles).

Other findings:

- `.link-btn` is used both as a link and as a Cancel button, and carries a 14 px top margin (it needed overrides in
  the Jellybox queue, the pending-picture strip and the Browse trail). It is the main source of the "button placement
  differs" feeling.
- The global `button` rule sets `width: 100%`, so every inline or paired button needs a `width: auto` override
  (see `.screen-top-bar .btn-secondary`, `.np-btn`, `.composer-picture-btn` and the gallery's rows).
- Text fields: `.field input` is styled; other inputs are styled again per place (`.text-chat-composer input`, the
  Jellybox search box, the visualizer's search bar). The two search boxes in the Jellybox column and in the large
  visualizer view show the browser's default white field in every skin (visible in `30-jellybox-column.png` and
  `33-visualizer-large.png`).
- Toggles are rows of two or three buttons with an "on" look (density, icon size, notifications, mic mode, skin,
  mode, Jellybox style). There is no switch, slider or checkbox component beyond the browser's own, drawn in the
  browser's blue (the "Remember me" and "Pop up when the song changes" boxes are blue on every skin).
- Section headings in Settings and Admin Tools are `h2` set in small italic lower case in the accent colour
  (`change password`, `invite someone`); dialog headings are `h2` in sentence case (`Add a server`); page headings are
  `h1` in Title Case (`Owner Tools`) or sentence case (`Create account`, `Your profile`).
- The gear in the user panel is the character `⚙`, and `×` and `+` are plain characters used as icons. The plan
  says icons always get a label and tooltip; today they get a native `title` only. There is no icon set.

## 7. Contrast today

Measured on the colours the four skin blocks set (the same numbers the gallery shell shows live). Bars from the
plan: 4.5 to 1 for text, 3 to 1 for controls and icons. Failures in bold.

| Pair | Parchment dark | Parchment light | Cool Slate dark | Cool Slate light |
| --- | --- | --- | --- | --- |
| text on page | 13.33 | 11.36 | 12.42 | 12.99 |
| text on panel | 12.40 | 10.51 | 11.10 | 11.86 |
| dim text on page | 7.46 | **4.39** | 5.14 | 4.84 |
| dim text on panel | 6.95 | **4.06** | 4.59 | **4.41** |
| label on page | 6.19 | **4.18** | 5.87 | 5.43 |
| label on panel | 5.76 | **3.87** | 5.24 | 4.95 |
| accent text on page | 6.89 | **3.29** | 4.79 | 4.50 |
| text on accent button | 6.89 | 4.52 | 5.36 | **3.61** |
| danger text on page | 4.51 | 4.80 | **3.80** | 5.42 |
| border on page (controls) | **1.40** | **1.51** | **1.48** | **1.37** |
| accent on panel (controls, icons) | 6.41 | 3.05 | 4.28 | 4.11 |

Reading it: the main text is fine everywhere. Parchment light is the weakest (five text pairs fail). Cool Slate
light puts dark brown text on blue buttons, because of the single `--on-accent` (section 4). Cool Slate dark's
danger red is hard to read on its page. Borders fail the 3 to 1 bar in every look; for most boxes the border is
decoration (the label is the control), but text fields and unlabelled buttons rely on it, so pull request 2
needs to decide which borders are "control edges" before the check is switched on, or it will fail from day one.
The new Lantern and Slate values in the plan are a first pass that has not been through this check; the plan
already says to nudge any that fail and report which moved.

## 8. Wording

- **Log in / Sign in.** The screen says "Log In" (Title Case, button) and "Log in to your account" and "Log out";
  the Music section says "Sign in with" (that is Jellyfin, a different thing, but the word differs); the guest
  chat notice says "sign in with an account"; the server's session messages and code comments say "sign in". The
  decision is "Log in" everywhere.
- **Case.** Buttons are sentence case except "Log In", "Owner Tools", "Admin Tools" (also the heading), "Cool Slate",
  "Voice + Text". The Jellybox column and visualizer use lower case throughout (`hide >`, `remove`, `next`, `previous`,
  `favourite`, `presets`, `style: bars`, `shuffle: on`, `full screen`, `close (Esc)`, `image`, `back`, `songs`).
  `mute`, `deaf`, `mic`, `out`, `owner`, `admin` are lower case on purpose (no-emoji decision), but they and
  the Jellybox labels will need an explicit rule.
- **Vague labels.** "OK" (persistence vote, one place), "Continue" (guest name), "Save" (profile, history),
  "Remove" (admin, member list, profile picture, queue: four different things), "Join" (login) and "Join server"
  (dialog), "Create" (form) and "Create server" and "Create account".
- **Naming the thing.** "Delete it for good" and "Unlink it" say what, via the heading above them, but the button
  itself does not; "Make admin"/"Remove admin" do. The plan's rule is that destructive buttons name the thing.
- **Busy labels.** `Logging in…`, `Saving…`, `Deleting…` use the one-character ellipsis; Browse uses `Loading...`
  with three dots. There are no spinners anywhere, only changed labels.
- **Errors** come straight from the server's `error` text or a thrown message. Two seen in pictures: "Invalid or
  expired session" on the login screen, and "Couldn't connect to voice: could not establish signal connection:
  Failed to fetch" in the voice panel. The second is correct but not friendly.
- **Page names.** "Owner Tools" for owners and "Admin Tools" for admins is by design.
- One word for one thing: "server", "channel", "room" are used consistently in the UI. "Space" appears only in code.

## 9. Motion today

There are five real `transition` rules (a progress bar, a hover colour and transform, a row's radius and colour,
and an opacity fade each for the visualizer's name flash and the song toast) and two `transition: none` lines. There
are no `@keyframes`.
Two `@media (prefers-reduced-motion)` blocks turn off the toast and visualizer transitions.

Everything else snaps: moving between screens (every view is a conditional render), opening a section, opening
the Jellybox column, expanding the visualizer, adding a message. The harness screenshots turn animation off, so
the pictures cannot show this; it was read from the CSS and the components. The motion spec in the plan is all
new work and needs a shared set of duration and easing tokens before any screen is touched.

One structural note for it: `App.jsx` swaps screens by rendering `renderView()` or hiding the tree with
`display: none` (so voice and the tree survive Settings). A crossfade between a hidden tree and a page needs the
outgoing view kept in the DOM for the length of the fade, which is a change to how `App` switches views, not
only CSS.

## 10. Keyboard, focus and dialogs

- Focus: `:focus` styles exist for `.field input`, `.field select` and the chat composer (accent border).
  `:focus-visible` exists once (`.chat-image-frame`). Buttons rely on the browser default.
- Esc: lightbox and large visualizer only.
- Dialogs: six uses in four components (`ServerDialog`, `AvatarCropper`, the three modes of `PersistenceVote`, and the
  Admin Tools ban confirm) are modal and use `.poll-backdrop` and `.poll-card`; none has `role="dialog"`,
  `aria-modal`, a focus trap, focus return, or Esc. Eleven confirmations are inline boxes in the page (delete
  channel, delete room, unban, revoke, remove guest, role change, hand over ownership, delete server, unlink,
  delete account, retention). The pattern
  is not wrong, but the choice between modal and inline has no rule.
- Context menus (`ContextMenu`, `UserVolumeMenu`) close on a click on their backdrop; no keyboard way in or out.
- ARIA: 20 `aria-` attributes in 8 files (the Jellybox column, the chat, the picture view, the song toast, the
  visualizer, Browse, the join codes and the recovery key page). Every other page has none.
- Tooltips are native `title` attributes (the tree's `+` and `×`, the rail, the footer).

## 11. States

Captured: empty chat (`24-chat-empty`), no servers (`12-home-no-servers`), no one banned and no guests (in the
Admin Tools pictures), a form with errors (`02`, `05`, `44`), the session-ended notice (`09`), an update banner
(`13`), the unread dot (`29`), a delete confirmation (`28`), the voice error (every tree picture).
Not captured, because they need real voice or a failure: the connected voice panel, speaking and muted markers,
the "Couldn't load your servers" page, a request in flight (loading), very long names, and the persistence vote.

## 12. Unread today, and what a bubble on every server icon would cost

`ChannelTreeScreen` runs a check every 5 seconds (`unread.observe`). For the **open server only**, it asks for the
messages of every closed text space that is persistent, or ephemeral with someone in it, one request per space,
each returning up to 200 messages, and the unread count is worked out in the browser against the newest id seen.
Other servers have no tree screen, so they are not checked at all.

A bubble on every server icon, anywhere in the app, means checking every server the person belongs to:
servers x text spaces requests every 5 seconds, each sending up to 200 messages. With 3 servers of 5 text spaces
that is 15 requests and up to 3,000 messages every 5 seconds per client, to learn a few numbers. It also cannot
be done by the tree screen, which only exists for the open server, so the check would have to move up into
`App`.

The way out is the item already in the ideas table: server-side unread counts. A single call, something like
`GET /api/unread`, that returns for each of the person's servers the count of messages newer than a read pointer
the client reports (or stores). That needs a server release first, so the plan's order has to give it one pull
request of its own before the bubble ships (the bubble is part of the base skin work). Until then the bubble can
only be right for the open server.

## 13. The pictures

All in `docs/ui-audit/screens/`. `NN` is the order a person meets the screens.

SCREEN_TABLE

## 14. Not captured at all

- Voice: the connected panel, speaking, muted and deafened markers on tree rows, the PTT hint, the mic meter.
- The large visualizer and full screen with a real picture; the song toast over full screen.
- Persistence vote (all three modes), the context menu on a person (volume), the member timed-access list open for
  a member who has one, the retention dry-run confirmation, the owner-refused account deletion with servers named.
- Windows smaller than 640 by 480 (the minimum) and the 900 px breakpoint where the Jellybox column drops under
  the chat.
- Any of the owner's own fonts, and Electron's window edge.

The harness covers most of these in principle; they need either a LiveKit server or a few more scripted steps and
can be added when the screens that show them are reached (pull requests 4 to 6).

## 15. What this changes in the plan

1. **Step 1 needs a skin registry**, not just tokens: one list of skins (id, display name, modes) that Settings, the
   gallery, the completeness test and the contrast check all read. Today the list lives in three places.
2. **`--on-accent` must be a per-skin token** (it already is one in the plan's list, but the migration has to move it
   into every skin block, and Cool Slate light needs a different value).
3. **Decide which borders count as control edges** before the contrast check goes live (section 7).
4. **The logo has to become tokens in pull request 2**, not 8: it is the only hard-coded colour in the components
   that a skin has to reach, and the lint rule from step 1 will flag it anyway.
5. **Page transitions need `App` to keep the outgoing view mounted** for the fade (section 9). That is the first
   piece of motion work and it touches `App.jsx`, which the plan's PR 3 already edits for PageShell.
6. **The unread bubble needs a server change** (section 12). Suggest the owner decides now whether the bubble
   waits for a server release or ships first for the open server only.
7. **Fonts need bundling work** (four families, weights, a CSP check) and a decision on file size: Fraunces and
   Sora are variable fonts of 100 to 300 KB each.
8. **Add an icon set to step 2.** The plan lists IconButton but the app has no icons: the gear, plus, cross and
   arrow are characters.
9. The gallery shell in this pull request is deliberately small. It already shows variables, contrast, type and
   today's controls with the four switches; shared components get rows when they exist.

## How to re-run it

```
npm run build
RUSHLIGHT_SERVER_DIR=../rushlight-server node scripts/ui-shots/run.mjs            # pictures into docs/ui-audit/screens
RUSHLIGHT_SERVER_DIR=../rushlight-server node scripts/ui-shots/run.mjs /tmp/other --dist /path/to/other/out/renderer
node scripts/ui-audit.mjs                                                         # the counts, as markdown
npm run dev, then Ctrl+Shift+G (or add #gallery to the address)                   # the style gallery
```

The harness freezes the clock, uses fixed names and message times, and turns animation and the text caret off, so
two runs of the same build give the same pictures. The live Jellybox pictures and the visualizer are the exception
(a progress bar and a synthetic tone move), and `BASELINE_NOTE`.
