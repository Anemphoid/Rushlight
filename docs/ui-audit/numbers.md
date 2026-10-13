# Raw numbers from scripts/ui-audit.mjs

index.css: 2150 lines, 328 rules, 0 !important
skin blocks: :root | html[data-skin="parchment"][data-mode="light"] | html[data-skin="cool-slate"][data-mode="dark"] | html[data-skin="cool-slate"][data-mode="light"]
skin variables: --bg --panel --line --text --dim --accent --danger --label --on-accent --redact-outline
hard-coded colours outside the skin blocks: 20 uses, 11 distinct
  #000 x5  e.g. index.css:1486 .redacted-author
  #fff x3  e.g. index.css:1486 .redacted-author
  rgba(0, 0, 0, 0.4) x2  e.g. index.css:716 .context-menu
  #ccc x2  e.g. index.css:1760 .viz-message-large
  rgba(0, 0, 0, 0.82) x2  e.g. index.css:1790 .viz-list
  rgba(0, 0, 0, 0.55) x1  e.g. index.css:743 .poll-backdrop
  rgba(0, 0, 0, 0.35) x1  e.g. index.css:1308 .member-expiry-menu
  rgba(0, 0, 0, 0.7) x1  e.g. index.css:1774 .viz-controls
  rgba(0, 0, 0, 0.85) x1  e.g. index.css:1896 .viz-results
  rgba(255, 255, 255, 0.2) x1  e.g. index.css:1896 .viz-results
  rgba(0, 0, 0, 0.45) x1  e.g. index.css:1927 .song-toast
px font sizes: 16px x1, 13px x1, 19px x1
rem font sizes (17 distinct): 0.8125rem x20, 0.75rem x18, 0.6875rem x14, 0.625rem x8, 0.7812rem x6, 0.7188rem x6, 0.875rem x6, 0.8438rem x4, 1.25rem x3, 1rem x3, 0.6562rem x2, 1.0625rem x1, 0.9rem x1, 3rem x1, 1.75rem x1, 1.125rem x1, 0.5625rem x1
radii: 6px x16, 8px x15, 50% x7, 4px x5, 5px x5, 10px x2, 12px x2, 0 x1, 4px 0 0 4px x1, 6px 0 0 6px x1
shadows: 0 4px 16px rgba(0, 0, 0, 0.4) x1 | 0 4px 18px rgba(0, 0, 0, 0.4) x1 | 0 4px 14px rgba(0, 0, 0, 0.35) x1 | 0 0 0 2px var(--accent) x1 | 0 1px 4px #000 x1 | 0 1px 3px #000 x1 | 0 6px 20px rgba(0, 0, 0, 0.45) x1
z-index: 50 x2, 40 x1, 41 x1, 10 x1, 5 x1, 1000 x1, 1100 x1, 60 x1
font families: inherit x10 | ui-monospace, monospace x2 | -apple-system, system-ui, sans-serif x1
motion: transition: none x2 | transition: width 60ms linear x1 | transition: border-radius 0.12s, background 0.12s, color 0.12s x1 | transition: background 0.15s, color 0.15s, transform 0.15s x1 | transition: opacity 0.5s ease x1 | transition: opacity 0.5s ease, transform 0.5s ease x1
keyframes: none
media queries: @media (max-width: 900px) | @media (prefers-reduced-motion: reduce)
distinct px spacing/size values: 42
variables used but undefined: none
variables defined but unused: none
variable use counts: --line 59, --accent 49, --dim 38, --text 36, --bg 22, --danger 21, --panel 17, --label 14, --on-accent 12, --redact-outline 2

components: inline style={{}} blocks total 97
  src/renderer/src/screens/ChannelTreeScreen.jsx: 12
  src/renderer/src/screens/AdminToolsScreen.jsx: 11
  src/renderer/src/screens/SettingsScreen.jsx: 10
  src/renderer/src/screens/ProfileScreen.jsx: 7
  src/renderer/src/components/AvatarCropper.jsx: 6
  src/renderer/src/components/TextChatView.jsx: 6
  src/renderer/src/components/JoinCodesSection.jsx: 5
  src/renderer/src/components/MusicSection.jsx: 4
  src/renderer/src/components/AccountSecuritySection.jsx: 3
  src/renderer/src/components/Avatar.jsx: 3
  src/renderer/src/components/CreateItemForm.jsx: 3
  src/renderer/src/components/MicSpeakerCheck.jsx: 3
  src/renderer/src/components/NowPlayingPanel.jsx: 3
  src/renderer/src/dev/StyleGallery.jsx: 3
  src/renderer/src/screens/LoginScreen.jsx: 3
  src/renderer/src/components/RecoveryKeyScreen.jsx: 2
  src/renderer/src/components/RetentionSection.jsx: 2
  src/renderer/src/visualizer/Visualizer.jsx: 2
  src/renderer/src/App.jsx: 1
  src/renderer/src/components/BrowseSection.jsx: 1
  src/renderer/src/components/ChatImage.jsx: 1
  src/renderer/src/components/ContextMenu.jsx: 1
  src/renderer/src/components/Credits.jsx: 1
  src/renderer/src/components/UserFooter.jsx: 1
  src/renderer/src/components/UserVolumeMenu.jsx: 1
  src/renderer/src/screens/RecoverScreen.jsx: 1
  src/renderer/src/screens/ScreenNamePrompt.jsx: 1
