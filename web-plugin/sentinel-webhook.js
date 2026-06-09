// Sentinel AI · Stripe webhook handler for the Render Express server.
//
// Mounts alongside CaratCam's checkout on the same server. Issues a LIFETIME
// license only for Sentinel sales, writes it to Supabase, and emails the key.
//
// Requires Node 18+ (uses global fetch). Dependencies:
//   npm i stripe @supabase/supabase-js
//
// Env vars required:
//   SENTINEL_STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   RESEND_API_KEY, FROM_EMAIL

const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

// ─── Configuration ───────────────────────────────────────────────────────────
const CONFIG = {
  productTag: 'sentinel-ai', // only mint keys when session.metadata.product matches
  licenseKeyPrefix: 'SNTR-',
  tier: 'lifetime',
  maxActivations: 1, // hardware-bound: one machine per key
  email: {
    subject: 'Your Sentinel AI license key 🛡️',
    resendEndpoint: 'https://api.resend.com/emails',
    downloadUrl: 'https://camlabs.ai/sentinel/download.html',
  },
};
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Registers POST /sentinel/webhook on the given Express app.
 * Uses express.raw so the body is the unparsed Buffer Stripe needs to verify
 * the signature — do NOT let a global JSON parser touch this route.
 */
function registerSentinelWebhook(app, stripe) {
  app.post(
    '/sentinel/webhook',
    express.raw({ type: 'application/json' }),
    (req, res) => handleSentinelWebhook(req, res, stripe),
  );
}

async function handleSentinelWebhook(req, res, stripe) {
  // 1. Verify authenticity against THIS endpoint's signing secret.
  const signature = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // raw Buffer
      signature,
      process.env.SENTINEL_STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error('❌ Sentinel webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Acknowledge unrelated event types so Stripe stops retrying.
  if (event.type !== 'checkout.session.completed') {
    return res.status(200).json({ received: true, ignored: event.type });
  }

  const session = event.data.object;

  // 2. Product awareness — clean 200 so this isn't a Sentinel sale (e.g. CaratCam).
  if (session.metadata?.product !== CONFIG.productTag) {
    return res.status(200).json({ received: true, skipped: 'not-sentinel-ai' });
  }

  const email = session.customer_details?.email || session.customer_email;
  const name = session.customer_details?.name || null;
  const sessionId = session.id;
  if (!email) {
    console.error('No customer email on Sentinel session', sessionId);
    return res.status(400).json({ error: 'No customer email present' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  // 3. Idempotency guard — Stripe may deliver the same event more than once.
  const { data: existing, error: lookupErr } = await supabase
    .from('licenses')
    .select('license_key')
    .eq('stripe_session_id', sessionId)
    .maybeSingle();

  if (lookupErr) {
    console.error('Idempotency lookup failed:', lookupErr);
    return res.status(500).json({ error: 'Database lookup failed' }); // Stripe retries
  }
  if (existing) {
    return res.status(200).json({ received: true, deduped: true });
  }

  // 4. Insert the new (unclaimed) LIFETIME license.
  const licenseKey = `${CONFIG.licenseKeyPrefix}${crypto.randomUUID().toUpperCase()}`;
  const { error: insertErr } = await supabase.from('licenses').insert({
    license_key: licenseKey,
    user_email: email,
    customer_name: name,
    stripe_session_id: sessionId,
    is_active: true,
    tier: CONFIG.tier, // 'lifetime'
    max_activations: CONFIG.maxActivations,
    expires_at: null, // perpetual
    // bound_machine_id stays NULL until the desktop app activates it.
  });

  if (insertErr) {
    if (insertErr.code === '23505') {
      // Unique violation — a concurrent retry already inserted it. Fine.
      return res.status(200).json({ received: true, deduped: true });
    }
    console.error('Sentinel license insert failed:', insertErr);
    return res.status(500).json({ error: 'Failed to create license' }); // Stripe retries
  }

  // 5. Email the key. Don't fail the webhook if email hiccups — license exists.
  try {
    await sendLicenseEmail({ email, name, licenseKey });
  } catch (err) {
    console.error('Sentinel onboarding email failed (license WAS created):', err);
  }

  console.log('✅ Sentinel lifetime license issued:', licenseKey, 'for', email);
  return res.status(200).json({ received: true, license_issued: true });
}

// ─── Email ───────────────────────────────────────────────────────────────────

async function sendLicenseEmail({ email, name, licenseKey }) {
  const res = await fetch(CONFIG.email.resendEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL,
      to: [email],
      subject: CONFIG.email.subject,
      html: licenseEmailHtml({ name, licenseKey }),
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend responded ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function licenseEmailHtml({ name, licenseKey }) {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi there,';
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a2730;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#0b0f14;border-radius:12px 12px 0 0;padding:28px;text-align:center;">
        <h1 style="margin:0;color:#fff;font-size:22px;">🛡️ Sentinel AI</h1>
        <p style="margin:6px 0 0;color:#00c2a8;font-size:13px;letter-spacing:1px;">YOUR LIFETIME LICENSE IS READY</p>
      </div>
      <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:32px;box-shadow:0 1px 6px rgba(0,0,0,.06);">
        <p style="font-size:15px;">${greeting}</p>
        <p style="font-size:15px;line-height:1.55;">
          Thanks for purchasing Sentinel AI. Here is your lifetime license key — paste it
          into the app on first launch to activate it on your machine. It never expires.
        </p>

        <!-- Highlighted monospace license container -->
        <div style="margin:24px 0;padding:18px;background:#0b0f14;border:1px solid #1f2d3a;border-radius:8px;text-align:center;">
          <span style="font-family:'SF Mono',Consolas,Menlo,monospace;font-size:18px;font-weight:bold;color:#00c2a8;letter-spacing:1px;word-break:break-all;">
            ${escapeHtml(licenseKey)}
          </span>
        </div>

        <p style="text-align:center;margin:28px 0;">
          <a href="${CONFIG.email.downloadUrl}"
             style="display:inline-block;background:#007acc;color:#fff;text-decoration:none;font-weight:bold;padding:13px 28px;border-radius:6px;">
            Download Sentinel
          </a>
        </p>

        <ol style="font-size:14px;color:#445;line-height:1.6;padding-left:20px;">
          <li>Download Sentinel for your operating system.</li>
          <li>Launch it and paste the license key above when prompted.</li>
          <li>It activates and locks to that machine — then runs fully offline.</li>
        </ol>

        <p style="font-size:13px;color:#8795a1;margin-top:24px;">
          Keep this email — your key is bound to one machine. Need help?
          Reply here or contact support@camlabs.ai.
        </p>
      </div>
      <p style="text-align:center;font-size:12px;color:#9aa7b2;margin-top:18px;">© CamLabs.ai · Sentinel AI</p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { registerSentinelWebhook, handleSentinelWebhook };
