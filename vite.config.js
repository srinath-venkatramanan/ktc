import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/kan-translit-app/', // Initial guess, user can change if repo name differs
  server: {
    '/api/transliterate': {
      target: 'https://aksharamukha-plugin.appspot.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api\/transliterate/, '/api/public'),
    },
  },
})
