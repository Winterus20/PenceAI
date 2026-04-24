/**
 * Event Bus — Unit Tests
 * 
 * Tests for MCPEventBus class including singleton management,
 * event emission, and listener behavior.
 */

import { 
  getMCPEventBus, 
  resetMCPEventBus,
  MCPEventBus 
} from '../../../src/agent/mcp/eventBus.js';

describe('MCP Event Bus', () => {
  afterEach(() => {
    resetMCPEventBus();
  });

  describe('getMCPEventBus', () => {
    test('returns singleton instance', () => {
      const bus1 = getMCPEventBus();
      const bus2 = getMCPEventBus();
      expect(bus1).toBe(bus2);
    });

    test('returns MCPEventBus instance', () => {
      const bus = getMCPEventBus();
      expect(bus).toBeInstanceOf(MCPEventBus);
    });
  });

  describe('resetMCPEventBus', () => {
    test('allows new instance after reset', () => {
      const bus1 = getMCPEventBus();
      resetMCPEventBus();
      const bus2 = getMCPEventBus();
      expect(bus1).not.toBe(bus2);
    });

    test('reset on null does not throw', () => {
      resetMCPEventBus();
      expect(() => resetMCPEventBus()).not.toThrow();
    });
  });

  describe('emit and listen', () => {
    test('emit and listen to server:activated', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.on('server:activated', listener);
      
      bus.emit('server:activated', { name: 'test-server', toolCount: 5 });
      
      expect(listener).toHaveBeenCalledWith({ name: 'test-server', toolCount: 5 });
    });

    test('emit and listen to server:deactivated', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.on('server:deactivated', listener);
      
      bus.emit('server:deactivated', { name: 'test-server' });
      
      expect(listener).toHaveBeenCalledWith({ name: 'test-server' });
    });

    test('emit and listen to server:installed', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.on('server:installed', listener);
      
      bus.emit('server:installed', { name: 'new-server' });
      
      expect(listener).toHaveBeenCalledWith({ name: 'new-server' });
    });

    test('emit and listen to server:uninstalled', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.on('server:uninstalled', listener);
      
      bus.emit('server:uninstalled', { name: 'old-server' });
      
      expect(listener).toHaveBeenCalledWith({ name: 'old-server' });
    });

    test('emit and listen to tools:discovered', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.on('tools:discovered', listener);
      
      bus.emit('tools:discovered', { serverName: 'test-server', tools: ['tool1', 'tool2'] });
      
      expect(listener).toHaveBeenCalledWith({ serverName: 'test-server', tools: ['tool1', 'tool2'] });
    });

    test('emit and listen to error', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.on('error', listener);
      
      bus.emit('error', { serverName: 'test-server', error: 'Connection failed' });
      
      expect(listener).toHaveBeenCalledWith({ serverName: 'test-server', error: 'Connection failed' });
    });
  });

  describe('once listener', () => {
    test('once listener fires only once', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.once('server:installed', listener);
      
      bus.emit('server:installed', { name: 'test-server' });
      bus.emit('server:installed', { name: 'test-server-2' });
      
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ name: 'test-server' });
    });
  });

  describe('off listener', () => {
    test('off removes listener', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.on('server:activated', listener);
      bus.off('server:activated', listener);
      
      bus.emit('server:activated', { name: 'test-server', toolCount: 5 });
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('multiple listeners', () => {
    test('multiple listeners for same event all fire', () => {
      const bus = getMCPEventBus();
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      bus.on('server:activated', listener1);
      bus.on('server:activated', listener2);
      
      bus.emit('server:activated', { name: 'test-server', toolCount: 5 });
      
      expect(listener1).toHaveBeenCalledWith({ name: 'test-server', toolCount: 5 });
      expect(listener2).toHaveBeenCalledWith({ name: 'test-server', toolCount: 5 });
    });
  });

  describe('reset clears listeners', () => {
    test('reset removes all listeners', () => {
      const bus = getMCPEventBus();
      const listener = jest.fn();
      bus.on('server:activated', listener);
      
      resetMCPEventBus();
      
      const newBus = getMCPEventBus();
      newBus.emit('server:activated', { name: 'test-server', toolCount: 5 });
      
      expect(listener).not.toHaveBeenCalled();
    });
  });
});
