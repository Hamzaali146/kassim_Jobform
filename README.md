# Kassim Textile Pvt. Ltd. — Digital Job Application Portal
### Pure Frontend · Vercel Ready · No Backend Required

A clean, beautiful, 5-step online job application form that generates an exact replica of the official **Kassim Textile Pvt. Ltd. 4-Page Job Application PDF** in the browser and emails it to `careers.kt5@kassimdenim.com`.

---

## ✅ Features

- **5-Step Wizard Form** matching the original 4-page document
- **Live 4-Page PDF Preview** before submission (rendered right in the browser)
- **Candidate Photo Upload** placed in the "Affix Photograph" box
- **Digital Signature Canvas** (finger/stylus/mouse)
- **Auto CNIC formatting** (`XXXXX-XXXXXXX-X`)
- **Auto PDF download** for the applicant's records
- **EmailJS integration** for sending the form data to `careers.kt5@kassimdenim.com`
- **mailto: fallback** pre-filled with all candidate info if email auto-send fails
- **100% frontend** — deploy on Vercel with zero configuration

---

## 🚀 Deploy to Vercel (1-Click)

1. Push this folder to a **GitHub repository**
2. Go to [vercel.com](https://vercel.com) → **New Project** → Import your repo
3. Framework: **Other** (or Static)
4. Root directory: leave default (`./`)
5. Click **Deploy** — done!

---

## 📧 Enable Automatic Email Sending (Free)

The form uses **[EmailJS](https://emailjs.com)** to send emails directly from the browser — no server needed.

### Setup Steps (5 minutes, free tier = 200 emails/month):

1. **Sign up** at [emailjs.com](https://emailjs.com)

2. **Add Email Service:**
   - Go to *Email Services* → *Add New Service*
   - Connect your Gmail / Outlook / SMTP account
   - Note your **Service ID** (e.g. `service_abc123`)

3. **Create Email Template:**
   - Go to *Email Templates* → *Create New Template*
   - Set **To Email**: `careers.kt5@kassimdenim.com`
   - Set **Reply To**: `{{reply_to}}`
   - Set **Subject**: `Job Application: {{applicant_name}} — {{position}} (CNIC: {{cnic}})`
   - Template body — use these variables:
     ```
     New Job Application Received
     
     Name: {{applicant_name}}
     Father: {{father_name}}
     Position Applied: {{position}}
     CNIC #: {{cnic}}
     Email: {{email}}
     Mobile: {{mobile}}
     Address: {{present_address}}
     Expected Salary: {{expected_salary}}
     Availability: {{availability}}
     Source: {{source}}
     Submission Date: {{submission_date}}
     
     NOTE: The applicant's completed 4-page PDF is auto-downloaded 
     to their device — they can attach it to a reply email.
     ```
   - Note your **Template ID** (e.g. `template_xyz789`)

4. **Get your Public Key:**
   - Go to *Account* → copy your **Public Key**

5. **Update `js/app.js`** (top of the file):
   ```js
   const EMAILJS_PUBLIC_KEY  = 'your_public_key_here';
   const EMAILJS_SERVICE_ID  = 'service_abc123';
   const EMAILJS_TEMPLATE_ID = 'template_xyz789';
   ```

6. **Redeploy** to Vercel — email sending is now live!

> **Without EmailJS configured:** The form still works — it auto-downloads the PDF to the applicant's device and opens a pre-filled email client window to `careers.kt5@kassimdenim.com`.

---

## 📁 File Structure

```
HR FORM DIGITIZATION/
├── index.html                  ← Main application (open this directly!)
├── vercel.json                 ← Vercel deployment config
├── README.md
├── assets/
│   └── logo.png               ← Kassim Denim logo
└── js/
    ├── app.js                 ← Form logic, PDF generator, EmailJS sender
    ├── logo.js                ← Logo embedded as Base64
    ├── jspdf.umd.min.js       ← PDF library (offline)
    ├── jspdf.plugin.autotable.min.js
    └── signature_pad.umd.min.js
```

---

## 🖥 Run Locally (No Install Needed)

Just double-click **`index.html`** in Windows Explorer — opens directly in your browser!

---

## 📄 PDF Format (4 Pages)

The generated PDF exactly matches the original `Job Application -.pdf`:

| Page | Content |
|------|---------|
| 1 | Personal Info, Photo, CNIC, Addresses, Emergency Contacts |
| 2 | Section I — Educational Qualifications & Family Details |
| 3 | Section II — Work Experience & Compensation Details |
| 4 | Section III — Health, References, Relatives, Signature & Declaration |
