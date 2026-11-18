import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // dev only: forward /api calls to the Express server — no CORS package needed
      "/api": "http://localhost:3001",
    },
  },
});
