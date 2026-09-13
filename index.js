// CamLabs license server (Render) — Sentinel AI · PRODUCTION
// Dependencies: express, cors, stripe, @supabase/supabase-js, dotenv
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Sentinel modules
const { registerSentinelWebhook } = require('./web-plugin/sentinel-webhook');
const { sentinelCheckoutRoute } = require('./web-plugin/create-checkout-session');
const { requestUpdateRoute } = require('./web-plugin/request-update');

const app = express();
const PORT = process.env.PORT || 10000;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow the production storefront to call the Sentinel checkout endpoint.
// Both apex and www are permitted. The webhook is
// server-to-server (Stripe → us) and needs no CORS.
// To test locally, temporarily add 'http://localhost:5000' to this array.
app.use('/sentinel', cors({ origin: [
  'https://camlabs.ai',
  'https://www.camlabs.ai',
  'https://camlabs.web.app',          // Firebase Hosting default domain (live)
  'https://camlabs.firebaseapp.com',  // Firebase Hosting alternate domain
] }));

// ─── Health check ─────────────────────────────────────────────────────────────
// Lightweight liveness endpoint so Render's health check (and uptime pings) get a
// fast 200 instead of a 404 on '/'.
app.get('/', (req, res) => {
  res.status(200).send('✅ CamLabs license server running — Sentinel AI');
});

// ─── Sentinel AI routes ───────────────────────────────────────────────────────
// Webhook first — it mounts its own express.raw body parser internally, so it
// must NOT be preceded by a global JSON parser.
registerSentinelWebhook(app, stripe);
// Checkout session creation (browser POSTs JSON → { url }).
app.post('/sentinel/create-checkout-session', express.json(), sentinelCheckoutRoute(stripe));
// Email-gated update portal → emails verified customers time-limited R2 presigned links.
app.post('/sentinel/request-update', express.json(), requestUpdateRoute());

// ─── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 CamLabs license server running on port ${PORT}`);
});
