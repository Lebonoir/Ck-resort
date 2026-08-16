import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { paymongoPlugin } from './server/paymongoPlugin.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), paymongoPlugin(env)],
    server: {
      port: 5173,
    },
  }
})
