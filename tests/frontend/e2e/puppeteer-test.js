import puppeteer from 'puppeteer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function runTests() {
  const results = {
    errors: [],
    warnings: [],
    observations: [],
    consoleErrors: [],
    networkErrors: [],
    pageStructure: {},
    componentTests: {},
    websocketTests: {},
    messageFlowTests: {}
  };

  let browser;
  try {
    console.log('🚀 Puppeteer test başlatılıyor...');
    
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const page = await browser.newPage();
    
    // Console mesajlarını yakala
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        results.consoleErrors.push({
          type: 'error',
          text: msg.text(),
          location: msg.location()
        });
      } else if (msg.type() === 'warning') {
        results.warnings.push({
          type: 'console',
          text: msg.text()
        });
      }
    });

    // Page error'larını yakala
    page.on('pageerror', (error) => {
      results.errors.push({
        type: 'pageerror',
        message: error.message,
        stack: error.stack
      });
    });

    // Network isteklerini izle
    page.on('response', (response) => {
      if (response.status() >= 400) {
        results.networkErrors.push({
          url: response.url(),
          status: response.status(),
          statusText: response.statusText()
        });
      }
    });

    // 1. Sayfa yüklenmesi testi
    console.log('📄 Sayfa yüklenmesi testi...');
    try {
      await page.goto('http://localhost:5173/', {
        waitUntil: 'networkidle0',
        timeout: 30000
      });
      results.pageStructure.loaded = true;
      results.pageStructure.url = page.url();
      results.pageStructure.title = await page.title();
    } catch (err) {
      results.errors.push({
        type: 'navigation',
        message: `Sayfa yüklenemedi: ${err.message}`
      });
      results.pageStructure.loaded = false;
    }

    // 2. Sayfa içeriği analizi
    console.log('🔍 Sayfa içeriği analizi...');
    if (results.pageStructure.loaded) {
      const bodyContent = await page.evaluate(() => {
        return {
          html: document.body.innerHTML.substring(0, 5000),
          hasRoot: !!document.getElementById('root'),
          hasApp: !!document.querySelector('[class*="app"]') || !!document.querySelector('[class*="App"]'),
          classes: Array.from(document.querySelectorAll('[class]')).map(el => el.className).slice(0, 50)
        };
      });
      results.pageStructure.bodyPreview = bodyContent.html;
      results.pageStructure.hasRoot = bodyContent.hasRoot;
      results.pageStructure.classes = bodyContent.classes;

      // 3. Temel UI elementlerini kontrol et
      console.log('🎨 UI element kontrolü...');
      const uiElements = await page.evaluate(() => {
        const elements = {
          // Input alanları
          textInputs: document.querySelectorAll('input[type="text"], input:not([type]), textarea').length,
          
          // Butonlar
          buttons: document.querySelectorAll('button').length,
          sendButton: !!document.querySelector('button[class*="send"]') || 
                     !!document.querySelector('button[class*="Send"]') ||
                     !!document.querySelector('[aria-label*="send"]') ||
                     !!document.querySelector('[aria-label*="Send"]'),
          
          // Mesaj alanları
          messageContainers: document.querySelectorAll('[class*="message"], [class*="Message"], [class*="chat"], [class*="Chat"]').length,
          
          // Sidebar/Navigation
          sidebar: !!document.querySelector('[class*="sidebar"], [class*="Sidebar"], [class*="sidebar"]'),
          navigation: !!document.querySelector('nav, [class*="nav"], [class*="Nav"]'),
          
          // Loading states
          loadingIndicators: document.querySelectorAll('[class*="loading"], [class*="Loading"], [class*="spinner"]').length,
          
          // Form elements
          forms: document.querySelectorAll('form').length,
          
          // Links
          links: document.querySelectorAll('a').length,
          
          // Images/Icons
          images: document.querySelectorAll('img, svg').length
        };
        return elements;
      });
      results.componentTests.uiElements = uiElements;

      // 4. Spesifik component kontrolü
      console.log('🧩 Component kontrolü...');
      const components = await page.evaluate(() => {
        const check = (selector) => {
          const el = document.querySelector(selector);
          return {
            exists: !!el,
            visible: el ? el.offsetParent !== null : false,
            text: el ? el.textContent?.substring(0, 100) : null
          };
        };

        return {
          // Ana container
          root: check('#root'),
          
          // Olası mesaj input
          messageInput: check('textarea') || check('input[placeholder*="message"]') || check('input[placeholder*="mesaj"]') || check('input[type="text"]'),
          
          // Olası gönder butonu
          sendBtn: check('button[type="submit"]') || check('button[class*="send"]'),
          
          // Header/Title
          header: check('h1, h2, [class*="header"]'),
          
          // Sidebar varsa
          sidebar: check('[class*="sidebar"]') || check('[class*="Sidebar"]'),
          
          // Conversation list
          conversationList: check('[class*="conversation"]') || check('[class*="Conversation"]'),
          
          // Settings
          settings: check('[class*="settings"]') || check('[class*="Settings"]') || check('[class*="config"]')
        };
      });
      results.componentTests.specificComponents = components;

      // 5. Ekran görüntüsü al
      console.log('📸 Ekran görüntüsü alınıyor...');
      await page.screenshot({ 
        path: join(__dirname, '../../../test-screenshot-full.png'),
        fullPage: true 
      });

      // 6. WebSocket bağlantısını kontrol et
      console.log('🔌 WebSocket bağlantısı kontrolü...');
      
      // Sayfada WebSocket kullanımını kontrol et
      const wsStatus = await page.evaluate(() => {
        // Mevcut bağlantıları kontrol et (eğer varsa)
        const hasWebSocket = typeof WebSocket !== 'undefined';
        
        // Uygulamanın WebSocket kullanıp kullanmadığını kontrol et
        const appUsesWS = !!window.__WEBSOCKET_CONNECTED__ || 
                          !!document.querySelector('[data-websocket]') ||
                          localStorage.getItem('websocket_connected') === 'true';
        
        return {
          webSocketAvailable: hasWebSocket,
          appUsesWebSocket: appUsesWS,
          // Aktif WebSocket bağlantıları (eğer erişilebilirse)
          activeConnections: 'check_console_for_ws_messages'
        };
      });
      results.websocketTests = wsStatus;

      // 7. Network isteklerini analiz et
      console.log('🌐 Network istekleri analiz ediliyor...');
      const networkRequests = await page.evaluate(() => {
        // Performance API'den istekleri al
        const entries = performance.getEntriesByType('resource');
        return {
          totalRequests: entries.length,
          byType: {
            fetch: entries.filter(e => e.initiatorType === 'fetch').length,
            xmlhttprequest: entries.filter(e => e.initiatorType === 'xmlhttprequest').length,
            script: entries.filter(e => e.initiatorType === 'script').length,
            stylesheet: entries.filter(e => e.initiatorType === 'link').length,
            image: entries.filter(e => e.initiatorType === 'img').length,
            other: entries.filter(e => !['fetch', 'xmlhttprequest', 'script', 'link', 'img'].includes(e.initiatorType)).length
          },
          failedRequests: entries.filter(e => e.responseStatus && e.responseStatus >= 400).map(e => ({
            url: e.name,
            status: e.responseStatus
          }))
        };
      });
      results.networkRequests = networkRequests;

      // 8. JavaScript hatalarını kontrol et
      console.log('⚠️ JavaScript hataları kontrolü...');
      const jsErrors = await page.evaluate(() => {
        return {
          consoleErrors: 'captured_via_page_listener',
          unhandledRejections: 'captured_via_page_listener'
        };
      });
      results.jsErrors = jsErrors;

      // 9. Responsive tasarım kontrolü
      console.log('📱 Responsive tasarım kontrolü...');
      
      // Mobil görünüm
      await page.setViewport({ width: 375, height: 812 });
      await new Promise(resolve => setTimeout(resolve, 1000));
      const mobileLayout = await page.evaluate(() => {
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          sidebarVisible: !!document.querySelector('[class*="sidebar"]:not([style*="display: none"])'),
          mainContentVisible: !!document.querySelector('#root:not([style*="display: none"])')
        };
      });
      results.responsiveTests = { mobile: mobileLayout };
      
      await page.screenshot({ 
        path: join(__dirname, '../../../test-screenshot-mobile.png'),
        fullPage: true 
      });

      // Tablet görünüm
      await page.setViewport({ width: 768, height: 1024 });
      await new Promise(resolve => setTimeout(resolve, 1000));
      const tabletLayout = await page.evaluate(() => {
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          sidebarVisible: !!document.querySelector('[class*="sidebar"]:not([style*="display: none"])'),
          mainContentVisible: !!document.querySelector('#root:not([style*="display: none"])')
        };
      });
      results.responsiveTests.tablet = tabletLayout;

      // Desktop görünümüne geri dön
      await page.setViewport({ width: 1280, height: 800 });
      await new Promise(resolve => setTimeout(resolve, 500));

      // 10. Sayfa yapısı detaylı analiz
      console.log('📊 Detaylı sayfa yapısı analizi...');
      const pageStructure = await page.evaluate(() => {
        const getAllElements = () => {
          const all = document.querySelectorAll('*');
          const tagCounts = {};
          all.forEach(el => {
            tagCounts[el.tagName.toLowerCase()] = (tagCounts[el.tagName.toLowerCase()] || 0) + 1;
          });
          return tagCounts;
        };

        return {
          totalElements: document.querySelectorAll('*').length,
          tagDistribution: getAllElements(),
          hasReactRoot: !!document.getElementById('root')?._reactRootContainer || 
                        !!document.querySelector('[data-reactroot]') ||
                        !!document.querySelector('[class*="react"]'),
          documentReadyState: document.readyState
        };
      });
      results.pageStructure.detailed = pageStructure;
    }

    // Sonuçları yazdır
    console.log('\n' + '='.repeat(60));
    console.log('📋 TEST SONUÇLARI');
    console.log('='.repeat(60));
    console.log('\n📄 Sayfa Yapısı:');
    console.log(JSON.stringify(results.pageStructure, null, 2).substring(0, 2000));
    
    console.log('\n🧩 Component Testleri:');
    console.log(JSON.stringify(results.componentTests, null, 2));
    
    console.log('\n🔌 WebSocket Durumu:');
    console.log(JSON.stringify(results.websocketTests, null, 2));
    
    console.log('\n🌐 Network İstekleri:');
    console.log(JSON.stringify(results.networkRequests, null, 2));
    
    console.log('\n⚠️ Console Hataları:');
    console.log(JSON.stringify(results.consoleErrors, null, 2));
    
    console.log('\n❌ Sayfa Hataları:');
    console.log(JSON.stringify(results.errors, null, 2));
    
    console.log('\n⚠️ Uyarılar:');
    console.log(JSON.stringify(results.warnings, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('✅ Test tamamlandı!');
    console.log('='.repeat(60));

    // Sonuçları dosyaya kaydet
    const fs = await import('fs');
    const outputPath = join(__dirname, '../../../puppeteer-test-results.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\n📁 Detaylı sonuçlar kaydedildi: ${outputPath}`);

  } catch (error) {
    console.error('❌ Test sırasında hata:', error.message);
    results.errors.push({
      type: 'test_execution',
      message: error.message,
      stack: error.stack
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return results;
}

// Testi çalıştır
runTests().then(results => {
  console.log('\n🏁 Test süreci tamamlandı.');
  process.exit(results.errors.length > 0 ? 1 : 0);
}).catch(err => {
  console.error('Fatal hata:', err);
  process.exit(1);
});
