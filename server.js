require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// ================================================================
//  Playwright chargé UNE SEULE FOIS au démarrage du serveur
//  Toutes les requêtes partagent le même import → 0 overhead
// ================================================================
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 4000;
const API_KEY = process.env.BOT_API_KEY || 'nelsius_secret_bot_key_2026';
const HEADLESS = process.env.HEADLESS !== 'false';

app.use(cors());
app.use(express.json());

// Serve Dashboard static UI
app.use(express.static(path.join(__dirname, 'public')));

// Serve screenshots static directory
const screenshotsDir = path.join(__dirname, '..', 'backend', 'storage', 'app', 'public', 'bot_screenshots');
if (fs.existsSync(screenshotsDir)) {
  app.use('/screenshots', express.static(screenshotsDir));
}

// API Key Authentication Middleware
app.use((req, res, next) => {
  if (req.path === '/' || req.path === '/health' || req.path.startsWith('/screenshots') || req.headers['accept']?.includes('text/html')) {
    return next();
  }
  const requestKey = req.headers['x-api-key'] || req.query.api_key || req.headers['authorization']?.replace('Bearer ', '');
  if (!requestKey || requestKey !== API_KEY) {
    return res.status(401).json({
      success: false,
      status: 'UNAUTHORIZED',
      message: 'Accès non autorisé: Clé X-API-KEY invalide ou manquante.'
    });
  }
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Nelsius PaymentBot Microservice',
    timestamp: new Date().toISOString()
  });
});

