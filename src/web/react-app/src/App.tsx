import { useEffect } from 'react';
import { Toaster } from 'react-hot-toast';
import { ChatWindow } from './components/chat/ChatWindow';
import { ChannelsView } from './components/chat/ChannelsView';
import { useAgentStore } from './store/agentStore';
import { ErrorBoundary } from './components/ui/ErrorBoundary';

function App() {
  const theme = useAgentStore((state) => state.theme);
  const activeView = useAgentStore((state) => state.activeView);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // View bazlı render
  const renderView = () => {
    switch (activeView) {
      case 'channels':
        return <ChannelsView />;
      case 'chat':
      default:
        return <ChatWindow />;
    }
  };

  return (
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
            background: theme === 'dark' ? '#1f1f1f' : '#ffffff',
            color: theme === 'dark' ? '#fff' : '#1a1a1a',
            border: theme === 'dark' ? '1px solid #333' : '1px solid #e5e5e5',
          },
          error: {
            style: {
              background: theme === 'dark' ? '#2a1a1a' : '#fef2f2',
              border: theme === 'dark' ? '1px solid #5c2020' : '1px solid #fecaca',
            },
            iconTheme: {
              primary: '#ff4b4b',
              secondary: '#fff',
            },
          },
          success: {
            style: {
              background: theme === 'dark' ? '#1a2a1a' : '#f0fdf4',
              border: theme === 'dark' ? '1px solid #205c20' : '1px solid #bbf7d0',
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
  );
}

export default App;
