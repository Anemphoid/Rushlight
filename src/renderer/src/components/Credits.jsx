import { useState } from 'react'
import butterchurnLicense from '../../../../node_modules/butterchurn/LICENSE?raw'
import presetsLicense from '../../../../node_modules/butterchurn-presets/LICENSE?raw'

// Third-party notices for what is bundled in the app. Butterchurn and its presets are MIT licensed, and
// the license says its notice must travel with the software.
function Credits() {
  const [open, setOpen] = useState(false)
  return (
    <div className="settings-section">
      <h2>credits</h2>
      <p className="settings-note">
        The music visualizer uses Butterchurn, a WebGL port of the Milkdrop visualizer, and the Butterchurn presets
        collection (community Milkdrop presets converted for the web). Both are MIT licensed and are included with
        the app.
      </p>
      <button type="button" className="link-btn" onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide license text' : 'Show license text'}
      </button>
      {open && (
        <>
          <p className="settings-note" style={{ marginTop: 10 }}>butterchurn</p>
          <pre className="license-text">{butterchurnLicense}</pre>
          <p className="settings-note">butterchurn-presets</p>
          <pre className="license-text">{presetsLicense}</pre>
        </>
      )}
    </div>
  )
}

export default Credits
