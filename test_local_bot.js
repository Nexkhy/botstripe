const { chromium } = require('playwright');

async function testBot() {
  console.log('=== TEST LOCAL DU BOT SUR LA NOUVELLE TRANSACTION (1000 XOF) ===');
  const checkout_url = 'https://geniuspay.ci/checkout/MTX-0S1MA5MQR4';
  const card_number = '4242424242424242';
  const card_exp_month = '12';
  const card_exp_year = '2028';
  const card_cvc = '123';
  const holder_name = 'Nelson Test';
  const email = 'nelsonsiebi237@gmail.com';

  const expYearShort = card_exp_year.toString().slice(-2);
  const formattedExp = `${card_exp_month.toString().padStart(2, '0')}/${expYearShort}`;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0)/1000).toFixed(1)}s] ${msg}`);

  page.on('response', res => {
    if (res.status() >= 300 && res.status() < 400 && (res.url().includes('pay') || res.url().includes('checkout'))) {
      log(`REDIRECT ${res.status()}: ${res.url()} -> ${res.headers()['location']}`);
    }
  });

  try {
    log(`1. Navigation vers : ${checkout_url}`);
    await page.goto(checkout_url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    log(`Page chargée: ${page.url()}`);

    log('2. Attente initialisation AlpineJS...');
    await page.waitForFunction(() => typeof window.Alpine !== 'undefined', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(500);

    log('3. Sélection de la méthode Stripe...');
    await page.evaluate(() => {
      const form = document.querySelector('form[action*="/pay"]');
      const alpine = window.Alpine.$data(form);
      const stripe = alpine.paymentMethods.find(m => m.id === 'stripe');
      if (stripe) alpine.selectMethod(stripe);
    });
    await page.waitForTimeout(600);

    log('4. Soumission du formulaire...');
    await page.evaluate(() => {
      const form = document.querySelector('form[action*="/pay"]');
      HTMLFormElement.prototype.submit.call(form);
    });

    log('5. Attente de la redirection vers Stripe...');
    const urlBefore = page.url();
    await Promise.race([
      page.waitForURL(url => !url.href.includes('/checkout/MTX-'), { timeout: 15000 }),
      page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 })
    ]).catch(() => {});
    await page.waitForTimeout(2000);
    log(`Page actuelle après soumission: ${page.url()}`);

    await page.screenshot({ path: 'test_1000_after_submit.png' });

    // Step 4: Inject Card Details
    log('6. Recherche du formulaire carte bancaire...');
    let cardInjected = false;
    const IV_OPTS = { timeout: 500 };

    for (let attempt = 0; attempt < 15; attempt++) {
      log(`Vérification inputs carte (tentative ${attempt + 1}, frames: ${page.frames().length})...`);
      for (const frame of page.frames()) {
        try {
          const numInput = frame.locator('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"], input[id*="cardNumber"], input[name="cardnumber"], input[name="number"]').first();
          if (await numInput.isVisible(IV_OPTS).catch(() => false)) {
            log(`Formulaire trouvé dans la frame: ${frame.url()}`);
            await numInput.click();
            await numInput.pressSequentially(card_number, { delay: 20 });
            cardInjected = true;
            const expInput = frame.locator('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"], input[id*="cardExpiry"], input[name="exp-date"], input[name="expiry"]').first();
            if (await expInput.isVisible(IV_OPTS).catch(() => false)) { await expInput.click(); await expInput.pressSequentially(formattedExp, { delay: 20 }); }
            const cvcInput = frame.locator('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"], input[id*="cardCvc"], input[name="cvc"], input[name="cvv"]').first();
            if (await cvcInput.isVisible(IV_OPTS).catch(() => false)) { await cvcInput.click(); await cvcInput.pressSequentially(card_cvc, { delay: 20 }); }
            const nameInput = frame.locator('#billingName, input[name="billingName"], input[id*="billingName"]').first();
            if (await nameInput.isVisible(IV_OPTS).catch(() => false)) await nameInput.fill(holder_name);
            break;
          }
        } catch (err) {}
      }

      if (!cardInjected) {
        try {
          const mainNum = page.locator('#cardNumber, input[name="cardNumber"], input[autocomplete="cc-number"], input[name="cardnumber"], input[id*="card-number"], input[placeholder*="4242"]').first();
          if (await mainNum.isVisible(IV_OPTS).catch(() => false)) {
            log('Formulaire trouvé dans la page principale');
            await mainNum.click();
            await mainNum.pressSequentially(card_number, { delay: 20 });
            cardInjected = true;
            const mainExp = page.locator('#cardExpiry, input[name="cardExpiry"], input[autocomplete="cc-exp"], input[name="exp-date"], input[id*="exp"], input[placeholder*="MM"]').first();
            if (await mainExp.isVisible(IV_OPTS).catch(() => false)) { await mainExp.click(); await mainExp.pressSequentially(formattedExp, { delay: 20 }); }
            const mainCvc = page.locator('#cardCvc, input[name="cardCvc"], input[autocomplete="cc-csc"], input[name="cvc"], input[id*="cvc"], input[placeholder*="CVC"]').first();
            if (await mainCvc.isVisible(IV_OPTS).catch(() => false)) { await mainCvc.click(); await mainCvc.pressSequentially(card_cvc, { delay: 20 }); }
            const mainName = page.locator('#billingName, input[name="billingName"]').first();
            if (await mainName.isVisible(IV_OPTS).catch(() => false)) await mainName.fill(holder_name);
          }
        } catch (err) {}
      }

      if (cardInjected) break;
      await page.waitForTimeout(1000);
    }

    if (!cardInjected) {
      log('❌ Aucun formulaire de carte trouvé.');
      await page.screenshot({ path: 'test_1000_failed_no_card.png' });
      return;
    }

    log('✅ Données de carte injectées avec succès !');
    await page.screenshot({ path: 'test_1000_card_filled.png' });

    log('7. Soumission du paiement chez Stripe...');
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

    log('8. Attente réponse Stripe / Banque...');
    for (let poll = 0; poll < 20; poll++) {
      await page.waitForTimeout(1000);
      const url = page.url();
      const text = await page.evaluate(() => document.body ? document.body.innerText.substring(0, 300) : '').catch(() => '');
      log(`Poll ${poll + 1}s: URL=${url.substring(0, 60)} | Text=${text.replace(/\n/g, ' ').substring(0, 80)}`);
      if (url.includes('3d') || url.includes('success') || text.toLowerCase().includes('succès') || text.toLowerCase().includes('échec') || text.toLowerCase().includes('décliné')) {
        break;
      }
    }

    await page.screenshot({ path: 'test_1000_final_result.png' });
    log('=== TEST 1000 XOF TERMINÉ AVEC SUCCÈS ===');

  } catch (err) {
    log(`Erreur: ${err.message}`);
  } finally {
    await browser.close();
  }
}

testBot();
