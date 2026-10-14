# The new look, step 1 (Lantern and Slate)

This is the first step of the new uniform UI from the design plan: the colours, type, radii and logo of the two
base skins, on the screens as they are today. **Layouts and behaviour are unchanged on purpose.** Moving things
around (the page layout with Back and Esc, shared components, the new tree, chat and Jellybox layouts, motion)
comes in the next steps, each with its own pull request, so a problem can be traced to one change.

## What changed

- **Skins.** Parchment is now **Lantern** and Cool Slate is now **Slate**, each with a dark and a light mode. The
  stored ids (`parchment`, `cool-slate`) are unchanged, so everyone's saved choice carries over; only the names
  people see changed. The list lives in one place, `src/renderer/src/skins.js`, which Settings, the gallery and the
  tests all read.
- **Skin contract.** `src/renderer/src/styles/contract.js` names everything a skin must set: 37 colours per mode
  (surfaces, text, borders, accent, states, focus ring, selection, scrollbar, speaking ring, voice meter, redaction
  outline, logo) and 8 shape and type names (three fonts, heading weight, four radii). A skin is the file
  `styles/skins/<name>.css`. Nothing else about a skin is code.
- **Type.** Lantern: Fraunces for headings and the wordmark, Public Sans for the interface, IBM Plex Mono for codes.
  Slate: Sora, Manrope, JetBrains Mono. All six are open licence and are bundled (`assets/fonts`, 388 KB, licence
  texts beside them); the client never asks a font server for anything.
- **Logo.** One SVG symbol coloured only by the `--logo-*` tokens, so it follows the skin and the mode (before, its
  colours were written into the SVG and a light skin kept a dark disc).
- **Radii** follow the skin (Lantern rounder, Slate crisper). The title bar is 36 px and uses the rail colour.
- **Focus.** Keyboard focus now shows a ring in every skin (before: the browser default, or none).
- **Danger buttons** are one class (`btn-danger`) with their own readable text colour, replacing eleven inline styles.
- **Fields.** Text fields sit on a sunken surface with a visible edge, in every skin and mode.

## Colour values

The values are the ones in the design plan. These **moved** to pass the contrast check (4.5 to 1 for text,
3 to 1 for controls and icons), and nothing else did:

| Skin and mode | Token | Plan | Now | Why |
| --- | --- | --- | --- | --- |
| Lantern light | text faint | `#7a6a52` | `#6f5f48` | 4.08 to 1 on the rail, 4.33 on a sunken field |
| Lantern light | success | `#3f7d2a` | `#36701f` | 4.40 to 1 on the page |
| Slate light | text faint | `#5f6f82` | `#566679` | 4.29 to 1 on the rail |
| Slate light | success | `#1f8f4e` | `#17753f` | 3.80 to 1 on the page |

Tokens the plan left to be chosen were set from the same palettes: warning, info, overlay, selection, scrollbar,
speaking ring, focus ring, voice meter, danger soft, the text colour on a danger button, and **border strong**.

**Border strong is a decision to confirm.** The plan's borders are very faint (about 1.4 to 1), which is right for
dividers and card edges but leaves a text field with no visible edge. So a text field's edge uses a separate,
stronger token that reaches 3 to 1; dividers and card outlines keep the plan's values. If you would rather have the
faint edge on fields as drawn in the mockups, it is one token per skin (`--border-strong`), but the contrast test would then
need that pair removed.

## Nothing lost

`scripts/ui-shots/compare-controls.mjs` lists, for every screen, each control a person can use (buttons, links,
fields, selects, checkboxes), by name, and whether it is shown and not covered. The 47 screens were taken before
and after: **1,612 usable controls, none lost or hidden**. The only differences: the two skin buttons are renamed, and
three buttons that sit behind the full-screen visualizer view moved into view behind it (they were out of view
before; they are still covered by the view, as they should be). The "before" lists are in `docs/ui-audit/controls-before/`.
The whole suite passes (82 tests, 7 of them new) and the build is clean.

## Checks added

`test/skins.test.mjs`: every skin and mode sets every name; the stored ids and default look; every contrast pair in
the contract passes in all four looks; no rule or component uses a variable nothing defines; no old skin name or
hard-coded logo colour remains. Ten deliberate breakages were each caught.

## Adding a skin

Copy `styles/skins/slate.css`, change the values for both modes, add one line to `skins.js`, import the file in
`main.jsx`, then open the style gallery (`npm run dev`, Ctrl+Shift+G) and run `npm test`.

## Not in this step

The page layout (Back at top left, Esc, left list of sections), the shared components, the tree, voice panel, chat
and Jellybox layouts as drawn in the mockups, the icon set, motion, and the unread bubble. Pictures:
`docs/ui-audit/new-look/` (a selection of the 47).

## Page layout (Settings first)

Full-screen pages use `components/PageShell.jsx`: header (Back, title, "Esc to go back"), a section list on the left, the chosen
section on the right, the body scrolling under the header. Esc goes back unless a field or dialog has the keyboard.
The layout names a skin sets are `--page-header-h`, `--page-title-size`, `--nav-w`, `--nav-gutter`, `--nav-item-radius`,
`--nav-bar-w` (Lantern: rounded soft items; Slate: full-width items with an inset bar). Shared styles are in
`styles/components.css`. Settings has Appearance, Audio, Push to talk, Music, Notifications, Account (signed-in only) and
About. The song pop-up choice lives in `songPrefs.js`, shared with the Jellybox column. Control parity was checked against
`docs/ui-audit/controls-before` over all Settings pictures together (only the skin buttons changed, to cards).

## Server screen

`styles/server-view.css` (after `index.css`, so it wins) restyles the rail (68 px tiles, a bar on the open server), the channel
panel (channels as small-caps headings you can still click, rooms with a voice or text icon, `V/T` badge only on rooms that are both,
bordered badges for persistent and bot, speaking ring in `--speaking`), the footer (person with their mic mode and key, mute / deaf /
admin as one row, mic and out sliders), the chat (52 px header with a history pill, 36 px avatars, a rounded composer with a picture
button and a send arrow whose words stay for screen readers) and the Jellybox column (292 px, big cover). Not copied from the mockups
because the app has nothing behind them: the "Voice connected" card with a leave button (there is no leave-voice action; the voice line
above the chat stays) and the Admin tools button in the chat header (it stays in the footer). Buttons that were a bare `+`, `x` or gear
now have icons and are named by their tooltip text (Add channel, Add room, Delete channel, Delete room, Settings), so the control
comparison shows them as renamed, 290 of them, and nothing else changed.

## Jellybox column (rebuilt)

Header with a fold chevron; the player (cover sized to the window height, progress bar with a knob, round icon buttons with the
old words kept as their names, volume, the Visualizer switch); tabs Up next, Search and Library below it, where only the tab body
scrolls, so the queue and library are one click away instead of a scroll away. With the visualizer on, the cover becomes a small row
and the visualizer window sits under the switch (`viz-on` on the panel; `Visualizer` reports its state through `onEnabledChange`).
Parity: across the three Jellybox pictures only "hide >" changed, to "Hide Jellybox".