// ================================================================
//  Fonction principale du bot (exécutée IN-PROCESS, pas via spawn)
// ================================================================
async function runCardBot({ checkout_url, card_number, card_exp_month, card_exp_year, card_cvc, holder_name = 'Client Nelsius', email = '', onProgress = () => {} }) {
  let browser = null;
  let context = null;
  const capturedScreenshots = [];

  const expYearShort = card_exp_year.toString().slice(-2);
  const formattedExp = `${card_exp_month.toString().padStart(2, '0')}/${expYearShort}`;

  const takeScreenshot = async (page, stepName) => {
    if (!fs.existsSync(screenshotsDir)) return;
    try {
      const filepath = path.join(screenshotsDir, `${stepName}_${Date.now()}.png`);
      await page.screenshot({ path: filepath, fullPage: false });
      capturedScreenshots.push({ step: stepName, file: filepath });
    } catch (err) {}
  };

  // Auto-détection du chemin Chromium système (Linux / VPS)
  const findSystemChromium = () => {
    const candidates = [
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
      process.env.PUPPETEER_EXECUTABLE_PATH,
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium',
      '/usr/local/bin/chromium'
    ].filter(Boolean);
    const fsSync = require('fs');
    for (const p of candidates) {
      try { if (fsSync.existsSync(p)) return p; } catch (e) {}
    }
    return null;
  };

  try {
    onProgress('Lancement du navigateur Playwright Chromium...');
    const chromiumPath = findSystemChromium();
    const launchArgs = {
      headless: HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    };
    if (chromiumPath) {
      launchArgs.executablePath = chromiumPath;
      onProgress(`Utilisation du Chromium système : ${chromiumPath}`);
    }
    browser = await chromium.launch(launchArgs);

    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      locale: 'fr-FR',
      timezoneId: 'Africa/Douala'
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    const page = await context.newPage();

    // Step 1: Navigate
    onProgress(`Navigation vers : ${checkout_url}`);
    try {
      await page.goto(checkout_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err) {
      if (page.url() && page.url() !== 'about:blank') {
        onProgress(`Avertissement: timeout de navigation mais page partiellement chargée (${page.url()}), on continue...`);
      } else {
        throw err;
      }
    }
    await takeScreenshot(page, 'step1_landing_page');

    // Step 2: Click "Continuer" if present
    onProgress('Vérification du bouton Continuer...');
    await page.waitForTimeout(300);

    const continuerClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      for (const btn of btns) {
        if ((btn.textContent || '').toLowerCase().includes('continuer')) { btn.click(); return true; }
      }
      const target = Array.from(document.querySelectorAll('div, span')).find(el => {
        const text = (el.textContent || '').trim().toLowerCase();
        return text === 'continuer →' || text === 'continuer' || text.startsWith('continuer');
      });
      if (target) { target.click(); return true; }
      return false;
    }).catch(() => false);

    if (continuerClicked) {
      onProgress('Bouton Continuer cliqué, attente navigation Stripe...');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 6000 }).catch(() => {});
    }
    await takeScreenshot(page, 'step2_card_option_selected');

    // Step 3: Fill customer details
    onProgress('Saisie des données client...');
    try {
      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      if (await emailInput.isVisible().catch(() => false) && email) await emailInput.fill(email);
      const nameInput = page.locator('input[name="name"], input[name="holder"], input[name="cardholder"]').first();
      if (await nameInput.isVisible().catch(() => false) && holder_name) await nameInput.fill(holder_name);
    } catch (e) {}

    // Step 4: Inject Card Details
    onProgress('Injection des données de carte bancaire...');
    let cardInjected = false;

    for (const frame of page.frames()) {
      try {
        const numInput = frame.locator('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"], input[id*="cardNumber"], input[name="cardnumber"], input[name="number"]').first();
        if (await numInput.isVisible().catch(() => false)) {
          await numInput.click();
          await numInput.pressSequentially(card_number, { delay: 20 });
          cardInjected = true;
          const expInput = frame.locator('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"], input[id*="cardExpiry"], input[name="exp-date"], input[name="expiry"]').first();
          if (await expInput.isVisible().catch(() => false)) { await expInput.click(); await expInput.pressSequentially(formattedExp, { delay: 20 }); }
          const cvcInput = frame.locator('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"], input[id*="cardCvc"], input[name="cvc"], input[name="cvv"]').first();
          if (await cvcInput.isVisible().catch(() => false)) { await cvcInput.click(); await cvcInput.pressSequentially(card_cvc, { delay: 20 }); }
          const nameInput = frame.locator('#billingName, input[name="billingName"], input[id*="billingName"]').first();
          if (await nameInput.isVisible().catch(() => false)) await nameInput.fill(holder_name);
          break;
        }
      } catch (err) {}
    }

    if (!cardInjected) {
      try {
        const mainNum = page.locator('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"], input[name="cardnumber"], input[id*="card-number"], input[placeholder*="4242"]').first();
        if (await mainNum.isVisible().catch(() => false)) {
          await mainNum.click();
          await mainNum.pressSequentially(card_number, { delay: 20 });
          cardInjected = true;
          const mainExp = page.locator('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"], input[name="exp-date"], input[id*="exp"], input[placeholder*="MM"]').first();
          if (await mainExp.isVisible().catch(() => false)) { await mainExp.click(); await mainExp.pressSequentially(formattedExp, { delay: 20 }); }
          const mainCvc = page.locator('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"], input[name="cvc"], input[id*="cvc"], input[placeholder*="CVC"]').first();
          if (await mainCvc.isVisible().catch(() => false)) { await mainCvc.click(); await mainCvc.pressSequentially(card_cvc, { delay: 20 }); }
          const mainName = page.locator('#billingName, input[name="billingName"]').first();
          if (await mainName.isVisible().catch(() => false)) await mainName.fill(holder_name);
        }
      } catch (err) {}
    }

    await takeScreenshot(page, 'step3_form_filled');

    // Step 5: Submit
    onProgress('Soumission du formulaire de paiement...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
      for (const btn of buttons) {
        const txt = (btn.textContent || btn.value || '').toLowerCase();
        if (txt.includes('payer') || txt.includes('pay') || txt.includes('valider') || txt.includes('submit') || btn.type === 'submit') { btn.click(); return true; }
      }
      return false;
    });

    onProgress('Attente de la réponse de la banque...');

    // Step 6: Poll for response (max 30s)
    let currentUrl = page.url();
    let pageText = '';
    let detectedError = null;

    for (let poll = 0; poll < 30; poll++) {
      await page.waitForTimeout(1000);
      try { currentUrl = page.url(); } catch (e) {}
      pageText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      detectedError = await page.evaluate(() => {
        const el = document.querySelector('.card-errors, [role="alert"], .Error, .error-message, .alert-danger, .InputElement-error, .FormError, .p-FieldError, .ErrorMessage');
        return el && el.textContent && el.textContent.trim() ? el.textContent.trim() : null;
      }).catch(() => null);
      if (detectedError) break;
      const lowerText = pageText.toLowerCase();
      if (currentUrl.includes('3d') || currentUrl.includes('acs') || currentUrl.includes('bank') || lowerText.includes('3d secure') || lowerText.includes('code de confirmation')) break;
      if (currentUrl.includes('success') || currentUrl.includes('confirm') || lowerText.includes('succès') || lowerText.includes('réussi') || lowerText.includes('thank you')) break;
      if (lowerText.includes('décliné') || lowerText.includes('refusé') || lowerText.includes('failed') || lowerText.includes('insufficient') || lowerText.includes('invalid') || lowerText.includes('invalide') || lowerText.includes('declined') || lowerText.includes('incorrect') || lowerText.includes('échec')) break;
    }

    await takeScreenshot(page, 'step4_after_submit');

    if (currentUrl.includes('3d') || currentUrl.includes('acs') || currentUrl.includes('bank') || pageText.toLowerCase().includes('3d secure') || pageText.toLowerCase().includes('code de confirmation')) {
      return { success: true, status: '3DS_REQUIRED', redirect_url: currentUrl, message: 'Authentification 3D Secure requise par la banque.', screenshots: capturedScreenshots, data: { url: currentUrl } };
    }
    if (currentUrl.includes('success') || currentUrl.includes('confirm') || pageText.toLowerCase().includes('succès') || pageText.toLowerCase().includes('réussi') || pageText.toLowerCase().includes('thank you')) {
      return { success: true, status: 'SUCCESS', message: 'Paiement effectué et validé avec succès !', screenshots: capturedScreenshots, data: { url: currentUrl } };
    }
    const lowerText = pageText.toLowerCase();
    const hasDeclineKeywords = lowerText.includes('décliné') || lowerText.includes('refusé') || lowerText.includes('failed') || lowerText.includes('insufficient') || lowerText.includes('invalid') || lowerText.includes('invalide') || lowerText.includes('declined') || lowerText.includes('incorrect') || lowerText.includes('échec');
    if (detectedError || hasDeclineKeywords) {
      return { success: false, status: 'DECLINED', message: detectedError || 'Le paiement a été refusé ou les informations de carte sont invalides.', screenshots: capturedScreenshots, data: { url: currentUrl } };
    }

    return { success: false, status: 'DECLINED', message: 'Le paiement n\'a pas pu être validé. Veuillez vérifier vos informations de carte.', screenshots: capturedScreenshots, data: { url: currentUrl } };

  } finally {
    if (context) try { await context.close(); } catch (e) {}
    if (browser) try { await browser.close(); } catch (e) {}
  }
}

