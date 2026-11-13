import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from './app.tsx'
import './index.css'

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const root = document.getElementById('root')
if (root) createRoot(root).render(<QueryClientProvider client={client}><App /></QueryClientProvider>)
