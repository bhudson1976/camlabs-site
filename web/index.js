require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE\_SECRET\_KEY);
const app = express();
const PORT = process.env.PORT || 8080;

// ✅ Use raw ONLY for webhook
app.use('/webhook', bodyParser.raw({ type: 'application/json' }));

// ✅ Use JSON parser for all other routes
app.use(express.json());

// ✅ Health check
app.get('/', (req, res) => {
res.send('✅ CaratCam Stripe server is live');
});

// ✅ Stripe Checkout Session Creator
app.post('/create-checkout-session', async (req, res) => {
try {
const { priceId, mode, product } = req.body;

```
if (!priceId || !mode) {
  return res.status(400).json({ error: 'Missing priceId or mode' });
}

const session = await stripe.checkout.sessions.create({
  mode,
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: `https://www.camlabs.ai/unlocked-caratcam-single.html?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `https://www.camlabs.ai/cancel`,
});

console.log('✅ Stripe session created:', session.id);
res.json({ url: session.url });
```

} catch (err) {
console.error('❌ Session creation failed:', err.message);
res.status(500).json({ error: err.message });
}
});

// ✅ Stripe Webhook Handler
app.post('/webhook', (req, res) => {
const sig = req.headers\['stripe-signature'];
const endpointSecret = process.env.STRIPE\_WEBHOOK\_SECRET;

let event;
try {
event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
} catch (err) {
console.error('❌ Invalid Stripe signature:', err.message);
return res.status(400).send(`Webhook Error: ${err.message}`);
}

if (event.type === 'checkout.session.completed') {
const session = event.data.object;
const email = session.customer\_details?.email || 'Unknown';
const name = session.customer\_details?.name || 'Unknown';
const amountTotal = session.amount\_total / 100;

```
console.log('✅ Payment received!');
console.log(`📧 Email: ${email}`);
console.log(`👤 Name: ${name}`);
console.log(`💰 Amount: $${amountTotal.toFixed(2)}`);
console.log(`🧾 Session ID: ${session.id}`);

const token = crypto.randomBytes(16).toString('hex');
console.log(`🔐 Generated license token: ${token}`);
```

}

res.sendStatus(200);
});

// 🌍 Start server
app.listen(PORT, () => {
console.log(`🚀 Listening on http://localhost:${PORT}`);
});
