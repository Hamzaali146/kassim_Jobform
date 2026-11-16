// Vercel serverless function: receives the application and emails it to HR.
// Primary: Resend (HTTPS API).  Fallback: SMTP via nodemailer (only if RESEND_API_KEY is not set).
// All secrets live ONLY in Vercel Environment Variables, never in browser code.
//
// Env vars:
//   RESEND_API_KEY  re_xxx                     (Resend dashboard -> API Keys)
//   MAIL_TO         where applications go      (testing: your own email; later: careers.kt5@kassimdenim.com)
//   MAIL_FROM       "Kassim Careers <onboarding@resend.dev>"   (testing)
//                   "Kassim Careers <careers.kt5@kassimdenim.com>" (after the domain is verified in Resend)
//   --- SMTP fallback (optional) ---
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS

const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const b = req.body || {};
    if (b.hp) return res.status(200).json({ ok: true });                 // honeypot: bots fill this, humans don't

    const f = b.fields || {};
    const name = str(f.name, 120), position = str(f.position, 160), cnic = str(f.cnic, 20);
    const email = str(f.email, 160), mobile = str(f.mobile, 40);
    const details = str(b.details, 60000);
    const pdf = str(b.pdfBase64, 4000000).replace(/^data:application\/pdf[^,]*,/, '');

    if (!name || !position || !/^\d{5}-\d{7}-\d$/.test(cnic) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !mobile || !details)
      return res.status(400).json({ ok: false, error: 'Invalid submission' });

    const { RESEND_API_KEY, MAIL_TO, MAIL_FROM, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!MAIL_TO) { console.error('MAIL_TO is not set'); return res.status(500).json({ ok: false, error: 'Server not configured' }); }

    const safeFile = name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Applicant';
    const filename = `Kassim_Job_Application_${safeFile}.pdf`;
    const subject = `Job Application: ${name} - ${position}`;
    const text = `New job application received.\n\n${details}`;
    const html = `<p><b>New job application received.</b></p>
      <p><b>${esc(name)}</b> &middot; ${esc(position)}<br>CNIC: ${esc(cnic)}<br>Mobile: ${esc(mobile)}<br>Email: ${esc(email)}</p>
      <p>The completed application form is attached as a PDF. Full details:</p>
      <pre style="font-family:inherit;white-space:pre-wrap">${esc(details)}</pre>`;

    if (RESEND_API_KEY) {
      // ---- Resend ----
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: MAIL_FROM || 'Kassim Careers <onboarding@resend.dev>',
          to: MAIL_TO.split(',').map(s => s.trim()).filter(Boolean),
          reply_to: email,
          subject, text, html,
          attachments: pdf ? [{ filename, content: pdf }] : []           // base64 string
        })
      });
      if (!r.ok) {
        console.error('Resend error', r.status, await r.text());
        return res.status(502).json({ ok: false, error: 'Could not send' });
      }
    } else if (SMTP_HOST && SMTP_USER && SMTP_PASS) {
      // ---- SMTP fallback ----
      const nodemailer = require('nodemailer');
      const port = Number(SMTP_PORT || 465);
      const transporter = nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER, pass: SMTP_PASS } });
      await transporter.sendMail({
        from: MAIL_FROM || `"Kassim Careers Portal" <${SMTP_USER}>`, to: MAIL_TO, replyTo: email, subject, text, html,
        attachments: pdf ? [{ filename, content: Buffer.from(pdf, 'base64'), contentType: 'application/pdf' }] : []
      });
    } else {
      console.error('No mail provider configured (set RESEND_API_KEY or SMTP_* variables)');
      return res.status(500).json({ ok: false, error: 'Server not configured' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('submit error:', err);
    return res.status(500).json({ ok: false, error: 'Could not send' });
  }
};
