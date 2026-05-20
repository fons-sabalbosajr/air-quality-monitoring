// Encrypt localStorage & sessionStorage before anything else runs
import './utils/secureStorage'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

function isNlexDisplayPath() {
  const path = window.location.pathname.replace(/\/+$/, '')
  return path === '/nlex' || path === '/air-quality-monitoring/nlex'
}

async function bootstrap() {
  const root = createRoot(document.getElementById('root'))

  if (isNlexDisplayPath()) {
    const { default: NlexLedWall } = await import('./pages/NlexLedWall.jsx')
    root.render(
      <StrictMode>
        <NlexLedWall />
      </StrictMode>,
    )
    return
  }

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

bootstrap()
