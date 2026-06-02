const puppeteer = require('puppeteer');

(async () => {
  let browser;
  try {
    console.log("Launching browser...");
    browser = await puppeteer.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    
    // コンソールメッセージとエラーをキャッチ
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR EXCEPTION:', err.message));
    page.on('requestfailed', request => console.log('REQUEST FAILED:', request.url(), request.failure() ? request.failure().errorText : ''));

    console.log("Navigating to Vercel URL...");
    // キャッシュを避けるためにタイムスタンプのクエリパラメータを付与
    await page.goto('https://test-sepia-three-75.vercel.app/?t=' + Date.now(), { waitUntil: 'networkidle2' });
    
    console.log("Page loaded. Waiting 3 seconds for async initialization...");
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log("Checking for debug panel content...");
    const debugPanelContent = await page.evaluate(() => {
      const panel = document.getElementById('debug-error-panel');
      const content = document.getElementById('debug-error-content');
      if (panel && panel.style.display !== 'none') {
        return content ? content.textContent : 'Panel display block but no content';
      }
      return 'Panel hidden (no uncaught errors detected by window.onerror)';
    });
    console.log("Debug Panel Content Result:\n", debugPanelContent);

    console.log("Checking storage state...");
    const storageState = await page.evaluate(() => {
      return {
        supabase_url: localStorage.getItem('supabase_url'),
        supabase_key: localStorage.getItem('supabase_key') ? 'present (omitted for security)' : 'null'
      };
    });
    console.log("LocalStorage values:", storageState);

  } catch (e) {
    console.error("Puppeteer Script Error:", e);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
})();
