const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const crypto = require('crypto');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const app = express();
const PORT = process.env.PORT || 3000;

// 🔐 STRIPE WEBHOOK — must be FIRST and must use express.raw() directly
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
    const email = session.customer_email;
    const plan = session.metadata?.plan || 'monthly';

    if (!email || !plan) {
        return res.status(400).json({ error: 'Missing email or plan' });
    }

    const key = 'CCM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const now = new Date();
    let expires;

    if (plan === 'monthly') {
        expires = new Date(now.setMonth(now.getMonth() + 1));
    } else if (plan === 'yearly') {
        expires = new Date(now.setFullYear(now.getFullYear() + 1));
    } else {
        expires = new Date(now.setDate(now.getDate() + 1)); // one-time = 24 hrs
    }

    const newLicense = {
        email,
        key,
        plan,
        expires: expires.toISOString()
    };

    // ✅ Save licenses to JSON file
    licenses.push(newLicense);
    saveLicenses();

    console.log("✅ New license created:", newLicense);
    res.json({ success: true, key, expires: newLicense.expires });
});

// ✅ Standard JSON body parser for all remaining routes
app.use(bodyParser.json());

// 📦 Load or initialize license store
const LICENSE_FILE = 'licenses.json';
let licenses = fs.existsSync(LICENSE_FILE) ? JSON.parse(fs.readFileSync(LICENSE_FILE)) : [];

function saveLicenses() {
    fs.writeFileSync(LICENSE_FILE, JSON.stringify(licenses, null, 2));
}

// 🔎 License check route
app.get('/check-license', (req, res) => {
    const { key } = req.query;
    const license = licenses.find(l => l.key === key);

    if (!license) return res.json({ valid: false });

    const now = new Date();
    const expires = new Date(license.expires);

    if (now > expires) {
        return res.json({ valid: false, expired: true, expires: license.expires });
    }

    res.json({ valid: true, plan: license.plan, expires: license.expires });
});

// 💳 Create Stripe Checkout Session
app.post('/create-checkout-session', async (req, res) => {
    const { plan, email } = req.body;

    if (!plan || !email) {
        return res.status(400).json({ error: 'Missing email or plan' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card'],
            customer_email: email,
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `CaratCam License (${plan})`,
                        },
                        unit_amount:
                            plan === 'yearly' ? 11900 :
                            plan === 'monthly' ? 1499 :
                            plan === 'one-time' ? 699 : 499,
                    },
                    quantity: 1,
                },
            ],
            metadata: {
                plan,
            },
            success_url: 'https://camlabs.ai/success',
            cancel_url: 'https://camlabs.ai/cancel',
        });

        res.json({ url: session.url });
    } catch (err) {
        console.error('❌ Stripe session error:', err.message);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// 🌍 Server startup
app.listen(PORT, () => {
    console.log(`✅ License server running on port ${PORT}`);
});
