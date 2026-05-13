import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes("node_modules/recharts")) return "vendor-charts";
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "vendor-react";
          return undefined;
        }
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:5055"
    }
  }
});
