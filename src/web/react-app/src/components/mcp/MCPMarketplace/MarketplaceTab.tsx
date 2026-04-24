/**
 * MCP Marketplace — Marketplace Tab
 *
 * Mevcut MCP server catalog'unu gösterir ve kurulum yapmayı sağlar.
 */

import { useState, useMemo } from 'react';
import { useMarketplace, useInstallServer } from '../../../hooks/queries/useMCPServers';
import type { MCPServerCatalogEntry } from '../../../services/mcpService';

export function MarketplaceTab() {
  const [searchQuery, setSearchQuery] = useState('');
  // Tüm veriyi bir kez çek, query parametresi gönderme
  const { data, isLoading, error } = useMarketplace();
  const installMutation = useInstallServer();

  // Client-side filtreleme + duplicate kaldırma
  const catalog: MCPServerCatalogEntry[] = useMemo(() => {
    const allServers = data?.catalog ?? [];
    // Duplicate server'ları kaldır (name bazlı)
    const uniqueServers = allServers.filter(
      (server, index, self) => self.findIndex(s => s.name === server.name) === index
    );
    if (!searchQuery.trim()) return uniqueServers;
    const query = searchQuery.toLowerCase();
    return uniqueServers.filter(
      (server) =>
      server.name.toLowerCase().includes(query) ||
      server.description.toLowerCase().includes(query) ||
      (server.tags ?? []).some((tag) => tag.toLowerCase().includes(query))
    );
  }, [data?.catalog, searchQuery]);

  const handleInstall = (server: MCPServerCatalogEntry) => {
    installMutation.mutate({
      name: server.name,
      description: server.description,
      command: server.command,
      args: server.defaultArgs,
      env: {},
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading marketplace...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-destructive">Failed to load marketplace: {error.message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search MCP servers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        />
      </div>

      {/* Server Cards */}
      {catalog.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No servers found in the catalog.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {catalog.map((server) => (
            <div
              key={server.name}
              className="rounded-lg border bg-card p-4 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm truncate">{server.name}</h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                    {server.description}
                  </p>
                </div>
                {server.icon && <span className="text-xl">{server.icon}</span>}
              </div>

              {/* Tags */}
              <div className="flex flex-wrap gap-1 mt-3">
                {(server.tags ?? []).slice(0, 3).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs"
                  >
                    {tag}
                  </span>
                ))}
                {(server.tags?.length ?? 0) > 3 && (
                  <span className="text-xs text-muted-foreground">+{server.tags!.length - 3}</span>
                )}
              </div>

              {/* Tools count */}
              <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
                <span>🔧 {server.tools?.length ?? 0} tools</span>
                {server.author && <span>• by {server.author}</span>}
              </div>

              {/* Install Button */}
              <button
                onClick={() => handleInstall(server)}
                disabled={installMutation.isPending}
                className="w-full mt-3 inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {installMutation.isPending ? 'Installing...' : 'Install'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MarketplaceTab;
