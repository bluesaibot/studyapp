import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Gallery } from './Gallery'
import { Pill } from './Pill'
import 'katex/dist/katex.min.css'
import './styles.css'

const route = window.location.hash.slice(1)
const view = route === 'pill' ? <Pill /> : route === 'gallery' ? <Gallery /> : <App />
document.documentElement.dataset.route = route || 'main'

createRoot(document.getElementById('root')!).render(view)
