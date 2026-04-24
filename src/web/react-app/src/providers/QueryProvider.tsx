import React from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

const ReactQueryDevtools = import.meta.env.DEV
  ? (() => {
      const LazyDevtools = React.lazy(() =>
        import('@tanstack/react-query-devtools').then(m => ({ default: m.ReactQueryDevtools }))
      );
      return (props: { initialIsOpen?: boolean }) => (
        <React.Suspense fallback={null}>
          <LazyDevtools initialIsOpen={props.initialIsOpen ?? false} />
        </React.Suspense>
      );
    })()
  : () => null;

export const QueryProvider = ({ children }: { children: React.ReactNode }) => {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools />
    </QueryClientProvider>
  );
};
