import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

// Netlify's redirect configuration does not interpolate environment variables.
const configurationError = 'Set BACKEND_URL to the HTTPS origin of your Render backend, without /api or credentials.'
let backend
try { backend = new URL(process.env.BACKEND_URL || '') }
catch { throw new Error(configurationError) }
if (backend.protocol !== 'https:' || backend.username || backend.password || backend.pathname !== '/' || backend.search || backend.hash) {
  throw new Error(configurationError)
}
execFileSync('npm', ['run', 'build'], { stdio: 'inherit', env: { ...process.env, VITE_API_BASE_URL: '/api' } })
writeFileSync('dist/_redirects', `/api/* ${backend.origin}/api/:splat 200!\n/* /index.html 200\n`)
