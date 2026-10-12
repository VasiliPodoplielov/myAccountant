import '@mantine/core/styles.css';

import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router';
import { App } from './App';
import { AccessGate } from './auth/AccessGate';
import { AuthGate } from './auth/AuthGate';
import { AuthProvider } from './auth/AuthContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider defaultColorScheme="auto">
      {/* HashRouter, бо GitHub Pages не вміє SPA-fallback */}
      <AuthProvider>
        <AuthGate>
          <AccessGate>
            <HashRouter>
              <App />
            </HashRouter>
          </AccessGate>
        </AuthGate>
      </AuthProvider>
    </MantineProvider>
  </StrictMode>,
);
