import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';

import './styles/index.css';
import '@wally/ui/styles.css';

import { router } from './router';
import {
  installConnectivityListeners,
  useCaptureQueue,
} from './lib/captureQueue';
import { registerServiceWorker } from './sw-register';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

// Boot the offline capture queue from IndexedDB and start watching connectivity
// before first paint, so a store manager who reopens the app mid-shoot sees
// their pending uploads immediately and they resume on reconnect.
void useCaptureQueue.getState().hydrate();
installConnectivityListeners();

// Register the offline service worker (production only; see sw-register).
registerServiceWorker();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
