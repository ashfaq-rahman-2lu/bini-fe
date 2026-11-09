import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthGate } from './Auth'
import './styles.css'

const client = new QueryClient({ defaultOptions: {
  queries: { refetchOnWindowFocus: false, refetchOnReconnect: false, refetchInterval: false, retry: 1, staleTime: 0 },
  mutations: { retry: false },
} })

createRoot(document.getElementById('root')!).render(
  <StrictMode><QueryClientProvider client={client}><BrowserRouter><AuthGate><App /></AuthGate></BrowserRouter></QueryClientProvider></StrictMode>,
)
