import { useEffect, useState, lazy, Suspense } from 'react'

const StyleGallery = lazy(() => import('./StyleGallery'))

// Development builds only (main.jsx never loads this in a production build). Opens the style gallery on top
// of the app with Ctrl+Shift+G, or when the address ends in #gallery, and closes it again with Esc.
function DevGalleryHost() {
  const [open, setOpen] = useState(() => window.location.hash === '#gallery')

  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!open) return null
  return (
    <Suspense fallback={null}>
      <StyleGallery onClose={() => setOpen(false)} />
    </Suspense>
  )
}

export default DevGalleryHost