inline style properties: margin 19, background 16, color 15, width 15, marginBottom 15, fontSize 13, display 9, marginTop 9, justifyContent 8, cursor 7, height 6, padding 6, maxWidth 5, textAlign 5, gap 5, fontWeight 3, left 3, top 3, borderRadius 2, border 2, undefined 1, objectFit 1, position 1, transform 1, pointerEvents 1, userSelect 1, aspectRatio 1, marginLeft 1, resize 1, alignItems 1
hard-coded colours in components: #d9903f x4 (src/renderer/src/components/RushlightLogo.jsx:22), #3d2f1c x2 (src/renderer/src/components/RushlightLogo.jsx:10), #241c11 x1 (src/renderer/src/components/RushlightLogo.jsx:10), #b8622a x1 (src/renderer/src/components/RushlightLogo.jsx:16), #4f8fd6 x1 (src/renderer/src/dev/StyleGallery.jsx:246), #8fbf6a x1 (src/renderer/src/dev/StyleGallery.jsx:247), #ffffff x1 (src/renderer/src/imagePrep.js:53), #e0836b x1 (src/renderer/src/screens/ProfileScreen.jsx:7), #4a9d8f x1 (src/renderer/src/screens/ProfileScreen.jsx:7), #7a9d6e x1 (src/renderer/src/screens/ProfileScreen.jsx:7), #6e89b8 x1 (src/renderer/src/screens/ProfileScreen.jsx:7), #a878b8 x1 (src/renderer/src/screens/ProfileScreen.jsx:7)
button classes: btn-secondary x39 | link-btn x37 | btn-primary x30 | (computed class) x19 | btn-secondary np-btn x15 | link-btn danger x4 | tree-add-btn x4 | context-menu-item x2 | win-btn x2 | chat-image-frame x1 | np-tab x1 | link-btn np-toggle x1 | rail-btn rail-add x1 | btn-secondary composer-picture-btn x1 | win-btn close x1 | update-banner-primary x1 | gear-btn admin-tools-btn x1 | gear-btn x1 | btn-secondary gal-close x1 | btn-secondary retry-btn x1 | big-plus small x1 | big-plus x1
buttons with no class: 4
  src/renderer/src/components/UpdateBanner.jsx:27 "setDismissed(true)}> Later"
  src/renderer/src/screens/AdminToolsScreen.jsx:304 "runRowAction(m.accountId, () => api.patchMember(sessionToken, serverId, m.accountId, { accessExpiresInMinutes: o.minutes }) ) } > {o.label}"
  src/renderer/src/screens/ProfileScreen.jsx:104 "pickSwatch(null)} title="Use app logo" style={{ width: 26, height: 26, borderRadius: '50%', border: avatarColor === null ? '2px solid var(--text)' : '1px solid var(--line)', background: 'var(--bg)', cursor: 'pointer', padding: 0 }} /> {AVATAR_COLORS.map((c) => ("
  src/renderer/src/screens/ProfileScreen.jsx:119 "pickSwatch(c)} title={c} style={{ width: 26, height: 26, borderRadius: '50%', border: avatarColor === c ? '2px solid var(--text)' : '1px solid var(--line)', background: c, cursor: 'pointer', padding: 0 }} /> ))}"
back/close/cancel patterns:
  src/renderer/src/components/AvatarCropper.jsx:194 "Cancel" [link-btn]
  src/renderer/src/components/CreateItemForm.jsx:53 "Cancel" [btn-secondary]
  src/renderer/src/components/NowPlayingPanel.jsx:224 "hide &gt;" [link-btn np-toggle]
  src/renderer/src/components/PersistenceVote.jsx:45 "Cancel vote" [btn-secondary]
  src/renderer/src/components/PersistenceVote.jsx:48 "Hide" [btn-primary]
  src/renderer/src/components/ServerDialog.jsx:77 "Cancel" [link-btn]
  src/renderer/src/dev/StyleGallery.jsx:140 "Close" [btn-secondary gal-close]
  src/renderer/src/screens/AdminToolsScreen.jsx:667 "Back" [btn-secondary]
  src/renderer/src/screens/CreateAccountScreen.jsx:95 "Back to login" [link-btn]
  src/renderer/src/screens/HomeScreen.jsx:18 "Dismiss" [link-btn]
  src/renderer/src/screens/ProfileScreen.jsx:147 "Back" [link-btn]
  src/renderer/src/screens/RecoverScreen.jsx:90 "Back to login" [link-btn]
  src/renderer/src/screens/ScreenNamePrompt.jsx:55 "Back" [link-btn]
  src/renderer/src/screens/SettingsScreen.jsx:78 "Back" [btn-secondary]
  src/renderer/src/visualizer/Visualizer.jsx:281 "close (Esc)" [btn-secondary np-btn]
