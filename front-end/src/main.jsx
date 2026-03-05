// Encrypt localStorage & sessionStorage before anything else runs
import './utils/secureStorage'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import 'antd/dist/reset.css'
import './index.css'
import 'leaflet/dist/leaflet.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter basename="/air-quality-monitoring">
      <App />
    </BrowserRouter>
  </StrictMode>,
)
