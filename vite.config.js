import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defineConfig } from 'vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const apiFunctionUrl = pathToFileURL(path.resolve(dirname, 'api/functions/[name].js')).href
const localApiFunctionNames = new Set([
  'extractInvoiceImage',
  'inventoryExtractInvoiceImage',
  'reviewOrderBeforeSend',
  'inventoryReviewOrderBeforeSend',
  'calculateSmartParsAfterCount',
  'inventoryCalculateSmartParsAfterCount',
])

function localApiFunctionsPlugin() {
  return {
    name: 'taskr-local-api-functions',
    apply: 'serve',
    configureServer(server) {
      console.info('[taskr] local AI API functions enabled at /api/functions/:name')
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        const match = url.pathname.match(/^\/api\/functions\/([^/]+)$/)
        if (!match) {
          next()
          return
        }

        const name = decodeURIComponent(match[1])
        if (!localApiFunctionNames.has(name)) {
          next()
          return
        }

        req.query = { name }
        console.info(`[taskr] ${req.method || 'GET'} /api/functions/${req.query.name}`)
        const { default: handler } = await import(`${apiFunctionUrl}?t=${Date.now()}`)
        await handler(req, res)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  logLevel: 'error', // Suppress warnings, only show errors
  plugins: [react(), localApiFunctionsPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-dom/client'],
  },
});
