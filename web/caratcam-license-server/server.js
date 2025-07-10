const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Use raw body parser for Stripe webhook
app.use(bodyParser.raw({ type: 'application/json' }));

// For all other endpoints, parse JSON normally
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') return next();
  bodyParser.json()(req, res, next);
});

const issuedTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Health check route
app.get('/', (req, res) => {
  res.send('✅ License server is running.');
});

// Token validation route
app.get('/validate', (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'Missing token parameter' });

  const isValid = issuedTokens.has(token);
  res.json({ valid: isValid });
});

// Stripe checkout session creation
app.post('/create-checkout-session', async (req, res) => {
  const { priceId, mode } = req.body;

  if (!priceId || !mode) {
    return res.status(400).json({ error: 'Missing priceId or mode' });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode,
      success_url: 'https://www.camlabs.ai/unlocked-caratcam-single.html?token={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://www.camlabs.ai/cancel.html',
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('❌ Stripe session creation failed:', err);
    res.status(500).json({ error: err.message });
  }
});

// Stripe webhook (license issue trigger)
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Webhook verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sessionId = session.id;

    const licenseKey = generateToken();
    issuedTokens.add(licenseKey);

    console.log(`✅ NEW LICENSE ISSUED: ${licenseKey}`);
    console.log(`🔗 Unlock URL: https://www.camlabs.ai/unlocked-caratcam-single.html?token=${licenseKey}`);
  }

  res.status(200).send('Received');
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 License server listening on port ${port}`);
});
