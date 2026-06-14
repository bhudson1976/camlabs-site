// Sentinel AI · "Request latest installer" — email-gated update endpoint.
//
// Flow: POST /sentinel/request-update { email }
//   1. Validate the email shape.
//   2. Per-email cooldown (anti-abuse — stops the form spam-bombing a real customer).
//   3. Look the email up in the Supabase `licenses` customer list (service-role read).
//   4. If it's an active customer: generate TIME-LIMITED R2 presigned download URLs
//      for the latest macOS (.dmg) + Windows (.zip), and email them via Resend.
//   5. ALWAYS return the same generic 200 — never reveal whether an email is a customer.
//
// Reuses the existing stack (Supabase + Resend + R2). No third-party service.
//
// New env vars required (R2 S3-compatible API — create an "Object Read" token in
// Cloudflare → R2 → Manage R2 API Tokens):
//   R2_ENDPOINT            e.g. https://<ACCOUNT_ID>.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET              e.g. camlabs-assets
// (plus the existing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, FROM_EMAIL)

const { createClient } = require('@supabase/supabase-js');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// ─── Configuration ───────────────────────────────────────────────────────────
const CONFIG = {
  bucket: process.env.R2_BUCKET || 'camlabs-assets',
  version: 'v1.0.0-beta',
  // Object keys of the CURRENT installers — update these on each release.
  keys: {
    mac: 'installers/Sentinel-AI-v1.0.0-beta-macOS.dmg',
    win: 'installers/sentinel_desktop_win.zip',
  },
  linkTtlSeconds: 60 * 60,        // presigned links valid for 1 hour
  cooldownMs: 10 * 60 * 1000,     // one send per email per 10 minutes
  resendEndpoint: 'https://api.resend.com/emails',
  subject: 'Your Sentinel AI download links 🛡️',
};
// ─────────────────────────────────────────────────────────────────────────────

// R2 is S3-compatible; region is always 'auto'. Lazy-init so the server still boots
// if R2 creds aren't set yet (the route just won't be able to presign until they are).
let _s3 = null;
function s3() {
  if (!_s3) {
    _s3 = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

function presign(key) {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: CONFIG.bucket, Key: key }),
    { expiresIn: CONFIG.linkTtlSeconds },
  );
}

// In-memory per-email cooldown. Resets on restart — fine for a single low-volume
// instance. For multiple instances, move this to a small Supabase table or Redis.
const lastSent = new Map();

function isValidEmail(e) {
  return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function requestUpdateRoute() {
  return async (req, res) => {
    // One response for every path → callers can't enumerate who owns a license.
    const genericOk = () => res.status(200).json({ ok: true });

    try {
      const email = String((req.body && req.body.email) || '').trim().toLowerCase();
      if (!isValidEmail(email)) return genericOk();

      // Anti-abuse: silently no-op if this email was served recently.
      const now = Date.now();
      if (now - (lastSent.get(email) || 0) < CONFIG.cooldownMs) return genericOk();

      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } },
      );

      const { data: license, error } = await supabase
        .from('licenses')
        .select('user_email')
        .eq('user_email', email)
        .eq('is_active', true)
        .maybeSingle();

      if (error) {
        console.error('Update lookup failed:', error.message);
        return genericOk(); // never leak DB state to the caller
      }

      if (license) {
        lastSent.set(email, now);
        try {
          const [macUrl, winUrl] = await Promise.all([
            presign(CONFIG.keys.mac),
            presign(CONFIG.keys.win),
          ]);
          await sendUpdateEmail(email, { macUrl, winUrl });
          console.log('📦 Update links sent to verified customer:', email);
        } catch (err) {
          // Customer exists but the send/presign failed — log loudly, stay generic to the caller.
          console.error('⚠️ UPDATE EMAIL FAILED for', email, '-', err.message);
        }
      }

      return genericOk();
    } catch (err) {
      console.error('request-update error:', err.message);
      return res.status(200).json({ ok: true });
    }
  };
}

// ─── Email ───────────────────────────────────────────────────────────────────

async function sendUpdateEmail(email, { macUrl, winUrl }) {
  const r = await fetch(CONFIG.resendEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL,
      to: [email],
      subject: CONFIG.subject,
      html: updateEmailHtml({ macUrl, winUrl }),
    }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
  return r.json();
}

function updateEmailHtml({ macUrl, winUrl }) {
  const mins = Math.round(CONFIG.linkTtlSeconds / 60);
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a2730;">
    <div style="max-width:560px;margin:0 auto;padding:32px 20px;">
      <div style="background:#0b0f14;border-radius:12px 12px 0 0;padding:28px;text-align:center;">
        <h1 style="margin:0;color:#fff;font-size:22px;">🛡️ Sentinel AI</h1>
        <p style="margin:6px 0 0;color:#00c2a8;font-size:13px;letter-spacing:1px;">LATEST INSTALLER · ${CONFIG.version}</p>
      </div>
      <div style="background:#ffffff;border-radius:0 0 12px 12px;padding:32px;box-shadow:0 1px 6px rgba(0,0,0,.06);">
        <p style="font-size:15px;">Here are your secure, direct download links for the latest Sentinel AI build:</p>

        <p style="text-align:center;margin:26px 0 10px;">
          <a href="${macUrl}" style="display:inline-block;background:#007acc;color:#fff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:6px;">⬇ Download for macOS (.dmg)</a>
        </p>
        <p style="text-align:center;margin:0 0 24px;">
          <a href="${winUrl}" style="display:inline-block;background:#1f2d3a;color:#fff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:6px;">⬇ Download for Windows (.zip)</a>
        </p>

        <p style="font-size:13px;color:#8795a1;line-height:1.6;">
          🔒 These links are unique to you and expire in <strong>${mins} minutes</strong> for your security —
          just request a fresh one from the updates page if they lapse. Your existing license key still works;
          no need to re-purchase. Sentinel runs fully offline and never phones home.
        </p>
        <p style="font-size:13px;color:#8795a1;">Questions? Reply here or contact support@camlabs.ai.</p>
      </div>
      <p style="text-align:center;font-size:12px;color:#9aa7b2;margin-top:18px;">© CamLabs.ai · Sentinel AI</p>
    </div>
  </body>
</html>`;
}

module.exports = { requestUpdateRoute };
