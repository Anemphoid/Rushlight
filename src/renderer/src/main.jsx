import React, { lazy, Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './styles/fonts.css'
import './styles/skins/lantern.css'
import './styles/skins/slate.css'
import './index.css'
import './styles/components.css'
import './styles/server-view.css'
import './styles/viz-view.css'
import App from './App'

// The style gallery exists in development builds only: `import.meta.env.DEV` is a build-time constant, so a
// production build drops this line and the whole dev/ folder with it.
const DevGalleryHost = import.meta.env.DEV ? lazy(() => import('./dev/DevGalleryHost')) : null

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
