/**
 * MCP Marketplace — Installed Tab
 *
 * Kurulu MCP server'ları listeler ve yönetmeyi sağlar.
 */

import { useInstalledServers, useToggleServer, useUninstallServer } from '../../../hooks/queries/useMCPServers';
import type { MCPServerRecord } from '../../../services/mcpService';

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    active: { color: 'bg-green-500', label: 'Active' },
    disabled: { color: 'bg-yellow-500', label: 'Disabled' },
    error: { color: 'bg-red-500', label: 'Error' },
    installed: { color: 'bg-gray-500', label: 'Installed' },
  };

  const { color, label } = config[status] ?? { color: 'bg-gray-500', label: status };

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs text-muted-foreground">{label}</span>
    </span>
  );
}

export function InstalledTab() {
  const { data, isLoading, error } = useInstalledServers();
  const toggleMutation = useToggleServer();
  const uninstallMutation = useUninstallServer();

  const servers: MCPServerRecord[] = data?.servers ?? [];
  const summary = data?.summary;

  const handleToggle = (server: MCPServerRecord) => {
    const action = server.status === 'active' ? 'disable' : 'enable';
    toggleMutation.mutate({ name: server.name, action });
  };

  const isToggleDisabled = (server: MCPServerRecord): boolean => {
    return toggleMutation.isPending || server.status === 'error';
  };

  const handleUninstall = (name: string) => {
    if (window.confirm(`Are you sure you want to uninstall "${name}"?`)) {
      uninstallMutation.mutate(name);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-muted-foreground">Loading installed servers...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="text-destructive">Failed to load servers: {error.message}</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-4 gap-2">
          <div className="rounded-lg border bg-card p-3 text-center">
            <div className="text-2xl font-bold">{summary.total}</div>
            <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <div className="text-2xl font-bold text-green-500">{summary.active}</div>
            <div className="text-xs text-muted-foreground">Active</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <div className="text-2xl font-bold text-yellow-500">{summary.disabled}</div>
            <div className="text-xs text-muted-foreground">Disabled</div>
          </div>
          <div className="rounded-lg border bg-card p-3 text-center">
            <div className="text-2xl font-bold text-red-500">{summary.error}</div>
            <div className="text-xs text-muted-foreground">Error</div>
          </div>
        </div>
      )}

      {/* Server List */}
      {servers.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No servers installed. Go to Marketplace to install some!
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <div
              key={server.name}
              className="flex items-center justify-between gap-4 rounded-lg border bg-card p-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">{server.name}</h3>
                  <StatusBadge status={server.status} />
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {server.description || `${server.command} ${server.args.join(' ')}`}
                </p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                  <span>🔧 {server.toolCount} tools</span>
                  <span>📦 {server.source}</span>
                  {server.lastError && (
                    <span className="text-red-500 truncate">⚠️ {server.lastError}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggle(server)}
                  disabled={isToggleDisabled(server)}
                  title={server.status === 'error' ? `Error: ${server.lastError}` : undefined}
                  className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                    server.status === 'active'
                      ? 'bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20'
                      : 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                  }`}
                >
                  {toggleMutation.isPending && toggleMutation.variables?.name === server.name
                    ? '⏳ Loading...'
                    : server.status === 'active'
                      ? '⏸️ Disable'
                      : '▶️ Enable'}
                </button>
                <button
                  onClick={() => handleUninstall(server.name)}
                  disabled={uninstallMutation.isPending}
                  className="inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium bg-red-500/10 text-red-600 hover:bg-red-500/20 disabled:opacity-50"
                >
                  🗑️
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default InstalledTab;
