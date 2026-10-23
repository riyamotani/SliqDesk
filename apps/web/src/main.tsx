import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HttpError } from './api';
import { App } from './App';
import { AuthProvider, ME_KEY } from './auth';
import { ToastProvider } from './toasts';
import './styles.css';

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    // Any 401 means the session ended (logout elsewhere, removal, expiry):
    // forget the user, which sends the app to the login page.
    onError: (err) => {
      if (err instanceof HttpError && err.status === 401) queryClient.setQueryData(ME_KEY, null);
    },
  }),
  defaultOptions: {
    queries: {
      // Client errors (403, 404, ...) won't fix themselves; only retry others.
      retry: (count, err) => !(err instanceof HttpError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
