import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages віддає сайт з /<назва-репозиторію>/; deploy.yml передає цей шлях у BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
});
