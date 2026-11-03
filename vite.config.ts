import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  server: { port: 4317, strictPort: true },
  plugins: [
    tailwindcss(),
    tanstackStart({ spa: { enabled: true } }),
    // react's vite plugin must come after start's vite plugin
    viteReact(),
  ],
  worker: { format: 'es' },
})