classes used but not styled: gal-chip, gal-close, gal-controls, gal-header, gal-note, gal-num, gal-page, gal-row, gal-section, gal-seg, gal-swatch, gal-swatches, gal-switch, gal-switch-label, gal-switches, gal-table, gal-type, gal-type-row, gal-type-sample, gal-value, redacted-message, side
classes styled but never used: active, active-agree, active-decline, channel-level, clickable, compact, connected, current, drag-over, dragging, drop-target, error, fallback, has-unread, hidden, listening, lost, maximized, on, over-fullscreen, poll-add-form, poll-btn, poll-row, poll-row-actions, poor, room-presence, seekable, speaking, visible, viz-idle, win-icon-max, win-icon-restore
sign in / log in wording:
Title Case button labels:
vague labels: OK (src/renderer/src/components/PersistenceVote.jsx:70)
headings:
  h2 "change password" src/renderer/src/components/AccountSecuritySection.jsx:83
  h2 "recovery key" src/renderer/src/components/AccountSecuritySection.jsx:106
  h2 "delete account" src/renderer/src/components/AccountSecuritySection.jsx:124
  h2 "Choose a picture" src/renderer/src/components/AvatarCropper.jsx:115
  h2 "credits" src/renderer/src/components/Credits.jsx:11
  h2 "invite someone" src/renderer/src/components/JoinCodesSection.jsx:113
  h2 "active codes" src/renderer/src/components/JoinCodesSection.jsx:173
  h2 "music" src/renderer/src/components/MusicSection.jsx:81
  h2 "Keep history in "{proposal.name}"?" src/renderer/src/components/PersistenceVote.jsx:13
  h2 "Vote on "{proposal.name}"" src/renderer/src/components/PersistenceVote.jsx:37
  h2 "{proposal.status === 'passed' ? 'Vote passed' : 'Vote closed'}" src/renderer/src/components/PersistenceVote.jsx:67
  h1 "Save a recovery key" src/renderer/src/components/RecoveryKeyPrompt.jsx:44
  h1 "{title}" src/renderer/src/components/RecoveryKeyScreen.jsx:44
  h2 "history" src/renderer/src/components/RetentionSection.jsx:69
  h2 "Add a server" src/renderer/src/components/ServerDialog.jsx:42
  h2 "{title}" src/renderer/src/dev/StyleGallery.jsx:72
  h1 "Style gallery" src/renderer/src/dev/StyleGallery.jsx:137
  h1 "{isOwner ? 'Owner Tools' : 'Admin Tools'}" src/renderer/src/screens/AdminToolsScreen.jsx:216
  h2 "members" src/renderer/src/screens/AdminToolsScreen.jsx:222
  h2 "banned" src/renderer/src/screens/AdminToolsScreen.jsx:358
  h2 "guests here now" src/renderer/src/screens/AdminToolsScreen.jsx:418
  h2 "hand over ownership" src/renderer/src/screens/AdminToolsScreen.jsx:500
  h2 "delete this server" src/renderer/src/screens/AdminToolsScreen.jsx:581
  h2 "Ban {confirmBan.username}?" src/renderer/src/screens/AdminToolsScreen.jsx:642
  h1 "Create account" src/renderer/src/screens/CreateAccountScreen.jsx:62
  h1 "Couldn't load your servers" src/renderer/src/screens/HomeScreen.jsx:25
  h1 "Welcome back, {screenName}" src/renderer/src/screens/HomeScreen.jsx:33
  h1 "Create your first server" src/renderer/src/screens/HomeScreen.jsx:49
  h1 "Rushlight" src/renderer/src/screens/LoginScreen.jsx:75
  h1 "Your profile" src/renderer/src/screens/ProfileScreen.jsx:72
  h1 "Reset your password" src/renderer/src/screens/RecoverScreen.jsx:54
  h1 "Almost there" src/renderer/src/screens/ScreenNamePrompt.jsx:34
  h1 "Settings" src/renderer/src/screens/SettingsScreen.jsx:82
  h2 "density" src/renderer/src/screens/SettingsScreen.jsx:113
  h2 "icon size" src/renderer/src/screens/SettingsScreen.jsx:129
  h2 "desktop notifications" src/renderer/src/screens/SettingsScreen.jsx:145
  h2 "microphone mode" src/renderer/src/screens/SettingsScreen.jsx:171
  h2 "push-to-talk key" src/renderer/src/screens/SettingsScreen.jsx:195
  h2 "skin" src/renderer/src/screens/SettingsScreen.jsx:212
  h2 "mode" src/renderer/src/screens/SettingsScreen.jsx:228
  h2 "mic / speaker devices" src/renderer/src/screens/SettingsScreen.jsx:244
