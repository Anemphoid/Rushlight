import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './styles/fonts.css'
import './styles/skins/lantern.css'
import './styles/skins/slate.css'
import './index.css'
import './styles/components.css'
import './styles/server-view.css'
import './styles/viz-view.css'
import './styles/auth.css'
import './styles/home.css'
import './styles/pieces.css'
import './styles/motion.css'
import App from './App'

// The style gallery exists in development builds only: `import.meta.env.DEV` is a build-time constant, so a
// production build drops this line and the whole dev/ folder with it.
const DevGalleryHost = import.meta.env.DEV ? lazy(() => import('./dev/DevGalleryHost')) : null

// Which system this is (Electron's `process.platform`, given by the preload), so the page can match it: see `data-platform` in index.css.
try {
  if (window.api && window.api.platform) document.documentElement.dataset.platform = window.api.platform
} catch {
  // a plain browser (the screenshot harness) has no preload
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    {DevGalleryHost && (
      <Suspense fallback={null}>
        <DevGalleryHost />
      </Suspense>
    )}
  </React.StrictMode>
)
