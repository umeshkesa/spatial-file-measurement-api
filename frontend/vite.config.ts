import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    // Playwright owns e2e/ (npm run test:e2e); keep it out of vitest runs.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
  },
})
