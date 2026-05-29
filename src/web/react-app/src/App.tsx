import { useEffect, lazy, Suspense, type ReactNode } from 'react';
import { Toaster } from 'react-hot-toast';
import { ChatWindow } from './components/chat/ChatWindow';
import { useAgentStore } from './store/agentStore';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { QueryProvider } from './providers/QueryProvider';

// Lazy load views — sadece girildiğinde yüklenir, ilk açılış hızlanır
// ChatWindow eager yüklenir (default view, her zaman ilk açılan sayfa)
const ChannelsView = lazy(() => import('./components/chat/ChannelsView').then(m => ({ default: m.ChannelsView })));
const MCPMarketplace = lazy(() => import('./components/mcp/MCPMarketplace'));
const MetricsPage = lazy(() => import('./components/observability/MetricsPage'));
const SystemLogsView = lazy(() => import('./components/SystemLogsView'));

const SuspenseFallback = () => (
  <div className="flex items-center justify-center h-full text-muted-foreground">Yükleniyor...</div>
);

function LazyViewBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<SuspenseFallback />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

function App() {
  const activeView = useAgentStore((state) => state.activeView);
  const theme = useAgentStore((state) => state.theme);

  // Tema değişikliğini DOM'a uygula (dark class toggle)
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // View bazlı render — chat eager, diğerleri lazy + view-level error boundary
  const renderView = () => {
    switch (activeView) {
      case 'channels':
        return (
          <LazyViewBoundary>
            <ChannelsView />
          </LazyViewBoundary>
        );
      case 'mcp-marketplace':
        return (
          <LazyViewBoundary>
            <MCPMarketplace />
          </LazyViewBoundary>
        );
      case 'metrics':
        return (
          <LazyViewBoundary>
            <MetricsPage />
          </LazyViewBoundary>
        );
      case 'logs':
        return (
          <LazyViewBoundary>
            <SystemLogsView />
          </LazyViewBoundary>
        );
      case 'chat':
      default:
        return (
          <ErrorBoundary>
            <ChatWindow />
          </ErrorBoundary>
        );
    }
  };

  return (
    <QueryProvider>
      <div className="min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary/20">
        <main className="flex flex-col h-screen w-full overflow-hidden">
          {renderView()}
        </main>
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: {
              background: 'hsl(var(--card))',
              color: 'hsl(var(--foreground))',
              border: '1px solid hsl(var(--border))',
            },
            error: {
              style: {
                background: 'hsl(0 84.2% 60.2% / 0.1)',
                border: '1px solid hsl(0 84.2% 60.2% / 0.3)',
              },
              iconTheme: {
                primary: '#ff4b4b',
                secondary: 'hsl(var(--foreground))',
              },
            },
            success: {
              style: {
                background: 'hsl(142 76% 36% / 0.1)',
                border: '1px solid hsl(142 76% 36% / 0.3)',
              },
              iconTheme: {
                primary: '#4caf50',
                secondary: 'hsl(var(--foreground))',
              },
            },
          }}
        />
      </div>
    </QueryProvider>
  );
}

export default App;
