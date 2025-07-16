const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
console.log("🧪 Forcing Git to register this edit");

console.log("📦 Stripe integration initializing...");
console.log("🔐 Using Stripe Key:", process.env.STRIPE_SECRET_KEY?.substring(0, 10));

const app = express();
const PORT = process.env.PORT || 10000;

// 📦 License store
const LICENSE_FILE = 'licenses.json';
let licenses = fs.existsSync(LICENSE_FILE) ? JSON.parse(fs.readFileSync(LICENSE_FILE)) : [];

function saveLicenses() {
  fs.writeFileSync(LICENSE_FILE, JSON.stringify(licenses, null, 2));
}

// 🔐 Stripe webhook handler
app.post('/create-license', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type !== 'checkout.session.completed') {
    return res.status(400).json({ error: 'Unhandled event type' });
  }

  const session = event.data.object;
  const token = 'CCP-' + crypto.randomBytes(5).toString('hex').toUpperCase();

  const newLicense = {
    token,
    created_at: new Date().toISOString()
  };

  licenses.push(newLicense);
  saveLicenses();

  console.log('✅ New license issued:', token);
  res.json({ success: true });
});

// ✅ Validate license token
app.get('/check-license', (req, res) => {
  const { token } = req.query;
  const match = licenses.find(l => l.token === token);

  if (!match) {
    return res.json({ valid: false });
  }

  res.json({ valid: true });
});

// 💳 Create Stripe Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price: process.env.PRICE_ID, // <-- you control this in .env
          quantity: 1
        }
      ],
      success_url: `https://www.camlabs.ai/unlocked-caratcam-plus.html?token={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://www.camlabs.ai/cancel.html`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('❌ Stripe session creation failed:', err.message);
    res.status(500).json({ error: 'Stripe session error' });
  }
});

// 🌍 Start server
app.listen(PORT, () => {
  console.log(`🚀 CaratCam Plus license server running on port ${PORT}`);
});
