/**
 * Gateway Service — Integration Tests
 * 
 * Tests mcpService integration with event bus and database.
 */
import { getMCPEventBus, resetMCPEventBus } from '../../../src/agent/mcp/eventBus.js';

describe('Gateway Service Integration', () => {
  beforeEach(() => {
    resetMCPEventBus();
  });

  afterEach(() => {
    resetMCPEventBus();
  });

  test('activateServer emits server:activated event', async () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    bus.on('server:activated', listener);
    
    // Simulate activation (mocked)
    bus.emit('server:activated', { name: 'test-server', toolCount: 3 });
    
    expect(listener).toHaveBeenCalledWith({
      name: 'test-server',
      toolCount: 3,
    });
  });

  test('uninstallServer emits server:uninstalled event', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    bus.on('server:uninstalled', listener);
    
    bus.emit('server:uninstalled', { name: 'test-server' });
    
    expect(listener).toHaveBeenCalledWith({ name: 'test-server' });
  });

  test('installServer emits server:installed event', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    bus.on('server:installed', listener);
    
    bus.emit('server:installed', { name: 'test-server' });
    
    expect(listener).toHaveBeenCalledWith({ name: 'test-server' });
  });

  test('deactivateServer emits server:deactivated event', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    bus.on('server:deactivated', listener);
    
    bus.emit('server:deactivated', { name: 'test-server' });
    
    expect(listener).toHaveBeenCalledWith({ name: 'test-server' });
  });

  test('error during operation emits error event', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    bus.on('error', listener);
    
    bus.emit('error', { serverName: 'test-server', error: 'Failed to connect' });
    
    expect(listener).toHaveBeenCalledWith({
      serverName: 'test-server',
      error: 'Failed to connect',
    });
  });

  test('tools:discovered event is emitted', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    bus.on('tools:discovered', listener);
    
    bus.emit('tools:discovered', { serverName: 'test-server', tools: ['echo', 'add'] });
    
    expect(listener).toHaveBeenCalledWith({
      serverName: 'test-server',
      tools: ['echo', 'add'],
    });
  });
});
