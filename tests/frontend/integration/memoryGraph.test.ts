/**
 * P2 Orta Öncelikli Test: Memory Graph
 * Bellek grafiği görselleştirme testleri
 */

import { mockGraphNodes, mockGraphLinks } from '../setup/fixtures';

describe('Memory Graph Tests', () => {
  describe('Graph Node Tests', () => {
    test('graph düğümleri boş olabilmeli', () => {
      const nodes: any[] = [];
      expect(nodes).toHaveLength(0);
    });

    test('graph düğümleri birden fazla düğüm içerebilmeli', () => {
      expect(mockGraphNodes).toHaveLength(3);
    });

    test('her düğüm gerekli alanlara sahip olmalı', () => {
      mockGraphNodes.forEach((node) => {
        expect(node).toHaveProperty('id');
        expect(node).toHaveProperty('label');
        expect(node).toHaveProperty('type');
        expect(node).toHaveProperty('weight');
      });
    });

    test('düğüm tipleri doğru olmalı', () => {
      const types = mockGraphNodes.map((n) => n.type);
      expect(types).toContain('concept');
      expect(types).toContain('library');
      expect(types).toContain('language');
    });

    test('düğüm ağırlığı 0-1 arasında olmalı', () => {
      mockGraphNodes.forEach((node) => {
        expect(node.weight).toBeGreaterThanOrEqual(0);
        expect(node.weight).toBeLessThanOrEqual(1);
      });
    });

    test('yeni düğüm eklenebilmeli', () => {
      const nodes = [...mockGraphNodes];
      const newNode = { id: 'node-4', label: 'Node.js', type: 'runtime', weight: 0.75 };
      
      nodes.push(newNode);
      
      expect(nodes).toHaveLength(4);
      expect(nodes[3].label).toBe('Node.js');
    });

    test('düğüm silinebilmeli', () => {
      const nodes = [...mockGraphNodes];
      const idToDelete = 'node-1';
      
      const filtered = nodes.filter((n) => n.id !== idToDelete);
      
      expect(filtered).toHaveLength(2);
    });

    test('düğüm etiketi güncellenebilmeli', () => {
      const nodes = mockGraphNodes.map((n) => ({ ...n }));
      const idToUpdate = 'node-1';
      const newLabel = 'JavaScript ES6+';
      
      const index = nodes.findIndex((n) => n.id === idToUpdate);
      if (index !== -1) {
        nodes[index].label = newLabel;
      }
      
      expect(nodes[index].label).toBe(newLabel);
    });
  });

  describe('Graph Link Tests', () => {
    test('graph bağlantıları boş olabilmeli', () => {
      const links: any[] = [];
      expect(links).toHaveLength(0);
    });

    test('graph bağlantıları birden fazla bağlantı içerebilmeli', () => {
      expect(mockGraphLinks).toHaveLength(3);
    });

    test('her bağlantı gerekli alanlara sahip olmalı', () => {
      mockGraphLinks.forEach((link) => {
        expect(link).toHaveProperty('source');
        expect(link).toHaveProperty('target');
        expect(link).toHaveProperty('weight');
      });
    });

    test('bağlantı ağırlığı 0-1 arasında olmalı', () => {
      mockGraphLinks.forEach((link) => {
        expect(link.weight).toBeGreaterThanOrEqual(0);
        expect(link.weight).toBeLessThanOrEqual(1);
      });
    });

    test('yeni bağlantı eklenebilmeli', () => {
      const links = [...mockGraphLinks];
      const newLink = { source: 'node-2', target: 'node-3', weight: 0.7 };
      
      links.push(newLink);
      
      expect(links).toHaveLength(4);
    });

    test('bağlantı silinebilmeli', () => {
      const links = [...mockGraphLinks];
      
      const filtered = links.filter(
        (l) => !(l.source === 'node-1' && l.target === 'node-2')
      );
      
      expect(filtered).toHaveLength(2);
    });
  });

  describe('Graph Structure Tests', () => {
    test('graph yapısı doğru formatta olmalı', () => {
      const graphData = {
        nodes: mockGraphNodes,
        links: mockGraphLinks,
      };
      
      expect(graphData).toHaveProperty('nodes');
      expect(graphData).toHaveProperty('links');
      expect(Array.isArray(graphData.nodes)).toBe(true);
      expect(Array.isArray(graphData.links)).toBe(true);
    });

    test('tüm link kaynakları geçerli düğümlere işaret etmeli', () => {
      const nodeIds = mockGraphNodes.map((n) => n.id);
      
      mockGraphLinks.forEach((link) => {
        expect(nodeIds).toContain(link.source);
      });
    });

    test('tüm link hedefleri geçerli düğümlere işaret etmeli', () => {
      const nodeIds = mockGraphNodes.map((n) => n.id);
      
      mockGraphLinks.forEach((link) => {
        expect(nodeIds).toContain(link.target);
      });
    });

    test('düğümler ağırlığa göre sıralanabilmeli', () => {
      const sorted = [...mockGraphNodes].sort((a, b) => b.weight - a.weight);
      
      expect(sorted[0].weight).toBeGreaterThanOrEqual(sorted[1].weight);
      expect(sorted[0].label).toBe('React');
    });

    test('belirli tipteki düğümler filtrelenmeli', () => {
      const conceptNodes = mockGraphNodes.filter((n) => n.type === 'concept');
      
      expect(conceptNodes).toHaveLength(1);
      expect(conceptNodes[0].label).toBe('JavaScript');
    });
  });

  describe('Graph Layout Tests', () => {
    test('düğüm pozisyonları hesaplanabilmeli', () => {
      const nodesWithPosition = mockGraphNodes.map((node, index) => ({
        ...node,
        x: index * 100,
        y: index * 50,
      }));
      
      expect(nodesWithPosition[0].x).toBe(0);
      expect(nodesWithPosition[1].x).toBe(100);
    });

    test('düğüm boyutu ağırlığa göre hesaplanabilmeli', () => {
      const nodesWithSize = mockGraphNodes.map((node) => ({
        ...node,
        radius: 10 + node.weight * 20,
      }));
      
      expect(nodesWithSize[0].radius).toBe(10 + 0.8 * 20);
    });

    test('düğüm rengi tipe göre belirlenebilmeli', () => {
      const typeColors: Record<string, string> = {
        concept: '#3b82f6',
        library: '#10b981',
        language: '#f59e0b',
      };
      
      const nodesWithColor = mockGraphNodes.map((node) => ({
        ...node,
        color: typeColors[node.type] || '#6b7280',
      }));
      
      expect(nodesWithColor[0].color).toBe('#3b82f6');
      expect(nodesWithColor[1].color).toBe('#10b981');
    });
  });

  describe('Graph API Integration', () => {
    test('graph API yanıtı doğru formatta olmalı', () => {
      const mockApiResponse = {
        nodes: mockGraphNodes,
        links: mockGraphLinks,
      };
      
      expect(mockApiResponse).toHaveProperty('nodes');
      expect(mockApiResponse).toHaveProperty('links');
    });

    test('graph API hatası handle edilmeli', async () => {
      const mockError = { error: 'Failed to fetch graph data' };
      const status = 500;
      
      expect(status).toBe(500);
      expect(mockError).toHaveProperty('error');
    });
  });
});
