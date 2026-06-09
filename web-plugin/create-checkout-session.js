// Sentinel AI · Stripe Checkout Session creation (backend)
//
// Creates the one-time $149.99 "Buy Sentinel AI" checkout session.

// ─── Configuration ───────────────────────────────────────────────────────────
const SENTINEL_PRODUCT = {
  name: 'Sentinel AI — Lifetime License',
  description:
    'Local-first AI security auditing for Flutter & Dart. One machine, lifetime access — no subscription.',
  amount: 14999, // USD cents = $149.99
  currency: 'usd',
};

const SITE = {
  defaultOrigin: 'https://camlabs.ai',
  successPath: '/sentinel/download.html', // downloads stay open; key gates the app
  cancelPath: '/sentinel/',
};
// ─────────────────────────────────────────────────────────────────────────────

function buildLineItem() {
  if (process.env.SENTINEL_PRICE_ID) {
    return { price: process.env.SENTINEL_PRICE_ID, quantity: 1 };
  }
  return {
    quantity: 1,
    price_data: {
      currency: SENTINEL_PRODUCT.currency,
      unit_amount: SENTINEL_PRODUCT.amount,
      product_data: {
        name: SENTINEL_PRODUCT.name,
        description: SENTINEL_PRODUCT.description,
      },
    },
  };
}

async function createSentinelCheckoutSession(stripe, { origin, email } = {}) {
  const base = origin || SITE.defaultOrigin;

  return stripe.checkout.sessions.create({
    mode: 'payment',
    billing_address_collection: 'required',
    line_items: [buildLineItem()],
    ...(email ? { customer_email: email } : {}),
    allow_promotion_codes: true,
    // Tag so the webhook can tell Sentinel sales apart from other products.
    metadata: { product: 'sentinel-ai', tier: 'lifetime' },
    payment_intent_data: { metadata: { product: 'sentinel-ai', tier: 'lifetime' } },
    success_url: `${base}${SITE.successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}${SITE.cancelPath}`,
  });
}

function sentinelCheckoutRoute(stripe) {
  return async (req, res) => {
    try {
      const email = (req.body && req.body.email) || undefined;
      const origin = req.headers.origin || undefined;
      const session = await createSentinelCheckoutSession(stripe, { origin, email });
      res.json({ url: session.url });
    } catch (err) {
      console.error('❌ Sentinel checkout session failed:', err.message);
      res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
  };
}

module.exports = { SENTINEL_PRODUCT, createSentinelCheckoutSession, sentinelCheckoutRoute };
