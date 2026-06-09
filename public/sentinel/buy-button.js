// Sentinel AI · front-end "Buy" button handler (production)
//
// The static site (Firebase) can't run server code, so this calls the Render
// Express endpoint, which creates the Stripe Checkout session and returns a URL.

// ── Global Configuration ──────────────────────────────────────────────────────
// On localhost we hit a local dev server; otherwise we hit Render in production.
// Swap the placeholder below for your real Render app name.
const API_BASE_URL =
  typeof window !== 'undefined' && window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://YOUR-ACTUAL-RENDER-APP-NAME.onrender.com'; // ← update this text placeholder manually

const CHECKOUT_ENDPOINT = `${API_BASE_URL}/sentinel/create-checkout-session`;
// ──────────────────────────────────────────────────────────────────────────────

(function () {
  const button = document.getElementById('buy-sentinel');
  if (!button) return;

  const originalLabel = button.textContent;
  const loadingLabel = button.dataset.loadingLabel || 'Redirecting…';

  button.addEventListener('click', async () => {
    button.disabled = true;
    button.textContent = loadingLabel;
    try {
      const res = await fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          // Pass the logged-in user's email if your site exposes one.
          email: window.currentUserEmail || null,
          // Server remains the source of truth and also stamps this server-side.
          metadata: { product: 'sentinel-ai' },
        }),
      });

      if (!res.ok) throw new Error('Checkout request failed: ' + res.status);

      const { url } = await res.json();
      if (!url) throw new Error('No checkout URL returned');

      window.location.href = url; // off to Stripe-hosted checkout
    } catch (err) {
      console.error(err);
      alert('Sorry — we couldn’t start checkout. Please try again in a moment.');
      button.disabled = false;
      button.textContent = originalLabel;
    }
  });
})();
