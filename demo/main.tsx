import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '../src/App.tsx'
import '@fontsource/dm-sans/latin-400.css'
import '@fontsource/dm-sans/latin-500.css'
import '@fontsource/dm-sans/latin-600.css'
import '@fontsource/dm-sans/latin-700.css'
import '@fontsource/manrope/latin-600.css'
import '@fontsource/manrope/latin-700.css'
import '@fontsource/manrope/latin-800.css'
import '../src/styles.css'
import '../src/app.css'
import './demo.css'
import { GuidedTour } from './GuidedTour.tsx'
import { installDemoApi } from './mockApi.ts'

const url = new URL(window.location.href)
if (url.searchParams.get('demo') !== '1') {
  url.searchParams.set('demo', '1')
  window.history.replaceState({}, '', url)
}
installDemoApi()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <GuidedTour />
  </React.StrictMode>,
)
