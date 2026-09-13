import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/ErrorBoundary.tsx'

const desktopBridge = (window as Window & { uiEditorDesktop?: { isDesktop?: boolean } }).uiEditorDesktop;
if (desktopBridge?.isDesktop) document.documentElement.classList.add('desktop-shell');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
