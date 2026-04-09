/**
 * Event Bus — Integration Tests
 * 
 * Tests event flow between gateway and agent modules.
 */
import { getMCPEventBus, resetMCPEventBus, MCPEventBus } from '../../../src/agent/mcp/eventBus.js';

describe('Event Bus Integration', () => {
  beforeEach(() => {
    resetMCPEventBus();
  });

  afterEach(() => {
    resetMCPEventBus();
  });

  test('gateway receives server:activated event', () => {
    const bus = getMCPEventBus();
    const gatewayListener = jest.fn();
    
    bus.on('server:activated', gatewayListener);
    bus.emit('server:activated', { name: 'test-server', toolCount: 5 });
    
    expect(gatewayListener).toHaveBeenCalledWith({
      name: 'test-server',
      toolCount: 5,
    });
  });

  test('multiple listeners receive same event', () => {
    const bus = getMCPEventBus();
    const listener1 = jest.fn();
    const listener2 = jest.fn();
    
    bus.on('server:installed', listener1);
    bus.on('server:installed', listener2);
    
    bus.emit('server:installed', { name: 'test-server' });
    
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  test('event flow: install → activate → tools:discovered', () => {
    const bus = getMCPEventBus();
    const events: string[] = [];
    
    bus.on('server:installed', () => events.push('installed'));
    bus.on('server:activated', () => events.push('activated'));
    bus.on('tools:discovered', () => events.push('tools:discovered'));
    
    // Simulate flow
    bus.emit('server:installed', { name: 'test-server' });
    bus.emit('server:activated', { name: 'test-server', toolCount: 3 });
    bus.emit('tools:discovered', { serverName: 'test-server', tools: ['echo', 'add'] });
    
    expect(events).toEqual(['installed', 'activated', 'tools:discovered']);
  });

  test('server:deactivated event is emitted', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    
    bus.on('server:deactivated', listener);
    bus.emit('server:deactivated', { name: 'test-server' });
    
    expect(listener).toHaveBeenCalledWith({ name: 'test-server' });
  });

  test('server:uninstalled event is emitted', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    
    bus.on('server:uninstalled', listener);
    bus.emit('server:uninstalled', { name: 'test-server' });
    
    expect(listener).toHaveBeenCalledWith({ name: 'test-server' });
  });

  test('error event is emitted', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    
    bus.on('error', listener);
    bus.emit('error', { serverName: 'test-server', error: 'Connection failed' });
    
    expect(listener).toHaveBeenCalledWith({
      serverName: 'test-server',
      error: 'Connection failed',
    });
  });

  test('once listener only receives event once', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    
    bus.once('server:installed', listener);
    
    bus.emit('server:installed', { name: 'test-server' });
    bus.emit('server:installed', { name: 'test-server-2' });
    
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ name: 'test-server' });
  });

  test('resetMCPEventBus clears all listeners', () => {
    const bus = getMCPEventBus();
    const listener = jest.fn();
    
    bus.on('server:installed', listener);
    resetMCPEventBus();
    
    const newBus = getMCPEventBus();
    newBus.emit('server:installed', { name: 'test-server' });
    
    expect(listener).not.toHaveBeenCalled();
  });
});
