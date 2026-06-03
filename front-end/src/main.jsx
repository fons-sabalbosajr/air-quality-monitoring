import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import embLogo from './assets/emblogo.svg'
import bpLogo from './assets/bplogo.svg'

function getNormalizedPath() {
  return window.location.pathname.replace(/\/+$/, '')
}

function isNlexBrowserPreview() {
  const path = getNormalizedPath()
  if (path.endsWith('/nlex-preview')) return true
  const params = new URLSearchParams(window.location.search)
  const mode = String(params.get('mode') || params.get('preview') || '')
  return /^(browser|full|test|1|true)$/i.test(mode)
}

function isNlexDisplayPath() {
  const path = getNormalizedPath()
  return (
    path === '/nlex' ||
    path === '/nlex-preview' ||
    path === '/air-quality-monitoring/nlex' ||
    path === '/air-quality-monitoring/nlex-preview'
  )
}

function renderNlexNativeFallback() {
  const root = document.getElementById('root')
  if (!root) return
  document.title = 'EMB R3 Air Quality Display'
  const configuredApiBase = String(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
  const pathBase = getNormalizedPath().startsWith('/air-quality-monitoring')
    ? '/air-quality-monitoring'
    : ''
  const isLocalPreview = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(window.location.hostname)
  const base = isLocalPreview ? (configuredApiBase || pathBase) : (pathBase || configuredApiBase)

  root.innerHTML = `
    <style>
      html,body,#root{width:100%;height:100%;margin:0;background:#f4f7fb;overflow:hidden}
      .nf-root{width:100vw;height:100vh;display:flex;align-items:center;justify-content:center;background:#f4f7fb;color:#152033;font-family:Arial,Helvetica,sans-serif}
      .nf-wall{width:min(100vw,62.5vh);height:min(100vh,160vw);max-width:960px;max-height:1536px;background:#fff;padding:24px;box-sizing:border-box;display:flex;flex-direction:column;gap:16px;border-radius:14px}
      .nf-head{display:flex;align-items:center;gap:18px;padding-bottom:14px;border-bottom:2px solid #d5deea}
      .nf-logos{display:flex;align-items:center;gap:10px;flex:0 0 auto}
      .nf-logo{width:72px;height:72px;object-fit:contain;background:#fff;border-radius:50%;padding:5px;box-sizing:border-box}
      .nf-logo-bp{background:transparent;border-radius:0;padding:0}
      .nf-agency{font-size:28px;font-weight:800;line-height:1.08;text-transform:uppercase}
      .nf-region{font-size:18px;font-weight:700;color:#486176;margin-top:4px;text-transform:uppercase}
      .nf-title{text-align:center;font-size:36px;font-weight:900;line-height:1.05;text-transform:uppercase}
      .nf-grid{flex:1;min-height:0;display:grid;grid-template-columns:1fr 1fr;gap:14px}
      .nf-card{min-width:0;min-height:0;background:#f8fbff;border:4px solid #94a3b8;border-radius:18px;padding:14px 12px;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
      .nf-station{font-size:29px;font-weight:900;line-height:1.08;text-transform:uppercase;color:#142033}
      .nf-param{font-size:27px;font-weight:900;line-height:1.05;text-transform:uppercase;color:#255174;margin-top:8px}
      .nf-aqi{font-size:116px;font-weight:900;line-height:.9;font-variant-numeric:tabular-nums;margin:12px 0 10px}
      .nf-status{width:100%;box-sizing:border-box;border-radius:12px;padding:12px 10px;font-size:28px;font-weight:900;line-height:1.08;text-transform:uppercase}
      .nf-time{font-size:21px;font-weight:800;color:#486176;line-height:1.25;text-transform:uppercase;margin-top:12px}
      .nf-legend{display:grid;grid-template-columns:repeat(6,1fr);gap:5px}
      .nf-band{padding:10px 4px;text-align:center;font-size:15px;font-weight:900;line-height:1.08;text-transform:uppercase;border-radius:10px}
      .nf-empty{display:flex;align-items:center;justify-content:center;text-align:center;font-size:32px;font-weight:900;color:#486176;text-transform:uppercase}
      .nf-foot{display:flex;justify-content:space-between;gap:14px;color:#255174;font-size:19px;font-weight:700;border-top:2px solid #d5deea;padding-top:12px}
      .nf-contact{display:flex;align-items:center;gap:12px;min-width:0;white-space:nowrap}
      .nf-icon{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 4px;border-radius:7px;background:#e8eff8;color:#255174;font-size:14px;font-weight:900;line-height:1;margin-right:5px;box-sizing:border-box}
      .nf-fb{font-family:Arial,Helvetica,sans-serif;font-size:17px}
      .nf-sep{color:#94a3b8}
      .nf-hidden{display:none!important}
      .nf-dark{background:#07111f;color:#f8fafc}
      .nf-dark .nf-wall{background:#0b1526}
      .nf-dark .nf-head{border-bottom-color:#334155}
      .nf-dark .nf-region,.nf-dark .nf-time{color:#cbd5e1}
      .nf-dark .nf-card{background:#101c30;border-color:#334155}
      .nf-dark .nf-station{color:#f8fafc}
      .nf-dark .nf-param{color:#dbeafe}
      .nf-dark .nf-foot{color:#dbeafe;border-top-color:#334155}
    </style>
    <div class="nf-root" id="nf-root">
      <main class="nf-wall">
        <header class="nf-head" id="nf-head">
          <div class="nf-logos">
            <img class="nf-logo nf-logo-bp" src="${bpLogo}" alt="Bagong Pilipinas">
            <img class="nf-logo" src="${embLogo}" alt="EMB">
          </div>
          <div>
            <div class="nf-agency">Environmental Management Bureau</div>
            <div class="nf-region">Region III - Central Luzon</div>
          </div>
        </header>
        <div class="nf-title" id="nf-title">Air Quality Monitoring</div>
        <section class="nf-grid" id="nf-grid"></section>
        <section class="nf-legend" id="nf-legend"></section>
        <footer class="nf-foot" id="nf-foot">
          <span class="nf-contact"><span><span class="nf-icon">WEB</span>r3.emb.gov.ph</span><span class="nf-sep">|</span><span><span class="nf-icon nf-fb">f</span>facebook.com/EMBRegion3</span></span>
          <span id="nf-clock"></span>
        </footer>
      </main>
    </div>
  `

  const bands = [
    { name: 'Good', color: '#52c41a', text: '#fff', min: 0, max: 50, emoji: '&#128522;' },
    { name: 'Fair', color: '#d4b106', text: '#1a2340', min: 51, max: 100, emoji: '&#128528;' },
    { name: 'Unhealthy for Sensitive Groups', color: '#fa8c16', text: '#fff', min: 101, max: 150, emoji: '&#128567;' },
    { name: 'Very Unhealthy', color: '#f5222d', text: '#fff', min: 151, max: 200, emoji: '&#128560;' },
    { name: 'Acutely Unhealthy', color: '#722ed1', text: '#fff', min: 201, max: 300, emoji: '&#128561;' },
    { name: 'Emergency', color: '#a8071a', text: '#fff', min: 301, max: 500, emoji: '&#9760;&#65039;' },
  ]
  const defaultSettings = {
    stationsVisible: { clark: true, 'san-fernando': true, meycauayan: true, zambales: true },
    pollutantsVisible: {
      clark_pm10: true,
      'san-fernando_pm10': true,
      meycauayan_pm10: true,
      meycauayan_pm25: true,
      zambales_pm10: true,
      zambales_pm25: true,
    },
    theme: 'light',
    showHeader: true,
    showAqiLegend: true,
    showFooter: true,
    showDateTime: true,
  }
  let currentSettings = defaultSettings
  let latestPayload = null
  const bundleStorageKey = 'aqm_nlex_latest_bundle'
  const stations = [
    { station: 'Clark', parameter: 'PM10', key: 'clark:pm10', stationKey: 'clark', pollutantKey: 'clark_pm10' },
    { station: 'San Fernando', parameter: 'PM10', key: 'san-fernando:pm10', stationKey: 'san-fernando', pollutantKey: 'san-fernando_pm10' },
    { station: 'Meycauayan', parameter: 'PM10', key: 'meycauayan:pm10', stationKey: 'meycauayan', pollutantKey: 'meycauayan_pm10' },
    { station: 'Meycauayan', parameter: 'PM2.5', key: 'meycauayan:pm25', stationKey: 'meycauayan', pollutantKey: 'meycauayan_pm25' },
    { station: 'Zambales', parameter: 'PM10', key: 'zambales:pm10', stationKey: 'zambales', pollutantKey: 'zambales_pm10' },
    { station: 'Zambales', parameter: 'PM2.5', key: 'zambales:pm25', stationKey: 'zambales', pollutantKey: 'zambales_pm25' },
  ]
  function getBand(value) {
    const n = Number(value)
    if (!Number.isFinite(n)) return null
    if (n <= 50) return bands[0]
    if (n <= 100) return bands[1]
    if (n <= 150) return bands[2]
    if (n <= 200) return bands[3]
    if (n <= 300) return bands[4]
    return bands[5]
  }
  function formatClockDate(d) {
    if (!d || Number.isNaN(d.getTime())) return ''
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const yyyy = d.getFullYear()
    let h = d.getHours()
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    return `${mm}/${dd}/${yyyy} ${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`
  }
  function parseDisplayTime(value) {
    if (!value) return null
    const raw = String(value).trim()
    const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i)
    if (match) {
      let h = Number(match[4])
      const ampm = String(match[7] || '').toUpperCase()
      if (ampm === 'PM' && h < 12) h += 12
      if (ampm === 'AM' && h === 12) h = 0
      const d = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]), h, Number(match[5]), Number(match[6] || 0))
      return Number.isNaN(d.getTime()) ? null : d
    }
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  function formatTime(item) {
    const fromTime = item?.time ? new Date(item.time) : null
    if (fromTime && !Number.isNaN(fromTime.getTime())) return formatClockDate(fromTime)
    const fromDisplay = parseDisplayTime(item?.displayTime)
    if (fromDisplay) return formatClockDate(fromDisplay)
    const fromFetched = item?.fetchedAt ? new Date(item.fetchedAt) : null
    return fromFetched && !Number.isNaN(fromFetched.getTime()) ? formatClockDate(fromFetched) : ''
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char])
  }
  function mergeSettings(settings) {
    settings = settings && typeof settings === 'object' ? settings : {}
    return {
      ...defaultSettings,
      ...settings,
      stationsVisible: { ...defaultSettings.stationsVisible, ...(settings.stationsVisible || {}) },
      pollutantsVisible: { ...defaultSettings.pollutantsVisible, ...(settings.pollutantsVisible || {}) },
    }
  }
  function readStoredSettings() {
    return defaultSettings
  }
  function isVisible(item) {
    const stationsVisible = currentSettings.stationsVisible || defaultSettings.stationsVisible
    const pollutantsVisible = currentSettings.pollutantsVisible || defaultSettings.pollutantsVisible
    return stationsVisible[item.stationKey] !== false && pollutantsVisible[item.pollutantKey] !== false
  }
  function readStoredBundle() {
    return null
  }
  function writeStoredBundle(payload) {
    void payload
  }
  function clearLegacyStorage() {
    try { localStorage.removeItem(bundleStorageKey) } catch {}
    try { localStorage.removeItem('nlex-settings') } catch {}
  }
  function renderCards(payload) {
    if (payload?.data) {
      latestPayload = payload
      writeStoredBundle(payload)
    }
    const grid = document.getElementById('nf-grid')
    if (!grid) return
    const visible = stations.filter(isVisible)
    grid.style.gridTemplateColumns = visible.length <= 2 ? '1fr' : '1fr 1fr'
    if (!visible.length) {
      grid.innerHTML = '<div class="nf-empty">No AQI cards selected</div>'
      return
    }
    grid.innerHTML = visible.map(({ station, parameter, key }) => {
      const item = payload?.data?.[key]
      const aqi = item?.row ? Number(item.row.AQI ?? item.row.aqi) : null
      const band = getBand(aqi)
      const color = band?.color || '#475569'
      const text = band?.text || '#fff'
      const label = band ? `${band.emoji} ${band.name}` : 'Updating'
      const time = formatTime(item)
      return `<article class="nf-card" style="border-color:${color}">
        <div class="nf-station">${station} AQI</div>
        <div class="nf-param">${parameter}</div>
        <div class="nf-aqi" style="color:${color}">${Number.isFinite(aqi) ? Math.round(aqi) : '--'}</div>
        <div class="nf-status" style="background:${color};color:${text}">${label}</div>
        <div class="nf-time">${time ? `<span class="nf-icon">&#128339;</span>As of ${escapeHtml(time)}` : 'Loading latest data'}</div>
      </article>`
    }).join('')
  }
  function renderLegend() {
    const legend = document.getElementById('nf-legend')
    if (!legend) return
    legend.innerHTML = bands.map((band) =>
      `<div class="nf-band" style="background:${band.color};color:${band.text}">${band.emoji} ${band.name}<br>${band.min}-${band.max}</div>`
    ).join('')
  }
  function tickClock() {
    const clock = document.getElementById('nf-clock')
    if (!clock) return
    const now = new Date()
    let h = now.getHours()
    const ampm = h >= 12 ? 'PM' : 'AM'
    h = h % 12 || 12
    clock.innerHTML = `<span class="nf-icon">&#128339;</span>${h}:${String(now.getMinutes()).padStart(2, '0')} ${ampm}`
  }
  function applySettings(payload) {
    if (payload?.settings) currentSettings = mergeSettings(payload.settings)
    const nativeRoot = document.getElementById('nf-root')
    const head = document.getElementById('nf-head')
    const title = document.getElementById('nf-title')
    const legend = document.getElementById('nf-legend')
    const foot = document.getElementById('nf-foot')
    const clock = document.getElementById('nf-clock')
    if (nativeRoot) nativeRoot.className = `nf-root${currentSettings.theme === 'dark' ? ' nf-dark' : ''}`
    if (head) head.className = `nf-head${currentSettings.showHeader === false ? ' nf-hidden' : ''}`
    if (title) title.className = `nf-title${currentSettings.showHeader === false ? ' nf-hidden' : ''}`
    if (legend) legend.className = `nf-legend${currentSettings.showAqiLegend === false ? ' nf-hidden' : ''}`
    if (foot) foot.className = `nf-foot${currentSettings.showFooter === false ? ' nf-hidden' : ''}`
    if (clock) clock.className = currentSettings.showDateTime === false ? 'nf-hidden' : ''
    renderCards(latestPayload)
  }
  function loadJsonp(id, callback, url) {
    const old = document.getElementById(id)
    if (old?.parentNode) old.parentNode.removeChild(old)
    const script = document.createElement('script')
    script.id = id
    script.async = true
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${callback}&t=${Date.now()}`
    document.body.appendChild(script)
  }
  window.__aqmNlexFallbackData = renderCards
  window.__aqmNlexFallbackSettings = applySettings
  function loadData() {
    loadJsonp('nf-data-script', '__aqmNlexFallbackData', `${base}/api/nlex-latest.js`)
  }
  function loadSettings() {
    loadJsonp('nf-settings-script', '__aqmNlexFallbackSettings', `${base}/api/nlex-settings.js`)
  }
  clearLegacyStorage()
  latestPayload = readStoredBundle()
  currentSettings = readStoredSettings()
  applySettings(null)
  renderCards(latestPayload)
  renderLegend()
  tickClock()
  loadSettings()
  loadData()
  setInterval(tickClock, 60_000)
  setInterval(loadData, 60_000)
  setInterval(loadSettings, 5_000)
}

async function bootstrap() {
  // The actual VNNOX / LED wall display (plain /nlex and /nlex?fallback=1) is
  // rendered by the lightweight ES5 fallback inlined in index.html. That keeps the
  // LED wall working even when this modern ES-module bundle cannot execute on the
  // signage browser, and guarantees the wall always shows the current UI. Only the
  // explicit browser preview (?mode=browser or /nlex-preview) loads the richer
  // React display below.
  if (isNlexDisplayPath() && !isNlexBrowserPreview()) {
    return
  }

  const root = createRoot(document.getElementById('root'))

  // VNNOX and similar signage editors often preview web pages inside a
  // sandboxed cross-origin iframe where Web Storage may be blocked. Keep the
  // /nlex boot path as small and storage-tolerant as possible.
  if (isNlexBrowserPreview()) {
    await import('./utils/secureStorage')
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
  renderNlexNativeFallback()
})
