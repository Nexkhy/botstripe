/**
 * GeniusPay & Stripe Card Payment Automation Bot with Step-by-Step Screenshots
 * Isolated Microservice Bot Script for Nelsius PaymentBot (Playwright Engine)
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const os = require('os');

const systemTmp = process.env.TEMP || process.env.TMP || process.env.TMPDIR || os.tmpdir() || path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(systemTmp)) {
  try { fs.mkdirSync(systemTmp, { recursive: true }); } catch (e) {}
}
process.env.TEMP = systemTmp;
process.env.TMP = systemTmp;
process.env.TMPDIR = systemTmp;

async function runBot() {
  let browser = null;
  let context = null;
  const inputArg = process.argv[2] || '{}';
  let input = {};

  const globalTimer = setTimeout(() => {
    console.log(JSON.stringify({
      success: false,
      status: 'TIMEOUT',
      message: 'Le bot de paiement a dépassé le délai maximum de 110 secondes.'
    }));
    if (browser) {
      try { browser.close().catch(() => {}); } catch (e) {}
    }
    process.exit(1);
  }, 110000);

  const safeExit = async (code = 0) => {
    clearTimeout(globalTimer);
    if (context) {
      try { await context.close(); } catch (e) {}
    }
    if (browser) {
      try { await browser.close(); } catch (e) {}
    }
    process.exit(code);
  };

  try {
    if (fs.existsSync(inputArg)) {
      const fileContent = fs.readFileSync(inputArg, 'utf8');
      input = JSON.parse(fileContent);
    } else {
      input = JSON.parse(inputArg);
    }
  } catch (e) {
    console.log(JSON.stringify({
      success: false,
      status: 'INVALID_INPUT',
      message: 'Payload JSON invalide passé au bot: ' + e.message
    }));
    await safeExit(1);
  }

  const {
    checkout_url,
    card_number,
    card_exp_month,
    card_exp_year,
    card_cvc,
    holder_name = 'Client Nelsius',
    email = '',
    phone = '',
    headless = true,
    screenshots_dir = null
  } = input;

  if (!checkout_url || !card_number || !card_exp_month || !card_exp_year || !card_cvc) {
    console.log(JSON.stringify({
      success: false,
      status: 'MISSING_FIELDS',
      message: 'Certains champs requis de la carte (numéro, expiration, CVC, checkout_url) sont manquants.'
    }));
    await safeExit(1);
  }

  const capturedScreenshots = [];
  const takeScreenshot = async (page, stepName) => {
    if (!screenshots_dir) return;
    try {
      if (!fs.existsSync(screenshots_dir)) {
        fs.mkdirSync(screenshots_dir, { recursive: true });
      }
      const filepath = path.join(screenshots_dir, `${stepName}_${Date.now()}.png`);
      await page.screenshot({ path: filepath, fullPage: false });
      capturedScreenshots.push({ step: stepName, file: filepath });
    } catch (err) {}
  };

  const expYearShort = card_exp_year.toString().slice(-2);
  const formattedExp = `${card_exp_month.toString().padStart(2, '0')}/${expYearShort}`;

  try {
    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled'
    ];

    console.error('[BOT_STEP] Launching Playwright Chromium...');
    const launchOpts = {
      headless: headless ? true : false,
      timeout: 30000,
      args: chromeArgs
    };
    if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
      launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    }

    browser = await chromium.launch(launchOpts);
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      ignoreHTTPSErrors: true,
      locale: 'fr-FR',
      timezoneId: 'Africa/Douala'
    });

    // Stealth evasion script injection
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    });

    const page = await context.newPage();

    // Step 1: Navigate to Checkout URL
    console.error(`[BOT_STEP] Navigating to checkout URL: ${checkout_url}`);
    try {
      await page.goto(checkout_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (err) {
      if (page.url() && page.url() !== 'about:blank') {
        console.error(`[BOT_STEP] Warning: Navigation timeout reached but page partially loaded (${page.url()}), continuing...`);
      } else {
        try {
          await page.goto(checkout_url, { waitUntil: 'commit', timeout: 15000 });
        } catch (retryErr) {
          throw err;
        }
      }
    }

    await takeScreenshot(page, 'step1_landing_page');

    // Step 2: Sélection méthode "Carte" si la page GeniusPay affiche le sélecteur
    console.error('[BOT_STEP] Selecting Stripe card payment method...');
    await page.waitForTimeout(300);

    const methodSelected = await page.evaluate(() => {
      const form = document.querySelector('form[action*="/pay"]') || document.querySelector('form');
      let alpine = null;
      if (window.Alpine && form) alpine = window.Alpine.$data(form);
      if (!alpine && form && form._x_dataStack) alpine = form._x_dataStack[0];
      if (!alpine) {
        let el = form ? form.parentElement : document.querySelector('[x-data]');
        while (el && !alpine) {
          if (window.Alpine) alpine = window.Alpine.$data(el);
          if (!alpine && el._x_dataStack) alpine = el._x_dataStack[0];
          el = el.parentElement;
        }
      }

      let selectedInfo = '';
      if (alpine) {
        const methods = alpine.paymentMethods || [];
        const stripeMethod = methods.find(m => m.id === 'stripe' || m.gateway === 'stripe' || (m.name && m.name.toLowerCase().includes('stripe')) || m.type === 'card');
        if (stripeMethod) {
          if (typeof alpine.selectMethod === 'function') {
            alpine.selectMethod(stripeMethod);
          } else {
            alpine.selectedMethod = stripeMethod.id;
          }
          selectedInfo = 'alpine: ' + stripeMethod.id;
        }
      }

      const hiddenPM = document.querySelector('input[name="payment_method"]');
      if (hiddenPM) {
        hiddenPM.value = 'stripe';
        hiddenPM.dispatchEvent(new Event('change', { bubbles: true }));
        hiddenPM.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const buttons = Array.from(document.querySelectorAll('button, div[class*="cursor"], label'));
      for (const btn of buttons) {
        const t = (btn.textContent || '').trim();
        if ((t.includes('Carte Internationale') || t.includes('Stripe')) && !t.toLowerCase().includes('pays') && t.length < 80) {
          try { btn.click(); } catch(e){}
          selectedInfo = selectedInfo || ('dom-clicked: ' + t);
          break;
        }
      }

      return selectedInfo || 'stripe-set';
    }).catch(() => false);

    console.error(`[BOT_STEP] Method selected: ${methodSelected || 'none'}`);
    await page.waitForTimeout(500);

    // Submit method selection
    await page.evaluate(() => {
      const form = document.querySelector('form[action*="/pay"]') || document.querySelector('form');
      let alpine = null;
      if (window.Alpine && form) alpine = window.Alpine.$data(form);
      if (!alpine && form && form._x_dataStack) alpine = form._x_dataStack[0];
      if (!alpine) {
        let el = form ? form.parentElement : document.querySelector('[x-data]');
        while (el && !alpine) {
          if (window.Alpine) alpine = window.Alpine.$data(el);
          if (!alpine && el._x_dataStack) alpine = el._x_dataStack[0];
          el = el.parentElement;
        }
      }
      if (alpine) {
        alpine.selectedMethod = 'stripe';
        if (typeof alpine.handleSubmit === 'function') {
          try { alpine.handleSubmit(); return; } catch (e) {}
        }
      }
      const btns = Array.from(document.querySelectorAll('button, input[type="submit"]'));
      for (const btn of btns) {
        const t = (btn.textContent || btn.value || '').toLowerCase();
        if (t.includes('continuer') || t.includes('payer') || (btn.type === 'submit' && !btn.disabled)) {
          btn.removeAttribute('disabled');
          btn.click();
          return;
        }
      }
      if (form) form.submit();
    }).catch(() => {});

    const urlBefore = page.url();
    await Promise.race([
      page.waitForURL(url => url.href !== urlBefore, { timeout: 12000 }),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 12000 })
    ]).catch(() => {});
    await page.waitForTimeout(1500);

    await takeScreenshot(page, 'step2_card_option_selected');

    // Step 3: Fill customer details if present
    console.error('[BOT_STEP] Filling customer profile data...');
    try {
      const emailInput = page.locator('input[type="email"], input[name="email"]').first();
      if (await emailInput.isVisible({ timeout: 500 }).catch(() => false) && email) {
        await emailInput.fill(email);
      }
      const nameInput = page.locator('input[name="name"], input[name="holder"], input[name="cardholder"]').first();
      if (await nameInput.isVisible({ timeout: 500 }).catch(() => false) && holder_name) {
        await nameInput.fill(holder_name);
      }
    } catch (e) {}

    // Step 4: Inject Card Details
    console.error('[BOT_STEP] Injecting card number, expiration & CVC...');
    let cardInjected = false;

    for (let attempt = 0; attempt < 10; attempt++) {
      const frames = page.frames();
      for (const frame of frames) {
        try {
          const numInput = frame.locator('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"], input[id*="cardNumber"], input[name="cardnumber"], input[name="number"]').first();
          if (await numInput.isVisible({ timeout: 500 }).catch(() => false)) {
            await numInput.click();
            await numInput.pressSequentially(card_number, { delay: 20 });
            cardInjected = true;

            const expInput = frame.locator('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"], input[id*="cardExpiry"], input[name="exp-date"], input[name="expiry"]').first();
            if (await expInput.isVisible({ timeout: 500 }).catch(() => false)) {
              await expInput.click();
              await expInput.pressSequentially(formattedExp, { delay: 20 });
            }

            const cvcInput = frame.locator('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"], input[id*="cardCvc"], input[name="cvc"], input[name="cvv"]').first();
            if (await cvcInput.isVisible({ timeout: 500 }).catch(() => false)) {
              await cvcInput.click();
              await cvcInput.pressSequentially(card_cvc, { delay: 20 });
            }

            const nameInput = frame.locator('#billingName, input[name="billingName"], input[id*="billingName"]').first();
            if (await nameInput.isVisible({ timeout: 500 }).catch(() => false)) {
              await nameInput.fill(holder_name);
            }
            break;
          }
        } catch (err) {}
      }

      if (!cardInjected) {
        try {
          const mainNum = page.locator('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"], input[name="cardnumber"], input[id*="card-number"], input[placeholder*="4242"]').first();
          if (await mainNum.isVisible({ timeout: 500 }).catch(() => false)) {
            await mainNum.click();
            await mainNum.pressSequentially(card_number, { delay: 20 });
            cardInjected = true;
            const mainExp = page.locator('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"], input[name="exp-date"], input[id*="exp"], input[placeholder*="MM"]').first();
            if (await mainExp.isVisible({ timeout: 500 }).catch(() => false)) { await mainExp.click(); await mainExp.pressSequentially(formattedExp, { delay: 20 }); }
            const mainCvc = page.locator('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"], input[name="cvc"], input[id*="cvc"], input[placeholder*="CVC"]').first();
            if (await mainCvc.isVisible({ timeout: 500 }).catch(() => false)) { await mainCvc.click(); await mainCvc.pressSequentially(card_cvc, { delay: 20 }); }
            const mainName = page.locator('#billingName, input[name="billingName"]').first();
            if (await mainName.isVisible({ timeout: 500 }).catch(() => false)) await mainName.fill(holder_name);
          }
        } catch (err) {}
      }

      if (cardInjected) break;
      await page.waitForTimeout(1000);
    }

    if (!cardInjected) {
      try {
        const mainNum = page.locator('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"], input[name="cardnumber"], input[id*="card-number"], input[placeholder*="4242"]').first();
        if (await mainNum.isVisible().catch(() => false)) {
          await mainNum.click();
          await mainNum.pressSequentially(card_number, { delay: 20 });
          cardInjected = true;

          const mainExp = page.locator('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"], input[name="exp-date"], input[id*="exp"], input[placeholder*="MM"]').first();
          if (await mainExp.isVisible().catch(() => false)) {
            await mainExp.click();
            await mainExp.pressSequentially(formattedExp, { delay: 20 });
          }

          const mainCvc = page.locator('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"], input[name="cvc"], input[id*="cvc"], input[placeholder*="CVC"]').first();
          if (await mainCvc.isVisible().catch(() => false)) {
            await mainCvc.click();
            await mainCvc.pressSequentially(card_cvc, { delay: 20 });
          }

          const mainName = page.locator('#billingName, input[name="billingName"]').first();
          if (await mainName.isVisible().catch(() => false)) {
            await mainName.fill(holder_name);
          }
        }
      } catch (err) {}
    }

    await page.waitForTimeout(800);
    await takeScreenshot(page, 'step3_form_filled');

    // Step 5: Click Submit / Pay Button
    console.error('[BOT_STEP] Submitting payment form...');
    await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], a.btn'));
      for (const btn of buttons) {
        const txt = (btn.textContent || btn.value || '').toLowerCase();
        if (txt.includes('payer') || txt.includes('pay') || txt.includes('valider') || txt.includes('submit') || btn.type === 'submit') {
          btn.click();
          return true;
        }
      }
      return false;
    });

    console.error('[BOT_STEP] Waiting for bank/Stripe response...');

    // Step 6: Attente intelligente de la réponse (max 30s)
    let currentUrl = page.url();
    let pageText = '';
    let detectedError = null;

    for (let poll = 0; poll < 30; poll++) {
      await page.waitForTimeout(1000);
      try { currentUrl = page.url(); } catch (e) {}
      pageText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');

      detectedError = await page.evaluate(() => {
        const alertEl = document.querySelector('.card-errors, [role="alert"], .Error, .error-message, .alert-danger, .InputElement-error, .FormError, .p-FieldError, .ErrorMessage');
        if (alertEl && alertEl.textContent && alertEl.textContent.trim()) {
          return alertEl.textContent.trim();
        }
        return null;
      }).catch(() => null);

      if (detectedError) break;

      const lowerText = pageText.toLowerCase();
      if (currentUrl.includes('3d') || currentUrl.includes('acs') || currentUrl.includes('bank') || lowerText.includes('3d secure') || lowerText.includes('code de confirmation')) break;
      if (currentUrl.includes('success') || currentUrl.includes('confirm') || lowerText.includes('succès') || lowerText.includes('réussi') || lowerText.includes('thank you')) break;
      if (lowerText.includes('décliné') || lowerText.includes('refusé') || lowerText.includes('failed') || lowerText.includes('insufficient') || lowerText.includes('invalid') || lowerText.includes('invalide') || lowerText.includes('declined') || lowerText.includes('incorrect') || lowerText.includes('échec')) break;
    }

    await takeScreenshot(page, 'step4_after_submit');

    if (currentUrl.includes('3d') || currentUrl.includes('acs') || currentUrl.includes('bank') || pageText.toLowerCase().includes('3d secure') || pageText.toLowerCase().includes('code de confirmation')) {
      console.log(JSON.stringify({
        success: true,
        status: '3DS_REQUIRED',
        redirect_url: currentUrl,
        message: 'Authentification 3D Secure requise par la banque.',
        screenshots: capturedScreenshots,
        data: { url: currentUrl }
      }));
      await safeExit(0);
    }

    if (currentUrl.includes('success') || currentUrl.includes('confirm') || pageText.toLowerCase().includes('succès') || pageText.toLowerCase().includes('réussi') || pageText.toLowerCase().includes('thank you')) {
      console.log(JSON.stringify({
        success: true,
        status: 'SUCCESS',
        message: 'Paiement effectué et validé avec succès sans redirection !',
        screenshots: capturedScreenshots,
        data: { url: currentUrl }
      }));
      await safeExit(0);
    }

    const lowerText = pageText.toLowerCase();
    const hasDeclineKeywords = lowerText.includes('décliné') || 
                               lowerText.includes('refusé') || 
                               lowerText.includes('failed') || 
                               lowerText.includes('insufficient') ||
                               lowerText.includes('invalid') ||
                               lowerText.includes('invalide') ||
                               lowerText.includes('declined') ||
                               lowerText.includes('incorrect') ||
                               lowerText.includes('échec');

    if (detectedError || hasDeclineKeywords) {
      const finalMsg = detectedError || 'Le paiement par carte bancaire a été refusé par l\'émetteur ou les informations de la carte sont invalides.';
      console.log(JSON.stringify({
        success: false,
        status: 'DECLINED',
        message: finalMsg,
        screenshots: capturedScreenshots,
        data: { url: currentUrl }
      }));
      await safeExit(0);
    }

    console.log(JSON.stringify({
      success: false,
      status: 'DECLINED',
      message: 'Le paiement par carte n\'a pas pu être validé. Veuillez vérifier vos informations de carte.',
      screenshots: capturedScreenshots,
      data: { url: currentUrl }
    }));

    await safeExit(0);

  } catch (error) {
    console.log(JSON.stringify({
      success: false,
      status: 'ERROR',
      message: 'Erreur lors de l\'exécution du bot de paiement: ' + error.message,
      screenshots: capturedScreenshots
    }));
    await safeExit(1);
  }
}

runBot();
