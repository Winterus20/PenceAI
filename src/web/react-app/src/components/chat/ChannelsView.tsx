import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Radio, Globe, MessageCircle, Gamepad2, Phone, RefreshCw, Check, X, Search } from 'lucide-react';
import { useAgentStore, type Channel } from '../../store/agentStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Kanal tipi için ikon mapping
const channelIcons: Record<string, React.ReactNode> = {
  web: <Globe className="h-5 w-5" />,
  telegram: <MessageCircle className="h-5 w-5" />,
  discord: <Gamepad2 className="h-5 w-5" />,
  whatsapp: <Phone className="h-5 w-5" />,
};

// Mock kanallar - API boş dönerse gösterilecek
const defaultChannels: Channel[] = [
  { id: 'web-dashboard', name: 'Web Dashboard', type: 'web', connected: true },
  { id: 'telegram', name: 'Telegram', type: 'telegram', connected: false },
  { id: 'discord', name: 'Discord', type: 'discord', connected: false },
  { id: 'whatsapp', name: 'WhatsApp', type: 'whatsapp', connected: false },
];

interface ChannelCardProps {
  channel: Channel;
  isSelected: boolean;
  onSelect: (id: string) => void;
}

const ChannelCard: React.FC<ChannelCardProps> = ({ channel, isSelected, onSelect }) => {
  const theme = useAgentStore((state) => state.theme);
  
  return (
    <div
      onClick={() => onSelect(channel.id)}
      className={`
        p-4 rounded-lg border cursor-pointer transition-all duration-200
        ${isSelected 
          ? 'border-primary bg-primary/10 ring-1 ring-primary' 
          : 'border-border hover:border-primary/50 hover:bg-muted/50'
        }
        ${theme === 'dark' ? 'bg-card' : 'bg-white'}
      `}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`
            p-2 rounded-lg
            ${channel.connected 
              ? 'bg-green-500/10 text-green-500' 
              : 'bg-muted text-muted-foreground'
            }
          `}>
            {channelIcons[channel.type] || <Radio className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="font-medium text-foreground">{channel.name}</h3>
            <p className="text-xs text-muted-foreground capitalize">{channel.type}</p>
          </div>
        </div>
        <div className={`
          flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium
          ${channel.connected 
            ? 'bg-green-500/10 text-green-500' 
            : 'bg-muted text-muted-foreground'
          }
        `}>
          {channel.connected ? (
            <>
              <Check className="h-3 w-3" />
              <span>Bağlı</span>
            </>
          ) : (
            <>
              <X className="h-3 w-3" />
              <span>Bağlı Değil</span>
            </>
          )}
        </div>
      </div>
      
      {channel.messageCount !== undefined && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>{channel.messageCount} mesaj</span>
          {channel.lastActivity && (
            <span>Son aktivite: {new Date(channel.lastActivity).toLocaleDateString('tr-TR')}</span>
          )}
        </div>
      )}
    </div>
  );
};

export const ChannelsView: React.FC = () => {
  const { channels, selectedChannel, fetchChannels, setSelectedChannel, setActiveView } = useAgentStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const theme = useAgentStore((state) => state.theme);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  // Kanalları filtrele
  const filteredChannels = useMemo(() => {
    const channelsToShow = channels.length > 0 ? channels : defaultChannels;
    if (!searchQuery.trim()) return channelsToShow;
    
    return channelsToShow.filter((channel) =>
      channel.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      channel.type.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [channels, searchQuery]);

  // Bağlı kanal sayısı
  const connectedCount = useMemo(() => {
    const channelsToCount = channels.length > 0 ? channels : defaultChannels;
    return channelsToCount.filter((ch) => ch.connected).length;
  }, [channels]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchChannels();
    setTimeout(() => setIsRefreshing(false), 500);
  };

  return (
    <div className={`flex flex-col h-full ${theme === 'dark' ? 'bg-background' : 'bg-gray-50'}`}>
      {/* Header with Back Button */}
      <div className="flex flex-col gap-3 px-4 py-3 border-b border-border/40 bg-surface/50">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveView('chat')}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Geri</span>
          </button>
          <div className="flex items-center gap-3 flex-1">
            <div className="p-2 rounded-lg bg-primary/10">
              <Radio className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Kanallar</h1>
              <p className="text-xs text-muted-foreground">
                {connectedCount} / {filteredChannels.length} kanal bağlı
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Yenile
          </Button>
        </div>
        
        {/* Arama */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Kanallarda ara..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Kanal Listesi */}
      <div className="flex-1 overflow-y-auto p-4">
        {filteredChannels.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Radio className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Kanal Bulunamadı</h3>
            <p className="text-sm text-muted-foreground">
              {searchQuery ? 'Arama kriterlerinize uygun kanal bulunamadı.' : 'Henüz kanal yok.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredChannels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                isSelected={selectedChannel === channel.id}
                onSelect={setSelectedChannel}
              />
            ))}
          </div>
        )}
      </div>

      {/* Seçili Kanal Bilgisi */}
      {selectedChannel && (
        <div className="p-4 border-t border-border bg-muted/30">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                Seçili: {filteredChannels.find((c) => c.id === selectedChannel)?.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Bu kanaldan gelen mesajları görüntülemek için sohbet görünümüne geçin.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedChannel(null)}
            >
              Seçimi Kaldır
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
