import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Usa a porta atribuída pelo ambiente (PORT), caindo para 5173 localmente.
  server: { port: Number(process.env.PORT) || 5173 },
})
