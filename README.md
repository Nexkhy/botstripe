# Nelsius PaymentBot Microservice

Microservice de paiement par carte bancaire automatisé (Puppeteer / Chrome Headless).

Ce projet est **100% indépendant** et peut être hébergé sur n'importe quel serveur (VPS Linux, VPS Windows, Docker) disposant de Node.js v18+.

---

## 🚀 Installation & Démarrage

### 1. Installation des dépendances
```bash
npm install
```

### 2. Configuration (`.env`)
Copiez `.env.example` en `.env` :
```bash
cp .env.example .env
```
Assurez-vous de définir votre clé d'API secrète :
```env
PORT=4000
BOT_API_KEY=nelsius_secret_bot_key_2026
HEADLESS=true
```

### 3. Lancer le service en mode de production
```bash
npm start
```

Ou avec PM2 pour un lancement continu en tâche de fond :
```bash
npx pm2 start server.js --name "nelsius-payment-bot"
```

---

## 🔒 Sécurité & API Endpoints

Toutes les requêtes d'API (sauf `/health`) doivent être accompagnées de l'en-tête HTTP :
`X-API-KEY: <BOT_API_KEY>`

### 1. Healthcheck (Test de santé)
- **Method** : `GET`
- **URL** : `/health`

**Réponse (200 OK)** :
```json
{
  "status": "ok",
  "service": "Nelsius PaymentBot Microservice",
  "timestamp": "2026-09-10T14:40:00.000Z"
}
```

### 2. Exécution d'un paiement Carte (`POST /api/v1/process-card`)
- **Headers** :
  - `Content-Type: application/json`
  - `X-API-KEY: nelsius_secret_bot_key_2026`
- **Body** :
```json
{
  "checkout_url": "https://geniuspay.ci/checkout/MTX-XXXXX",
  "card_number": "4242424242424242",
  "card_exp_month": "12",
  "card_exp_year": "28",
  "card_cvc": "123",
  "holder_name": "Client Nelsius",
  "email": "client@example.com"
}
```

**Réponse Réussie (200 OK)** :
```json
{
  "success": false,
  "status": "DECLINED",
  "message": "Le paiement par carte bancaire a été refusé par l'émetteur...",
  "screenshots": [...]
}
```
