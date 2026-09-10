require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 4000;
const API_KEY = process.env.BOT_API_KEY || 'nelsius_secret_bot_key_2026';

app.use(cors());
app.use(express.json());

// Serve Dashboard static UI
app.use(express.static(path.join(__dirname, 'public')));

// Serve screenshots static directory
const screenshotsDir = path.join(__dirname, '..', 'backend', 'storage', 'app', 'public', 'bot_screenshots');
if (fs.existsSync(screenshotsDir)) {
  app.use('/screenshots', express.static(screenshotsDir));
}

// API Key Authentication Middleware (bypass for dashboard & health)
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

// Standard Process Card Payment Endpoint
app.post('/api/v1/process-card', (req, res) => {
  const payload = req.body || {};
  const { checkout_url, card_number, card_exp_month, card_exp_year, card_cvc } = payload;

  if (!checkout_url || !card_number || !card_exp_month || !card_exp_year || !card_cvc) {
    return res.status(400).json({
      success: false,
      status: 'MISSING_FIELDS',
      message: 'Champs de carte requis manquants (checkout_url, card_number, card_exp_month, card_exp_year, card_cvc).'
    });
  }

  const scriptPath = path.join(__dirname, 'scripts', 'genius_card_bot.js');
  const systemTmp = process.env.TEMP || process.env.TMP || os.tmpdir();
  const tempPayloadFile = path.join(systemTmp, `bot_payload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.json`);

  payload.screenshots_dir = screenshotsDir;
  fs.writeFileSync(tempPayloadFile, JSON.stringify(payload, null, 2));

  const nodeBinary = process.execPath;
  const botProcess = spawn(nodeBinary, [scriptPath, tempPayloadFile], {
    env: { ...process.env }
  });

  let stdoutData = '';
  let stderrData = '';

  botProcess.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  botProcess.stderr.on('data', (data) => {
    stderrData += data.toString();
  });

  const processTimeout = setTimeout(() => {
    try { botProcess.kill('SIGKILL'); } catch (e) {}
    if (fs.existsSync(tempPayloadFile)) {
      try { fs.unlinkSync(tempPayloadFile); } catch (e) {}
    }
    res.status(504).json({
      success: false,
      status: 'TIMEOUT',
      message: 'Délai d\'exécution dépassé par le bot (50s).'
    });
  }, 50000);

  botProcess.on('close', (code) => {
    clearTimeout(processTimeout);
    if (fs.existsSync(tempPayloadFile)) {
      try { fs.unlinkSync(tempPayloadFile); } catch (e) {}
    }

    try {
      const parsed = JSON.parse(stdoutData.trim());
      return res.json(parsed);
    } catch (e) {
      return res.status(500).json({
        success: false,
        status: 'EXECUTION_FAILED',
        message: 'Erreur lors du traitement de la réponse du bot.',
        raw_output: stdoutData,
        error_output: stderrData
      });
    }
  });
});

// SSE Streaming Process Card Endpoint for Dashboard UI
app.post('/api/v1/process-card-stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, timestamp: new Date().toISOString(), ...data })}\n\n`);
  };

  const payload = req.body || {};
  const { checkout_url, card_number, card_exp_month, card_exp_year, card_cvc } = payload;

  if (!checkout_url || !card_number || !card_exp_month || !card_exp_year || !card_cvc) {
    sendEvent('error', { message: 'Champs de carte requis manquants.' });
    return res.end();
  }

  sendEvent('log', { message: 'Démarrage du processus de paiement par carte...' });

  const scriptPath = path.join(__dirname, 'scripts', 'genius_card_bot.js');
  const systemTmp = process.env.TEMP || process.env.TMP || os.tmpdir();
  const tempPayloadFile = path.join(systemTmp, `bot_payload_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.json`);

  payload.screenshots_dir = screenshotsDir;
  fs.writeFileSync(tempPayloadFile, JSON.stringify(payload, null, 2));

  const nodeBinary = process.execPath;
  const botProcess = spawn(nodeBinary, [scriptPath, tempPayloadFile], {
    env: { ...process.env }
  });

  let stdoutData = '';

  botProcess.stdout.on('data', (data) => {
    stdoutData += data.toString();
  });

  botProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (line.trim()) {
        const cleanMsg = line.replace('[BOT_STEP]', '').replace('[BOT DEBUG]', '').trim();
        sendEvent('log', { message: cleanMsg });
      }
    }
  });

  const processTimeout = setTimeout(() => {
    try { botProcess.kill('SIGKILL'); } catch (e) {}
    if (fs.existsSync(tempPayloadFile)) {
      try { fs.unlinkSync(tempPayloadFile); } catch (e) {}
    }
    sendEvent('error', { message: 'Délai d\'exécution dépassé par le bot (50s).' });
    res.end();
  }, 50000);

  botProcess.on('close', (code) => {
    clearTimeout(processTimeout);
    if (fs.existsSync(tempPayloadFile)) {
      try { fs.unlinkSync(tempPayloadFile); } catch (e) {}
    }

    try {
      const parsed = JSON.parse(stdoutData.trim());
      sendEvent('result', { result: parsed });
    } catch (e) {
      sendEvent('error', { message: 'Erreur lors du traitement du JSON retourné par le bot.' });
    }
    res.end();
  });
});

app.listen(PORT, () => {
  console.log(`[Nelsius PaymentBot Service] Running on http://localhost:${PORT}`);
});
