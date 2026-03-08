import { ChatWindow } from './components/chat/ChatWindow';

function App() {
  return (
    <div className="dark min-h-screen w-full bg-background text-foreground font-sans selection:bg-primary/20">
      <main className="flex flex-col h-screen w-full overflow-hidden">
        <ChatWindow />
      </main>
    </div>
  );
}

export default App;
