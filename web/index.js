require('dotenv').config();
const express = require('express');
const app = express();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const bodyParser = require('body-parser');

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
const PORT = process.env.PORT || 4242;

app.use(express.static('public'));

// Stripe requires raw body for webhook verification
app.post('/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Invalid Stripe signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // ✅ Stripe payment completed
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const email = session.customer_details?.email || 'Unknown';
    const customerName = session.customer_details?.name || 'Unknown';
    const amountTotal = session.amount_total / 100;

    console.log('✅ Payment received!');
    console.log(`📧 Email: ${email}`);
    console.log(`👤 Name: ${customerName}`);
    console.log(`💰 Amount: $${amountTotal.toFixed(2)}`);
    console.log(`🧾 Session ID: ${session.id}`);

    // 🧠 Optionally: write to a log, database, or Google Sheet here

    // 🔧 Optional: If you use metadata or price IDs:
    const priceId = session.metadata?.price_id || '(not available)';

    // 🚀 YOU COULD EMAIL THE ZIP HERE (later)
  }

  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('✅ Stripe Webhook Server Online');
});

app.listen(PORT, () => {
  console.log(`🚀 Listening on http://localhost:${PORT}`);
});
