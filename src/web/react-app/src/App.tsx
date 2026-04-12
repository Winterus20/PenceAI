import { useEffect, lazy, Suspense } from 'react';
import { Toaster } from 'react-hot-toast';
import { ChatWindow } from './components/chat/ChatWindow';
import { ChannelsView } from './components/chat/ChannelsView';
import { useAgentStore } from './store/agentStore';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { QueryProvider } from './providers/QueryProvider';

// Lazy load MCP Marketplace and Metrics Page
const MCPMarketplace = lazy(() => import('./components/mcp/MCPMarketplace'));
const MetricsPage = lazy(() => import('./pages/MetricsPage'));

function App() {
  const activeView = useAgentStore((state) => state.activeView);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('dark');
  }, []);

  // View bazlı render
  const renderView = () => {
    switch (activeView) {
      case 'channels':
        return <ChannelsView />;
      case 'mcp-marketplace':
        return (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Yükleniyor...</div>}>
            <MCPMarketplace />
          </Suspense>
        );
      case 'metrics':
        return (
          <Suspense fallback={<div className="flex items-center justify-center h-full text-muted-foreground">Yükleniyor...</div>}>
            <MetricsPage />
          </Suspense>
        );
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
            background: '#212121',
            color: '#fff',
            border: '1px solid #2f2f2f',
          },
          error: {
            style: {
              background: '#2a1a1a',
              border: '1px solid #5c2020',
            },
            iconTheme: {
              primary: '#ff4b4b',
              secondary: '#fff',
            },
          },
          success: {
            style: {
              background: '#1a2a1a',
              border: '1px solid #205c20',
            },
            iconTheme: {
              primary: '#4caf50',
              secondary: '#fff',
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
