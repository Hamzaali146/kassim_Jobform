// Vercel serverless function: receives the application and emails it to HR over SMTP.
// Credentials live ONLY in Vercel Environment Variables (never in the browser code).
const nodemailer = require('nodemailer');

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

    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_TO } = process.env;
    if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !MAIL_TO) {
      console.error('SMTP environment variables are missing');
      return res.status(500).json({ ok: false, error: 'Server not configured' });
    }
    const port = Number(SMTP_PORT || 465);

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST, port, secure: port === 465,           // 465 = SSL, 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

    const safeFile = name.replace(/[^a-zA-Z0-9_-]+/g, '_') || 'Applicant';
    await transporter.sendMail({
      from: `"Kassim Careers Portal" <${process.env.MAIL_FROM || SMTP_USER}>`,
      to: MAIL_TO,
      replyTo: email,
      subject: `Job Application: ${name} - ${position}`,
      text: `New job application received.\n\n${details}`,
      html: `<p><b>New job application received.</b></p>
             <p><b>${esc(name)}</b> &middot; ${esc(position)}<br>CNIC: ${esc(cnic)}<br>Mobile: ${esc(mobile)}<br>Email: ${esc(email)}</p>
             <p>The completed application form is attached as a PDF. Full details:</p>
             <pre style="font-family:inherit;white-space:pre-wrap">${esc(details)}</pre>`,
      attachments: pdf ? [{ filename: `Kassim_Job_Application_${safeFile}.pdf`, content: Buffer.from(pdf, 'base64'), contentType: 'application/pdf' }] : []
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('submit error:', err);
    return res.status(500).json({ ok: false, error: 'Could not send' });
  }
};