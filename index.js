// CamLabs license server (Render) — CaratCam + Sentinel AI · PRODUCTION
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

const app = express();
const PORT = process.env.PORT || 10000;

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow the production storefront to call the Sentinel checkout endpoint.
// Both apex and www are permitted (CaratCam flows use www). The webhook is
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
// fast 200 instead of a 404 on '/'. Reports both product lines on this server.
app.get('/', (req, res) => {
  res.status(200).send('✅ CamLabs license server running — CaratCam + Sentinel AI');
});

// ─── Sentinel AI routes ───────────────────────────────────────────────────────
// Webhook first — it mounts its own express.raw body parser internally, so it
// must NOT be preceded by a global JSON parser.
registerSentinelWebhook(app, stripe);
// Checkout session creation (browser POSTs JSON → { url }).
app.post('/sentinel/create-checkout-session', express.json(), sentinelCheckoutRoute(stripe));

// ─── CaratCam (existing, preserved) ─────────────────────────────────────────────
const LICENSE_FILE = 'licenses.json';
let licenses = fs.existsSync(LICENSE_FILE) ? JSON.parse(fs.readFileSync(LICENSE_FILE)) : [];
function saveLicenses() {
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(licenses, null, 2));
}

// CaratCam Stripe webhook → flat-file license.
app.post('/create-license', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('❌ CaratCam webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }
  if (event.type !== 'checkout.session.completed') {
    return res.status(400).json({ error: 'Unhandled event type' });
  }
  const token = 'CCP-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  licenses.push({ token, created_at: new Date().toISOString() });
  saveLicenses();
  console.log('✅ New CaratCam license issued:', token);
  res.json({ success: true });
});

// CaratCam license check.
app.get('/check-license', (req, res) => {
  const { token } = req.query;
  res.json({ valid: !!licenses.find((l) => l.token === token) });
});

// CaratCam checkout.
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.PRICE_ID, quantity: 1 }],
      success_url: 'https://www.camlabs.ai/unlocked-caratcam-plus.html?token={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.camlabs.ai/cancel.html',
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('❌ CaratCam Stripe session creation failed:', err.message);
    res.status(500).json({ error: 'Stripe session error' });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 CamLabs license server running on port ${PORT}`);
});
