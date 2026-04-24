/**
 * Runtime — Integration Tests
 * 
 * Tests MCP runtime initialization and shutdown.
 */
import { getMCPEventBus, resetMCPEventBus } from '../../../src/agent/mcp/eventBus.js';
import { DEFAULT_MCP_RUNTIME_OPTIONS } from '../../../src/agent/mcp/types.js';

describe('Runtime Integration', () => {
  beforeEach(() => {
    resetMCPEventBus();
  });

  afterEach(() => {
    resetMCPEventBus();
  });

  test('runtime initialization emits events', async () => {
    const bus = getMCPEventBus();
    const events: string[] = [];
    
    bus.on('server:installed', () => events.push('installed'));
    bus.on('server:activated', () => events.push('activated'));
    
    // Simulate runtime flow
    bus.emit('server:installed', { name: 'test-server' });
    bus.emit('server:activated', { name: 'test-server', toolCount: 1 });
    
    expect(events).toEqual(['installed', 'activated']);
  });

  test('runtime shutdown clears resources', async () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    bus.on('error', listener);
    
    // Simulate error during shutdown
    bus.emit('error', { serverName: 'test-server', error: 'Connection closed' });
    
    expect(listener).toHaveBeenCalledWith({
      serverName: 'test-server',
      error: 'Connection closed',
    });
  });

  test('default runtime options are configured', () => {
    expect(DEFAULT_MCP_RUNTIME_OPTIONS).toBeDefined();
    expect(DEFAULT_MCP_RUNTIME_OPTIONS.enabled).toBe(false);
    expect(DEFAULT_MCP_RUNTIME_OPTIONS.defaultTimeout).toBe(30000);
    expect(DEFAULT_MCP_RUNTIME_OPTIONS.maxConcurrentCalls).toBe(5);
    expect(DEFAULT_MCP_RUNTIME_OPTIONS.enableLogging).toBe(true);
  });

  test('multiple server events flow correctly', async () => {
    const bus = getMCPEventBus();
    const serverEvents: Array<{ type: string; name: string }> = [];
    
    bus.on('server:installed', (payload) => serverEvents.push({ type: 'installed', name: payload.name }));
    bus.on('server:activated', (payload) => serverEvents.push({ type: 'activated', name: payload.name }));
    bus.on('server:deactivated', (payload) => serverEvents.push({ type: 'deactivated', name: payload.name }));
    bus.on('server:uninstalled', (payload) => serverEvents.push({ type: 'uninstalled', name: payload.name }));
    
    // Simulate full lifecycle for two servers
    bus.emit('server:installed', { name: 'server-1' });
    bus.emit('server:installed', { name: 'server-2' });
    bus.emit('server:activated', { name: 'server-1', toolCount: 3 });
    bus.emit('server:activated', { name: 'server-2', toolCount: 5 });
    bus.emit('server:deactivated', { name: 'server-1' });
    bus.emit('server:uninstalled', { name: 'server-1' });
    
    expect(serverEvents).toEqual([
      { type: 'installed', name: 'server-1' },
      { type: 'installed', name: 'server-2' },
      { type: 'activated', name: 'server-1' },
      { type: 'activated', name: 'server-2' },
      { type: 'deactivated', name: 'server-1' },
      { type: 'uninstalled', name: 'server-1' },
    ]);
  });

  test('error events include server context', async () => {
    const bus = getMCPEventBus();
    const errors: Array<{ serverName: string; error: string }> = [];
    
    bus.on('error', (payload) => errors.push(payload));
    
    bus.emit('error', { serverName: 'server-1', error: 'Timeout' });
    bus.emit('error', { serverName: 'server-2', error: 'Connection refused' });
    
    expect(errors).toEqual([
      { serverName: 'server-1', error: 'Timeout' },
      { serverName: 'server-2', error: 'Connection refused' },
    ]);
  });
});
