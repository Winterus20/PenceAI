import { useEffect, lazy, Suspense } from 'react';
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

  // View bazlı render — chat eager, diğerleri lazy
  const renderView = () => {
    switch (activeView) {
      case 'channels':
        return <Suspense fallback={<SuspenseFallback />}><ChannelsView /></Suspense>;
      case 'mcp-marketplace':
        return <Suspense fallback={<SuspenseFallback />}><MCPMarketplace /></Suspense>;
      case 'metrics':
        return <Suspense fallback={<SuspenseFallback />}><MetricsPage /></Suspense>;
      case 'logs':
        return <Suspense fallback={<SuspenseFallback />}><SystemLogsView /></Suspense>;
      case 'chat':
      default:
        return <ChatWindow />;
    }
  };

  return (
    <QueryProvider>
      <ErrorBoundary>
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
      </ErrorBoundary>
    </QueryProvider>
  );
}

export default App;
