/**
 * MCP Marketplace — Ana Bileşen
 *
 * Marketplace ve Installed tab'larını içeren ana bileşen.
 */

import { useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAgentStore } from '../../../store/agentStore';
import MarketplaceTab from './MarketplaceTab';
import InstalledTab from './InstalledTab';

export function MCPMarketplace() {
  const [activeTab, setActiveTab] = useState('marketplace');
  const setActiveView = useAgentStore((state) => state.setActiveView);

  const handleBack = () => {
    setActiveView('chat');
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header with Back Button */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 bg-surface/50">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Geri</span>
        </button>
        <h1 className="text-lg font-semibold text-foreground">MCP Marketplace</h1>
      </div>

      {/* Tabs Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="marketplace">🏪 Marketplace</TabsTrigger>
            <TabsTrigger value="installed">📦 Kurulu Server'lar</TabsTrigger>
          </TabsList>

          <TabsContent value="marketplace" className="mt-4">
            <MarketplaceTab />
          </TabsContent>

          <TabsContent value="installed" className="mt-4">
            <InstalledTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

export default MCPMarketplace;