// ================================================================
//  Standard Process Card Endpoint
// ================================================================
app.post('/api/v1/process-card', async (req, res) => {
  const payload = req.body || {};
  const { checkout_url, card_number, card_exp_month, card_exp_year, card_cvc, holder_name, email } = payload;

  if (!checkout_url || !card_number || !card_exp_month || !card_exp_year || !card_cvc) {
    return res.status(400).json({
      success: false,
      status: 'MISSING_FIELDS',
      message: 'Champs de carte requis manquants (checkout_url, card_number, card_exp_month, card_exp_year, card_cvc).'
    });
  }

  try {
    const result = await runCardBot({ checkout_url, card_number, card_exp_month, card_exp_year, card_cvc, holder_name, email });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      status: 'ERROR',
      message: 'Erreur lors de l\'exécution du bot: ' + error.message
    });
  }
});

// ================================================================
//  SSE Streaming Process Card Endpoint
// ================================================================
app.post('/api/v1/process-card-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, timestamp: new Date().toISOString(), ...data })}\n\n`);
  };

  const payload = req.body || {};
  const { checkout_url, card_number, card_exp_month, card_exp_year, card_cvc, holder_name, email } = payload;

  if (!checkout_url || !card_number || !card_exp_month || !card_exp_year || !card_cvc) {
    sendEvent('error', { message: 'Champs de carte requis manquants.' });
    return res.end();
  }

  sendEvent('log', { message: 'Démarrage du processus de paiement par carte...' });

  try {
    const result = await runCardBot({
      checkout_url, card_number, card_exp_month, card_exp_year, card_cvc, holder_name, email,
      onProgress: (message) => sendEvent('log', { message })
    });
    sendEvent('result', { result });
  } catch (error) {
    sendEvent('error', { message: 'Erreur lors de l\'exécution du bot: ' + error.message });
  }

  res.end();
});

app.listen(PORT, () => {
  console.log(`[Nelsius PaymentBot Service] Running on http://localhost:${PORT}`);
});
