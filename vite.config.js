import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { defineConfig } from 'vite'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const apiFunctionPath = path.resolve(dirname, 'api/functions/[name].js')
const apiFunctionUrl = pathToFileURL(apiFunctionPath).href

function localApiFunctionsPlugin() {
  return {
    name: 'taskr-local-api-functions',
    apply: 'serve',
    configureServer(server) {
      console.info('[taskr] local API functions enabled at /api/functions/:name')
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://localhost')
        const match = url.pathname.match(/^\/api\/functions\/([^/]+)$/)
        if (!match) {
          next()
          return
        }

        req.query = { name: decodeURIComponent(match[1]) }
        console.info(`[taskr] ${req.method || 'GET'} /api/functions/${req.query.name}`)
        try {
          // ssrLoadModule tracks the import graph, so edits to api/_lib/*.js
          // take effect on the next request without restarting the dev server.
          let handler
          try {
            ;({ default: handler } = await server.ssrLoadModule(apiFunctionPath))
          } catch {
            ;({ default: handler } = await import(`${apiFunctionUrl}?t=${Date.now()}`))
          }
          await handler(req, res)
        } catch (error) {
          console.error(`[taskr] local API function ${req.query.name} failed`, error)
          if (!res.headersSent) {
            res.statusCode = error.status || 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: error.message || 'Local API function failed' }))
          } else {
            res.end()
          }
        }
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
