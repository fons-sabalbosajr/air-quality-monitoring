import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function isNlexDisplayPath() {
  const path = window.location.pathname.replace(/\/+$/, '')
  return path === '/nlex' || path === '/air-quality-monitoring/nlex'
}

async function bootstrap() {
  const root = createRoot(document.getElementById('root'))

  // VNNOX and similar signage editors often preview web pages inside a
  // sandboxed cross-origin iframe where Web Storage may be blocked. Keep the
  // /nlex boot path as small and storage-tolerant as possible.
  if (isNlexDisplayPath()) {
    const { default: NlexLedWall } = await import('./pages/NlexLedWall.jsx')
    root.render(
      <StrictMode>
        <NlexLedWall />
      </StrictMode>,
    )
    return
  }

  // Encrypt localStorage & sessionStorage before the main admin/kiosk app runs.
  await import('./utils/secureStorage')
  await import('antd/dist/reset.css')
  await import('./index.css')
  await import('leaflet/dist/leaflet.css')

  const [{ BrowserRouter }, { default: App }] = await Promise.all([
    import('react-router-dom'),
    import('./App.jsx'),
  ])

  root.render(
    <StrictMode>
      <BrowserRouter basename="/air-quality-monitoring">
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

bootstrap().catch((err) => {
  console.error('[bootstrap] Unable to start app', err)
  const root = document.getElementById('root')
  if (!root) return
  root.innerHTML = `
    <div style="width:100vw;height:100vh;margin:0;display:flex;align-items:center;justify-content:center;background:#0a0f1e;color:#f8fafc;font-family:Arial,sans-serif;text-align:center;padding:32px;box-sizing:border-box;">
      <div>
        <div style="font-size:28px;font-weight:700;margin-bottom:10px;">EMB R3 Air Quality Display</div>
        <div style="font-size:16px;color:#cbd5e1;">Unable to load the live display. Please refresh the VNNOX web page item.</div>
      </div>
    </div>
  `
})
