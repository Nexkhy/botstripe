/**
 * GeniusPay & Stripe Card Payment Automation Bot with Step-by-Step Screenshots
 * Isolated Microservice Bot Script for Nelsius PaymentBot
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const dns = require('dns');

try {
  dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const systemTmp = process.env.TEMP || process.env.TMP || process.env.TMPDIR || os.tmpdir() || path.join(__dirname, '..', 'tmp');
if (!fs.existsSync(systemTmp)) {
  try { fs.mkdirSync(systemTmp, { recursive: true }); } catch (e) {}
}
process.env.TEMP = systemTmp;
process.env.TMP = systemTmp;
process.env.TMPDIR = systemTmp;

async function runBot() {
  let browser = null;
  const inputArg = process.argv[2] || '{}';
  let input = {};

  const globalTimer = setTimeout(() => {
    console.log(JSON.stringify({
      success: false,
      status: 'TIMEOUT',
      message: 'Le bot de paiement a dépassé le délai maximum de 45 secondes.'
    }));
    if (browser && browser.process()) {
      try { browser.process().kill('SIGKILL'); } catch (e) {}
    }
    process.exit(1);
  }, 45000);

  const safeExit = async (code = 0) => {
    clearTimeout(globalTimer);
    if (browser) {
      const forceKill = setTimeout(() => {
        if (browser && browser.process()) {
          try { browser.process().kill('SIGKILL'); } catch (e) {}
        }
      }, 1500);
      try { await browser.close(); } catch (e) {}
      clearTimeout(forceKill);
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
      await page.screenshot({ path: filepath, fullPage: true });
      capturedScreenshots.push({ step: stepName, file: filepath });
    } catch (err) {}
  };

  const expYearShort = card_exp_year.toString().slice(-2);
  const formattedExp = `${card_exp_month.toString().padStart(2, '0')}/${expYearShort}`;

  try {
    let resolvedIp = null;
    let targetHost = '';
    try {
      targetHost = new URL(checkout_url).hostname;
      const ips = await dns.promises.resolve4(targetHost).catch(() => null);
      if (ips && ips.length > 0) {
        resolvedIp = ips[0];
      } else if (targetHost.includes('geniuspay')) {
        resolvedIp = '104.21.46.124';
      }
    } catch (e) {}

    const chromeArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--ignore-certificate-errors',
      '--ignore-certificate-errors-spki-list',
      '--allow-insecure-localhost',
      '--no-first-run',
      '--no-default-browser-check',
      '--dns-result-order=ipv4first'
    ];

    if (resolvedIp && targetHost) {
      chromeArgs.push(`--host-resolver-rules=MAP ${targetHost} ${resolvedIp}, MAP *.${targetHost} ${resolvedIp}`);
    }

    console.error('[BOT_STEP] Launching headless browser...');
    const launchOpts = {
      headless: headless ? true : false,
      timeout: 25000,
      args: chromeArgs
    };
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      launchOpts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    browser = await puppeteer.launch(launchOpts);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Step 1: Navigate to Checkout URL
    console.error(`[BOT_STEP] Navigating to checkout URL: ${checkout_url}`);
    let navErr = null;
    try {
      await page.goto(checkout_url, { waitUntil: 'domcontentloaded', timeout: 12000 });
    } catch (err) {
      navErr = err;
    }
    if (navErr) {
      throw navErr;
    }
    await takeScreenshot(page, 'step1_landing_page');

    // Step 2: Click "Continuer" on GeniusPay Landing Page if present
    console.error('[BOT_STEP] Checking for Continuer button...');
    await new Promise(r => setTimeout(r, 600));

    const continuerClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      for (const btn of btns) {
        if ((btn.textContent || '').toLowerCase().includes('continuer')) {
          btn.click();
          return true;
        }
      }
      const target = Array.from(document.querySelectorAll('div, span')).find(el => {
        const text = (el.textContent || '').trim().toLowerCase();
        return text === 'continuer →' || text === 'continuer' || text.startsWith('continuer');
      });
      if (target) {
        target.click();
        return true;
      }
      return false;
    }).catch(() => false);

    if (continuerClicked) {
      console.error('[BOT_STEP] Continuer clicked, waiting for Stripe navigation...');
      await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {});
    }

    await new Promise(r => setTimeout(r, 1200));
    await takeScreenshot(page, 'step2_card_option_selected');

    // Step 3: Fill customer details if present
    console.error('[BOT_STEP] Filling customer profile data...');
    try {
      const emailInput = await page.$('input[type="email"], input[name="email"]');
      if (emailInput && email) {
        await emailInput.click({ clickCount: 3 });
        await emailInput.type(email);
      }
      const nameInput = await page.$('input[name="name"], input[name="holder"], input[name="cardholder"]');
      if (nameInput && holder_name) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type(holder_name);
      }
    } catch (e) {}

    // Step 4: Inject Card Details
    console.error('[BOT_STEP] Injecting card number, expiration & CVC...');
    let cardInjected = false;

    if (page.url().includes('stripe.com')) {
      try {
        const frames = page.frames();
        for (const frame of frames) {
          const numInput = await frame.$('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"], input[id*="cardNumber"]');
          if (numInput) {
            await numInput.click({ clickCount: 3 });
            await numInput.type(card_number, { delay: 20 });
            cardInjected = true;
          }
          const expInput = await frame.$('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"], input[id*="cardExpiry"]');
          if (expInput) {
            await expInput.click({ clickCount: 3 });
            await expInput.type(formattedExp, { delay: 20 });
          }
          const cvcInput = await frame.$('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"], input[id*="cardCvc"]');
          if (cvcInput) {
            await cvcInput.click({ clickCount: 3 });
            await cvcInput.type(card_cvc, { delay: 20 });
          }
          const nameInput = await frame.$('#billingName, input[name="billingName"], input[id*="billingName"]');
          if (nameInput) {
            await nameInput.click({ clickCount: 3 });
            await nameInput.press('Backspace');
            await nameInput.type(holder_name, { delay: 20 });
          }
        }

        if (!cardInjected) {
          const mainNum = await page.$('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"]');
          if (mainNum) {
            await mainNum.click({ clickCount: 3 });
            await mainNum.type(card_number, { delay: 20 });
            cardInjected = true;
          }
          const mainExp = await page.$('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"]');
          if (mainExp) {
            await mainExp.click({ clickCount: 3 });
            await mainExp.type(formattedExp, { delay: 20 });
          }
          const mainCvc = await page.$('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"]');
          if (mainCvc) {
            await mainCvc.click({ clickCount: 3 });
            await mainCvc.type(card_cvc, { delay: 20 });
          }
          const mainName = await page.$('#billingName, input[name="billingName"]');
          if (mainName) {
            await mainName.click({ clickCount: 3 });
            await mainName.press('Backspace');
            await mainName.type(holder_name, { delay: 20 });
          }
        }
      } catch (err) {}
    }

    if (!cardInjected) {
      const frames = page.frames();
      const stripeFrame = frames.find(f => f.url().includes('stripe') || f.name().includes('stripe'));
      if (stripeFrame) {
        try {
          const numInput = await stripeFrame.$('input[name="cardnumber"], input[name="number"]');
          if (numInput) {
            await numInput.type(card_number, { delay: 20 });
          }
          const expInput = await stripeFrame.$('input[name="exp-date"], input[name="expiry"]');
          if (expInput) {
            await expInput.type(formattedExp, { delay: 20 });
          }
          const cvcInput = await stripeFrame.$('input[name="cvc"], input[name="cvv"]');
          if (cvcInput) {
            await cvcInput.type(card_cvc, { delay: 20 });
          }
          cardInjected = true;
        } catch (err) {}
      }
    }

    if (!cardInjected) {
      const numInput = await page.$('input[name="cardnumber"], input[id*="card-number"], input[placeholder*="4242"], input[autocomplete="cc-number"], input[name="cardNumber"]');
      if (numInput) {
        await numInput.type(card_number, { delay: 20 });
      }

      const expInput = await page.$('input[name="exp-date"], input[id*="exp"], input[placeholder*="MM"], input[autocomplete="cc-exp"], input[name="cardExpiry"]');
      if (expInput) {
        await expInput.type(formattedExp, { delay: 20 });
      }

      const cvcInput = await page.$('input[name="cvc"], input[id*="cvc"], input[placeholder*="CVC"], input[autocomplete="cc-csc"], input[name="cardCvc"]');
      if (cvcInput) {
        await cvcInput.type(card_cvc, { delay: 20 });
      }
    }

    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 800)));
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

    // Step 6: Poll for response up to 7 seconds max
    let currentUrl = page.url();
    let pageText = '';
    let detectedError = null;

    for (let poll = 0; poll < 14; poll++) {
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500))).catch(() => {});
      currentUrl = page.url();
      pageText = await page.evaluate(() => document.body ? document.body.innerText : '').catch(() => '');
      
      detectedError = await page.evaluate(() => {
        const alertEl = document.querySelector('.card-errors, [role="alert"], .Error, .error-message, .alert-danger, .InputElement-error, .FormError');
        if (alertEl && alertEl.textContent && alertEl.textContent.trim()) {
          return alertEl.textContent.trim();
        }
        return null;
      }).catch(() => null);

      if (detectedError) break;

      const lowerText = pageText.toLowerCase();
      if (currentUrl.includes('3d') || currentUrl.includes('acs') || currentUrl.includes('bank') || lowerText.includes('3d secure') || lowerText.includes('code de confirmation')) {
        break;
      }

      if (currentUrl.includes('success') || currentUrl.includes('confirm') || lowerText.includes('succès') || lowerText.includes('réussi') || lowerText.includes('thank you')) {
        break;
      }

      if (lowerText.includes('décliné') || lowerText.includes('refusé') || lowerText.includes('failed') || lowerText.includes('insufficient') || lowerText.includes('invalid') || lowerText.includes('invalide') || lowerText.includes('declined') || lowerText.includes('incorrect') || lowerText.includes('échec')) {
        break;
      }
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
