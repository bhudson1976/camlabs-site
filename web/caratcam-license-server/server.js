const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const app = express();
require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Use raw body parser for Stripe
app.use(bodyParser.raw({ type: 'application/json' }));

// Simple in-memory token store
const issuedTokens = new Set();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Root route for Railway
app.get("/", (req, res) => {
  res.send("✅ License server is running.");
});

// Validate route
app.get("/validate", (req, res) => {
  const token = req.query.token;
  if (!token) {
    return res.status(400).json({ error: "Missing token parameter" });
  }

  const isValid = issuedTokens.has(token);
  res.json({ valid: isValid });
});

// Stripe webhook
app.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details.email;

    const licenseKey = generateToken();
    issuedTokens.add(licenseKey);

    const unlockLink = `https://www.camlabs.ai/unlocked-caratcam-single.html?token=${licenseKey}`;

    console.log(`✅ NEW LICENSE ISSUED: ${email}`);
    console.log(`🔗 ${unlockLink}`);
  }

  res.status(200).send('Received');
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`🚀 License server listening on port ${port}`);
});
