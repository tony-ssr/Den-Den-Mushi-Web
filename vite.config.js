import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  base: process.env.GITHUB_ACTIONS || process.env.DEPLOY_TO_GH_PAGES ? '/Den-Den-Mushi-Web/' : '/',
  server: {
    port: 3000,
    host: true
  }
});
