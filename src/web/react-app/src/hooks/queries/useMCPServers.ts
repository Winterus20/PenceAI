/**
 * MCP Marketplace — React Query Hooks
 *
 * MCP server'ları için query ve mutation hook'ları.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mcpService } from '../../services/mcpService';

// Query keys
export const MCP_MARKETPLACE_QUERY_KEY = 'mcp-marketplace';
export const MCP_SERVERS_QUERY_KEY = 'mcp-servers';

/**
 * Marketplace catalog'unu getir.
 */
export function useMarketplace(query?: string) {
  return useQuery({
    queryKey: [MCP_MARKETPLACE_QUERY_KEY, query],
    queryFn: () => mcpService.getMarketplace(query),
    staleTime: 1000 * 60 * 5, // 5 dakika
    refetchOnWindowFocus: false,
  });
}

/**
 * Kurulu server'ları getir.
 */
export function useInstalledServers() {
  return useQuery({
    queryKey: [MCP_SERVERS_QUERY_KEY],
    queryFn: () => mcpService.getInstalledServers(),
    refetchInterval: 10000, // 10 saniyede bir yenile
    staleTime: 0,
  });
}

/**
 * Server kur.
 */
export function useInstallServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mcpService.installServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MCP_SERVERS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [MCP_MARKETPLACE_QUERY_KEY] });
    },
  });
}

/**
 * Server'ı aktif/pasif et.
 */
export function useToggleServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: 'enable' | 'disable' }) =>
      mcpService.toggleServer(name, action),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [MCP_SERVERS_QUERY_KEY] });
      if (!data.success) {
        console.error(`[MCP] Toggle failed: ${data.error}`);
      }
    },
    onError: (error: Error) => {
      console.error(`[MCP] Toggle error: ${error.message}`);
      queryClient.invalidateQueries({ queryKey: [MCP_SERVERS_QUERY_KEY] });
    },
  });
}

/**
 * Server'ı kaldır.
 */
export function useUninstallServer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mcpService.uninstallServer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MCP_SERVERS_QUERY_KEY] });
      queryClient.invalidateQueries({ queryKey: [MCP_MARKETPLACE_QUERY_KEY] });
    },
  });
}

/**
 * Server araçlarını getir.
 */
export function useServerTools(name: string | null) {
  return useQuery({
    queryKey: ['mcp-server-tools', name],
    queryFn: () => mcpService.getServerTools(name!),
    enabled: !!name,
    staleTime: 1000 * 60, // 1 dakika
  });
}

/**
 * Server durumunu getir.
 */
export function useServerStatus(name: string | null) {
  return useQuery({
    queryKey: ['mcp-server-status', name],
    queryFn: () => mcpService.getServerStatus(name!),
    enabled: !!name,
    refetchInterval: 5000, // 5 saniyede bir yenile
  });
}
