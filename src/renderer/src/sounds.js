// Rushlight's branded sounds. Fixed on purpose — not user-configurable.
// Any file in assets/sounds whose base name matches is picked up at build
// time, whatever its extension; a missing file simply stays silent.
const files = import.meta.glob('./assets/sounds/*.{wav,flac,mp3,ogg}', {
  eager: true,
  query: '?url',
  import: 'default'
})

const urls = {}
for (const [path, url] of Object.entries(files)) {
  const base = path.split('/').pop().replace(/\.[^.]+$/, '')
  urls[base] = url
}

export function playSound(name, volume = 1) {
  const url = urls[name]
  if (!url) return
  const audio = new Audio(url)
  audio.volume = volume
  audio.play().catch(() => {
    // autoplay restrictions or a decode problem — never worth surfacing
  })
}
