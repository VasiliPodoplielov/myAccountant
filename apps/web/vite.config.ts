import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// GitHub Pages віддає сайт з /<назва-репозиторію>/; deploy.yml передає цей шлях у BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  test: {
    // компонентні тести з Mantine і jsdom повільні, коли файли йдуть паралельно: типові 5 с їм не вистачає
    testTimeout: 15_000,
  },
});
