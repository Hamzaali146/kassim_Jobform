// ══════════════════════════════════════════════════════════════════
// KASSIM TEXTILE PVT. LTD. — JOB APPLICATION PORTAL
// Candidate flow:  fill form  →  Submit  →  "Thank you" screen
// (no preview, no download, HR email never shown to the candidate)
// ══════════════════════════════════════════════════════════════════

// Submissions are POSTed to the Vercel serverless function in /api/submit.js,
// which emails them (with the PDF attached) to HR over SMTP.
const SUBMIT_ENDPOINT = '/api/submit';

let sigPad = null;
let photoB64 = null;      // JPEG data-URL (resized)
let photoDim = null;      // {w,h}
let currentStep = 1;
let submitting = false;

// ══════════════════════════════════════════════════════════════════
// PDF BUILDER — exact replica of the official Word form (Letter, pt)
// ══════════════════════════════════════════════════════════════════
function buildPdf(d, JsPDF) {
  const doc = new JsPDF({ unit: 'pt', format: 'letter', compress: true });
  const INK = [15, 23, 120];        // colour of the applicant's filled-in text
  const ORG = [227, 108, 9];        // orange headings
  const FILL = [250, 192, 144];     // table header orange

  /* ---------- helpers ---------- */
  const clean = s => String(s == null ? '' : s)
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7E\u00A0-\u00FF\n]/g, '?').trim();
  const set = (f, st, sz, col) => { doc.setFont(f, st); doc.setFontSize(sz); doc.setTextColor(col[0], col[1], col[2]); };
  const tw = (s, f, st, sz) => { doc.setFont(f, st); doc.setFontSize(sz); return doc.getTextWidth(s); };
  // y = visual centre line of the text
  function T(s, x, y, o) {
    o = o || {}; const sz = o.size || 8.5;
    set(o.font || 'helvetica', o.style || 'normal', sz, o.color || [0, 0, 0]);
    doc.text(String(s), x, y + sz * 0.34, { align: o.align || 'left' });
  }
  // filled-in value, shrinks to fit maxW
  function V(s, x, y, maxW, o) {
    o = o || {}; s = clean(s); if (!s) return;
    const f = o.font || 'helvetica', st = o.style || 'normal'; let sz = o.size || 8.5;
    while (sz > 5 && tw(s, f, st, sz) > maxW) sz -= 0.5;
    T(s, x, y, { size: sz, font: f, style: st, color: INK, align: o.align });
  }
  const L = (x1, y1, x2, y2, w) => { doc.setDrawColor(0); doc.setLineWidth(w || 0.5); doc.line(x1, y1, x2, y2); };
  const R = (x, y, w, h, fill, lw) => {
    doc.setDrawColor(0); doc.setLineWidth(lw || 0.6);
    if (fill) { doc.setFillColor(fill[0], fill[1], fill[2]); doc.rect(x, y, w, h, 'FD'); } else doc.rect(x, y, w, h, 'S');
  };
  const frame = () => { doc.setDrawColor(192, 0, 0); doc.setLineWidth(1.2); doc.rect(50, 24, 539, 731, 'S'); doc.setDrawColor(0); doc.setLineWidth(0.6); };

  // inline flow: labels, blanks (with values), circled options
  function flow(x, y, parts, o) {
    o = o || {}; const sz = o.size || 8.5;
    parts.forEach(p => {
      if (p.t !== undefined) {
        const st = p.b === false ? 'normal' : 'bold';
        T(p.t, x, y, { size: sz, style: st });
        x += tw(p.t, 'helvetica', st, sz) + (p.gap !== undefined ? p.gap : 3);
      } else if (p.blank !== undefined) {
        L(x, y + 4, x + p.blank, y + 4, 0.5);
        if (p.v) { if (p.left) V(p.v, x + 3, y - 1.4, p.blank - 6, { size: sz }); else V(p.v, x + p.blank / 2, y - 1.4, p.blank - 3, { size: sz, align: 'center' }); }
        x += p.blank + (p.gap !== undefined ? p.gap : 6);
      } else if (p.opts) {
        const st = p.bold ? 'bold' : 'normal', sep = ' / '; x += 3;
        p.opts.forEach((op, i) => {
          const w = tw(op, 'helvetica', st, sz);
          T(op, x, y, { size: sz, style: st });
          if (p.sel === op) { doc.setDrawColor(INK[0], INK[1], INK[2]); doc.setLineWidth(0.9); doc.ellipse(x + w / 2, y, w / 2 + 2.6, sz * 0.74, 'S'); doc.setDrawColor(0); }
          x += w;
          if (i < p.opts.length - 1) { T(sep, x, y, { size: sz, style: st }); x += tw(sep, 'helvetica', st, sz); }
        });
        x += (p.gap !== undefined ? p.gap : 6);
      }
    });
    return x;
  }
  // table cell with wrapped, auto-shrinking text
  function cell(x, y, w, h, txt, o) {
    o = o || {};
    R(x, y, w, h, o.fill);
    txt = clean(txt); if (!txt) return;
    const f = o.font || 'helvetica', st = o.style || 'normal', col = o.color || [0, 0, 0];
    let sz = o.size || 7, lines;
    for (;;) {
      set(f, st, sz, col); lines = doc.splitTextToSize(txt, w - 6);
      if (lines.length * sz * 1.15 <= h - 3 || sz <= 5) break; sz -= 0.5;
    }
    const lh = sz * 1.15, top = o.valign === 'top' ? y + 3 : y + (h - lines.length * lh) / 2;
    lines.forEach((ln, i) => {
      const yy = top + i * lh + sz * 0.82;
      if (o.align === 'center') doc.text(ln, x + w / 2, yy, { align: 'center' }); else doc.text(ln, x + 3, yy);
    });
  }
  // multi-line free text that shrinks to fit a box
  function para(txt, x, y, w, maxLines, sz, lhK) {
    txt = clean(txt); if (!txt) return;
    let lines; sz = sz || 8.5;
    for (;;) { set('helvetica', 'normal', sz, INK); lines = doc.splitTextToSize(txt, w); if (lines.length <= maxLines || sz <= 5.5) break; sz -= 0.5; }
    lines.slice(0, maxLines).forEach((ln, i) => doc.text(ln, x, y + i * sz * (lhK || 1.25) + sz * 0.8));
  }
  const fit = (s, f, st, target, max) => { const w = tw(s, f, st, 10); return Math.min(max || 99, 10 * target / w); };

  /* =================== PAGE 1 =================== */
  frame();
  let sz = fit('Kassim Textile Pvt. Ltd.', 'times', 'bold', 327, 28);
  T('Kassim Textile Pvt. Ltd.', 58, 63, { font: 'times', style: 'bold', size: sz });
  sz = fit('JOB APPLICATION FORM', 'times', 'bold', 238, 15);
  T('JOB APPLICATION FORM', 58, 101, { font: 'times', style: 'bold', size: sz });

  R(489, 29, 96, 94, null, 0.6);                       // photo box
  if (d.photo && d.photo.dataUrl) {
    const bw = 92, bh = 90, r = Math.min(bw / d.photo.w, bh / d.photo.h), iw = d.photo.w * r, ih = d.photo.h * r;
    doc.addImage(d.photo.dataUrl, 'JPEG', 489 + (96 - iw) / 2, 29 + (94 - ih) / 2, iw, ih);
  } else {
    T('Affix Photograph', 537, 70, { font: 'times', size: 7.2, align: 'center' });
    T('of the Candidate', 537, 80, { font: 'times', size: 7.2, align: 'center' });
  }

  R(59, 133, 526, 131, null, 0.6);                     // intro box
  T('Please fill in this application form accurately.', 66, 144, { font: 'times', size: 10 });
  T('Incomplete forms may lead to disqualification from our selection process', 66, 158, { font: 'times', size: 10 });
  const fullName = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ');
  T('Name:', 66, 180, { style: 'bold' });               L(245, 184, 569, 184); V(fullName, 248, 178.5, 318);
  T('Father Name:', 66, 201, { style: 'bold', size: 8 }); L(245, 205, 561, 205); V(d.fatherName, 248, 199.5, 310);
  T('Position Applied for:', 66, 221, { style: 'bold' }); L(245, 225, 561, 225); V(d.position, 248, 219.5, 310);
  T('You have come to us through', 66, 241, { style: 'bold', size: 7.5 });
  const srcOpts = ['Employee Referral', 'Advertisement', 'Direct', 'Job Sites', 'Others'];
  const selSrc = srcOpts.find(o => (d.source || '').indexOf(o) === 0) || '';
  flow(245, 241, [{ opts: srcOpts, sel: selSrc, bold: true }], { size: 7.5 });
  T('(Please specify details)', 66, 254, { style: 'bold', size: 7.5 }); L(170, 258, 569, 258); V(d.sourceDetails, 173, 252.5, 392, { size: 8 });

  const o = 2;                                         // main box offset
  R(59, 265 + o, 526, 481 - o + 0, null, 0.6);

  // name character boxes
  const NC = 36, cw = 513 / NC, ny = 282;
  for (let i = 0; i < NC; i++) R(59 + i * cw, ny, cw, 15, null, 0.5);
  const up = s => clean(s).toUpperCase();
  const F = up(d.firstName).slice(0, NC), M = up(d.middleName), Ln = up(d.lastName);
  const mStart = Math.max(F.length + 1, 12), lStart = Math.max(mStart + M.length + 1, NC - Ln.length);
  const put = (str, start) => str.split('').forEach((ch, i) => { if (start + i < NC) T(ch, 59 + (start + i) * cw + cw / 2, ny + 7.5, { size: 9, style: 'bold', color: INK, align: 'center' }); });
  put(F, 0); put(M, mStart); put(Ln, lStart);
  T('First Name', 66, 307, { style: 'bold' });
  T('Middle Name', 348, 307, { style: 'bold', align: 'center' });
  T('Last Name', 551, 307, { style: 'bold', align: 'right' });

  flow(66, 329 + o, [
    { t: 'Gender' }, { opts: ['M', 'F'], sel: d.gender, gap: 8 },
    { t: 'Age' }, { blank: 24, v: d.age, gap: 1 }, { t: 'Years', b: false, gap: 8 },
    { t: 'Date of Birth' }, { blank: 58, v: d.dob, gap: 8 },
    { t: 'Place of Birth' }, { blank: 62, v: d.placeOfBirth, gap: 6 }, { t: 'Citizenship' }
  ], { size: 8.2 });
  flow(66, 352 + o, [
    { blank: 92, v: d.citizenship, gap: 4 }, { t: 'Religion', gap: 1 }, { blank: 92, v: d.religion, gap: 22 },
    { t: 'Married:' }, { opts: ['Yes', 'NO'], sel: d.married ? 'Yes' : 'NO', gap: 14 },
    { t: 'Blood Group' }, { blank: 66, v: d.blood, gap: 0 }
  ], { size: 8.2 });

  // CNIC
  const cy = 368 + o;
  R(59, cy, 65, 15, null, 0.6); T('CNIC #', 91.5, cy + 7.5, { style: 'bold', align: 'center' });
  const digits = (d.cnic || '').replace(/\D/g, ''); let di = 0;
  for (let i = 0; i < 15; i++) {
    R(124 + i * 14.5, cy, 14.5, 15, null, 0.6);
    if (i === 5 || i === 13) T('-', 124 + i * 14.5 + 7.25, cy + 7.5, { style: 'bold', align: 'center' });
    else if (digits[di]) { T(digits[di], 124 + i * 14.5 + 7.25, cy + 7.5, { style: 'bold', color: INK, align: 'center', size: 9 }); di++; } else di++;
  }

  T('Mailing Address:', 322, 400 + o, { style: 'bold', size: 12, color: ORG, align: 'center' });
  T('Present Address:', 66, 415 + o, { style: 'bold', size: 8.5, color: ORG });
  const addrBox = (txt, y, rows, rh, w) => {
    R(59, y, w, rows * rh, null, 0.6);
    for (let i = 1; i < rows; i++) L(59, y + i * rh, 59 + w, y + i * rh, 0.6);
    txt = clean(txt); if (!txt) return;
    let s = 8.5, lines;
    for (;;) { set('helvetica', 'normal', s, INK); lines = doc.splitTextToSize(txt.replace(/\s*\n\s*/g, ', '), w - 10); if (lines.length <= rows || s <= 5.5) break; s -= 0.5; }
    lines.slice(0, rows).forEach((ln, i) => T(ln, 65, y + i * rh + rh / 2, { size: s, color: INK }));
  };
  addrBox(d.presentAddr, 422 + o - 2, 4, 15.5, 518);
  R(60, 508 + o - 2, 518, 17, null, 0.6); R(60, 508 + o - 2, 87, 17, null, 0.6);
  T('Email Address', 66, 516.5 + o - 2, { style: 'bold', size: 8 }); V(d.email, 152, 516.5 + o - 2, 420, { size: 8.5 });
  T('Permanent Address (if different than above please specify)', 66, 532 + o - 2, { style: 'bold', size: 8, color: ORG });
  addrBox(d.permAddr, 544 + o - 2, 4, 13.5, 518);

  // phone icon + tele-connect heading
  doc.setFillColor(102, 51, 153); doc.roundedRect(116, 607, 9, 14, 1.5, 1.5, 'F');
  doc.setFillColor(210, 190, 235); doc.rect(118, 609, 5, 5, 'F');
  doc.setDrawColor(102, 51, 153); doc.setLineWidth(0.8); doc.line(124, 607, 128, 602); doc.setDrawColor(0);
  T('Please use this space to give us your complete tele-connect details', 140, 617, { style: 'bold', size: 10, color: ORG });
  T(':', 140 + tw('Please use this space to give us your complete tele-connect details', 'helvetica', 'bold', 10) + 1, 617, { size: 10 });

  flow(66, 644, [{ t: 'Mobile Number Current:' }, { blank: 108, v: d.mobile, gap: 6 }, { t: 'Present Residence Telephone No.' }, { blank: 104, v: d.resTel }], { size: 8.5 });
  flow(66, 667, [{ t: 'Permanent Residence Telephone No.: (With City Code)' }, { blank: 574 - 66 - tw('Permanent Residence Telephone No.: (With City Code)', 'helvetica', 'bold', 8.5) - 5, v: d.permTel, left: true }], { size: 8.5 });
  T('Emergency Contact Number \u2013 whom can we call in case of an emergency.'.replace('\u2013', '-'), 322, 691, { style: 'bold', size: 10, color: ORG, align: 'center' });
  [[d.em1Name, d.em1Rel, d.em1Tel, 715], [d.em2Name, d.em2Rel, d.em2Tel, 738]].forEach(e =>
    flow(66, e[3], [{ t: 'Name' }, { blank: 96, v: e[0], gap: 8 }, { t: 'Relationship', gap: 1 }, { blank: 92, v: e[1], gap: 8 }, { t: 'Contact' }, { blank: 84, v: e[2] }], { size: 8.5 }));

  /* =================== PAGE 2 =================== */
  doc.addPage(); frame();
  T('Section I', 58, 54, { style: 'bold', size: 9.5 });
  T('A.   Tell us about your Educational Qualification: Please use the space below to highlight', 66, 80, { style: 'bold', size: 9.5 });
  T('your educational background.', 67, 93, { style: 'bold', size: 9.5 });

  const ex = [66, 156, 246, 427, 481, 581];
  const eh = ['Educational Degree', 'Year of Completion / mention if pursuing', 'Name of the Institute', 'Grade/ %', 'Favorite Subject'];
  eh.forEach((h, i) => cell(ex[i], 114, ex[i + 1] - ex[i], 48, h, { fill: FILL, align: 'center', size: 8 }));
  const edu = d.edu || [], en = Math.max(5, edu.length), erh = Math.min(48.7, 262 / en);
  for (let r = 0; r < en; r++) for (let c = 0; c < 5; c++)
    cell(ex[c], 162 + r * erh, ex[c + 1] - ex[c], erh, edu[r] ? edu[r][c] : '', { color: INK, size: 7.5 });
  L(58, 428, 584, 428, 0.6); L(58, 432, 580, 432, 0.6);

  T('B.   Tell us about your family:', 66, 497, { style: 'bold', size: 9.5 });
  const fx = [66, 143, 250, 317, 407, 491, 581];
  ['Relation', 'Name', 'Mention if Dependent', 'Profession', 'Office Name & Address', 'Contact'].forEach((h, i) =>
    cell(fx[i], 528, fx[i + 1] - fx[i], 22, h, { fill: FILL, align: 'center', size: 7 }));
  const fam = d.family || [], pick = re => fam.filter(f => re.test(f[0] || ''));
  const sp = pick(/^(spouse|wife|husband)/i)[0], fa = pick(/^father/i)[0], mo = pick(/^mother/i)[0];
  const kids = fam.filter(f => !/^(spouse|wife|husband|father|mother)/i.test(f[0] || '') && f.slice(1).some(Boolean));
  const frows = [['Spouse', sp], ['Father', fa], ['Mother', mo], ['Children', null]];
  const kn = Math.max(3, kids.length), krh = Math.min(24, 98 / kn);
  frows.forEach((fr, r) => {
    const y = 550 + r * 23.5, row = fr[1];
    for (let c = 0; c < 6; c++) {
      const v = c === 0 ? fr[0] : (row ? row[c] : '');
      cell(fx[c], y, fx[c + 1] - fx[c], 23.5, v, { color: c === 0 ? [0, 0, 0] : INK, size: 7 });
    }
  });
  const ky = 550 + 4 * 23.5;
  for (let r = 0; r < kn; r++) {
    const k = kids[r], y = ky + r * krh;
    const label = k && !/^child/i.test(k[0] || '') && k[0] ? k[0] : String(r + 1);
    cell(fx[0], y, fx[1] - fx[0], krh, label, { size: 7 });
    for (let c = 1; c < 4; c++) cell(fx[c], y, fx[c + 1] - fx[c], krh, k ? k[c] : '', { color: INK, size: 7 });
  }
  R(fx[4], ky, fx[6] - fx[4], kn * krh, FILL, 0.6);
  kids.forEach((k, r) => { if (k[4] || k[5]) V([k[4], k[5]].filter(Boolean).join(' / '), fx[4] + 4, ky + r * krh + krh / 2, fx[6] - fx[4] - 8, { size: 7 }); });

  /* =================== PAGE 3 =================== */
  doc.addPage(); frame();
  T('Section II', 58, 37, { style: 'bold', size: 9.5 });
  T('A. Share with us your Work Experience ......................', 58, 62, { size: 8 });
  flow(68, 76, [{ t: 'Have you worked earlier?' }, { opts: ['Yes', 'No'], sel: d.worked ? 'Yes' : 'No', bold: true }, { t: '(If no then move on to the next section)', gap: 0 }], { size: 8 });

  const wx = [59, 143, 191, 241, 286, 336, 380, 426, 508, 581];
  cell(wx[0], 94, wx[1] - wx[0], 45, "Employer's Name & Location", { fill: FILL, align: 'center', size: 7.5 });
  cell(wx[1], 94, wx[3] - wx[1], 22, 'Salary', { fill: FILL, align: 'center', size: 7.5 });
  cell(wx[3], 94, wx[5] - wx[3], 22, 'Designation', { fill: FILL, align: 'center', size: 7.5 });
  cell(wx[5], 94, wx[7] - wx[5], 22, 'Period Worked', { fill: FILL, align: 'center', size: 7.5 });
  cell(wx[7], 94, wx[8] - wx[7], 45, 'Functions', { fill: FILL, align: 'center', size: 7.5 });
  cell(wx[8], 94, wx[9] - wx[8], 45, 'Reason for Leaving', { fill: FILL, align: 'center', size: 7.5 });
  ['Start', 'Leaving', 'Start', 'Leaving', 'From', 'To'].forEach((h, i) => cell(wx[i + 1], 116, wx[i + 2] - wx[i + 1], 23, h, { fill: FILL, align: 'center', size: 7.5 }));
  const ew = d.worked ? (d.exp || []) : [], xn = Math.max(4, ew.length), xrh = Math.min(42, 180 / xn);
  for (let r = 0; r < xn; r++) {
    const row = ew[r] || [], order = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    order.forEach(c => cell(wx[c], 139 + r * xrh, wx[c + 1] - wx[c], xrh, row[c], { color: INK, size: 6.8 }));
  }
  T('Add extra sheets if needed.', 59, 318, { style: 'bolditalic', size: 6, color: [255, 0, 0] });
  L(58, 334, 584, 334, 0.6); L(58, 353, 580, 353, 0.6);

  R(61, 374, 251, 267, null, 0.7); R(319, 374, 262, 267, null, 0.7);
  T('Organization Structure of your Current Role (Including', 66, 384, { style: 'bold', size: 6.5 });
  T('reporting relationships', 66, 392, { style: 'bold', size: 6.5 });
  T('Present Job Responsibility:', 326, 384, { font: 'times', style: 'bold', size: 9 });
  if (d.worked) {
    para(d.orgStr, 66, 407, 240, 26, 8, 1.3);
    para(d.jobResp, 326, 399, 250, 27, 8, 1.3);
  }
  T('B.', 58, 661, { size: 10 }); T('Compensation Details.', 74, 661, { style: 'bold', size: 10 });
  flow(58, 694, [{ t: 'Expected salary :' }, { blank: 100, v: d.expSalary, gap: 14 }, { t: 'Others Benefits :' }, { blank: 574 - 58 - 190 - tw('Others Benefits :', 'helvetica', 'bold', 9.5), v: d.otherBenefits, left: true }], { size: 9.5 });
  flow(58, 716, [{ t: 'Availability:' }, { blank: 574 - 58 - tw('Availability:', 'helvetica', 'bold', 9.5) - 5, v: d.availability, left: true }], { size: 9.5 });

  /* =================== PAGE 4 =================== */
  doc.addPage(); frame();
  T('Section III', 58, 37, { style: 'bold', size: 9.5 });
  T('Do you have any disease and have you been hospitalization in the last one year?', 58, 65, { size: 8.5 });
  L(58, 91, 552, 91, 0.5); V(d.disease === 'Yes' ? 'Yes - ' + d.diseaseDetails : 'No', 62, 86.5, 486, { size: 8.5 });
  T('Have you applied to any one of our Units before? Y/N, If Yes, Please specify when', 58, 107, { size: 8.5 });
  L(58, 126, 574, 126, 0.5); V(d.applied === 'Yes' ? 'Yes - ' + d.appliedDetails : 'No', 62, 121.5, 508, { size: 8.5 });
  T('References', 58, 148, { style: 'bold', size: 9 });

  const gx = [66, 98, 258, 352, 456, 582];
  function listTable(y0, heads, rows, minRows) {
    heads.forEach((h, i) => cell(gx[i], y0, gx[i + 1] - gx[i], 24, h, { fill: FILL, align: 'center', size: i === 0 ? 7 : 8.5 }));
    const n = Math.max(minRows, rows.length), rh = Math.min(29, 58 / n);
    for (let r = 0; r < n; r++) for (let c = 0; c < 5; c++)
      cell(gx[c], y0 + 24 + r * rh, gx[c + 1] - gx[c], rh, c === 0 ? (rows[r] ? String(r + 1) : '') : (rows[r] ? rows[r][c - 1] : ''), { color: INK, size: 7.5, align: c === 0 ? 'center' : 'left' });
  }
  listTable(170, ['S. No', 'Name', 'Relationship', 'Contact Number', 'Title / Company'], d.refs || [], 2);

  flow(58, 272, [{ t: 'Do you have any relatives working with any Rainbow units?' }, { opts: ['Yes', 'No'], sel: d.hasRel ? 'Yes' : 'No', bold: true }, { t: '(If Yes Please provide', gap: 0 }], { size: 8.5 });
  flow(58, 286, [{ t: 'detail)' }, { blank: 100, v: d.hasRel ? 'See below' : '', gap: 4 }, { t: '(Mandatory field)', gap: 0 }], { size: 8.5 });
  listTable(307, ['S. No', 'Name', 'Designation', 'Dept', 'Relationship'], d.hasRel ? (d.rels || []) : [], 2);

  T('I hereby confirm that all information, I have provided is true, complete, and accurate to the best of', 58, 406, { size: 8.5 });
  T('my knowledge and I take full responsibility for its correctness.', 58, 420, { size: 8.5 });

  if (d.signature && d.signature.dataUrl) {
    const r = Math.min(150 / d.signature.w, 40 / d.signature.h);
    doc.addImage(d.signature.dataUrl, 'PNG', 62, 496 - d.signature.h * r, d.signature.w * r, d.signature.h * r);
  }
  L(58, 496, 202, 496, 0.5); L(416, 496, 545, 496, 0.5);
  V(d.sigDate, 480, 491, 120, { size: 8.5, align: 'center' });
  T('Signature of the candidate', 58, 502, { size: 7.5 }); T('Date', 480, 502, { size: 7.5, align: 'center' });
  doc.setLineDashPattern([2, 2], 0); L(58, 512, 582, 512, 0.5); doc.setLineDashPattern([], 0);

  R(58, 520, 524, 213, null, 0.7);
  T('For office use only:', 66, 530, { font: 'times', style: 'bold', size: 10 });
  [['Status', 553], ['Date of Joining', 577], ['Designation', 600], ['Reporting Manager', 623], ['Approved Salary', 646], ['Other Benefits', 692], ['Remarks', 715]].forEach(a => {
    T(a[0], 66, a[1], { font: 'times', style: 'bold', size: 6.8 }); T(':', 158, a[1], { font: 'times', style: 'bold', size: 6.8 });
  });
  [582, 605, 628, 650].forEach(y => L(194, y, 308, y, 0.4));
  L(194, 697, 533, 697, 0.4); L(194, 720, 536, 720, 0.4);
  [[198, 58, [146, 208, 80], 'Hire'], [262, 66, [255, 255, 0], 'Shortlist'], [341, 80, [255, 124, 128], 'Not suitable']].forEach(b => {
    R(b[0], 536, b[1], 26, b[2], 0.6); T(b[3], b[0] + b[1] / 2, 549, { font: 'times', size: 8, align: 'center' });
  });
  R(350, 578, 206, 95, null, 0.7);
  T('Approved By CEO/Director/GM/HR', 366, 592, { font: 'times', size: 8 }); L(366, 599, 546, 599, 0.6);

  doc.setProperties({ title: 'Job Application - ' + fullName, subject: 'Kassim Textile Pvt. Ltd. Job Application Form', author: fullName });
  return doc;
}


// ══════════════════════════════════════════════════════════════════
// UI LOGIC
// ══════════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', () => {
  initSignaturePad();
  const t = new Date(), pad = n => String(n).padStart(2, '0');
  $('sigDate').value = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
});

// ── SIGNATURE PAD ────────────────────────────────────────────────────
function resizeSig() {
  const canvas = $('sigCanvas');
  if (!canvas || !sigPad) return;
  const dpr = Math.max(window.devicePixelRatio || 1, 1);
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  if (canvas.width === Math.round(rect.width * dpr)) return;
  const data = !sigPad.isEmpty() ? sigPad.toData() : null;
  canvas.width = rect.width * dpr; canvas.height = 120 * dpr;
  canvas.getContext('2d').scale(dpr, dpr);
  sigPad.clear();
  if (data) sigPad.fromData(data);
}
function initSignaturePad() {
  const canvas = $('sigCanvas'); if (!canvas) return;
  sigPad = new SignaturePad(canvas, { backgroundColor: 'rgba(0,0,0,0)', penColor: 'rgb(15,23,120)', minWidth: 1.2, maxWidth: 2.8 });
  window.addEventListener('resize', resizeSig);
  setTimeout(resizeSig, 100);
}
function clearSig() { sigPad && sigPad.clear(); }

// ── PHOTO ────────────────────────────────────────────────────────────
function handlePhoto(input) {
  const file = input.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert('Photo must be < 5MB'); return; }
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 420 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
      photoB64 = c.toDataURL('image/jpeg', 0.85); photoDim = { w: c.width, h: c.height };
      $('photoPreview').src = photoB64; $('photoPreview').style.display = 'block';
      $('photoPlaceholder').style.display = 'none'; $('photoRemove').style.display = 'block';
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function removePhoto() {
  photoB64 = null; photoDim = null; $('photoInput').value = '';
  $('photoPreview').style.display = 'none'; $('photoPlaceholder').style.display = 'flex'; $('photoRemove').style.display = 'none';
}

// ── CNIC / AGE ───────────────────────────────────────────────────────
function fmtCnic(el) {
  let v = el.value.replace(/\D/g, '').slice(0, 13);
  if (v.length > 12) v = v.slice(0,5)+'-'+v.slice(5,12)+'-'+v.slice(12);
  else if (v.length > 5) v = v.slice(0,5)+'-'+v.slice(5);
  el.value = v;
}
function calcAge() {
  const dob = new Date($('dob').value); if (isNaN(dob)) return;
  let age = new Date().getFullYear() - dob.getFullYear();
  const m = new Date().getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && new Date().getDate() < dob.getDate())) age--;
  $('age').value = age >= 0 ? age : '';
}

// ── HELPERS ──────────────────────────────────────────────────────────
function toggleBox(id, show) { $(id).classList.toggle('hidden', !show); }
function toggleExp(show) { $('expTableWrap').style.opacity = show ? '1' : '0.4'; $('expTableWrap').style.pointerEvents = show ? 'auto' : 'none'; }
function toggleRelatives(show) { $('relWrap').classList.toggle('hidden', !show); }
function renumber(bodyId) { document.querySelectorAll(`#${bodyId} tr`).forEach((tr, i) => { tr.cells[0].textContent = i + 1; }); }
function delRow(btn) {
  const tb = btn.closest('tbody');
  if (tb.rows.length > 1) { btn.closest('tr').remove(); if (tb.id === 'refBody' || tb.id === 'relBody') renumber(tb.id); }
  else alert('At least one row is required.');
}
const DEL_BTN = '<button class="btn-del" onclick="delRow(this)"><i class="fa-solid fa-trash"></i></button>';
function addEduRow() { $('eduBody').insertAdjacentHTML('beforeend', `<tr><td><input type="text" placeholder="Degree"></td><td><input type="text" placeholder="Year"></td><td><input type="text" placeholder="Institute"></td><td><input type="text" placeholder="Grade / %"></td><td><input type="text" placeholder="Subject"></td><td>${DEL_BTN}</td></tr>`); }
function addFamRow() { $('famBody').insertAdjacentHTML('beforeend', `<tr><td><input type="text" value="Child" placeholder="Relation"></td><td><input type="text" placeholder="Name"></td><td><select style="min-width:70px"><option>Yes</option><option>No</option></select></td><td><input type="text" placeholder="Profession"></td><td><input type="text" placeholder="Office"></td><td><input type="tel" placeholder="Phone"></td><td>${DEL_BTN}</td></tr>`); }
function addExpRow() { $('expBody').insertAdjacentHTML('beforeend', `<tr><td><input type="text" placeholder="Company & City" style="min-width:120px"></td><td><input type="text" placeholder="Start PKR"></td><td><input type="text" placeholder="Last PKR"></td><td><input type="text" placeholder="Initial Title"></td><td><input type="text" placeholder="Last Title"></td><td><input type="text" placeholder="MM/YYYY"></td><td><input type="text" placeholder="MM/YYYY"></td><td><textarea placeholder="Key functions" style="min-width:140px"></textarea></td><td><input type="text" placeholder="Reason" style="min-width:90px"></td><td>${DEL_BTN}</td></tr>`); }
function addRefRow() { const n = $('refBody').rows.length + 1; $('refBody').insertAdjacentHTML('beforeend', `<tr><td style="text-align:center;font-weight:700">${n}</td><td><input type="text" placeholder="Full Name"></td><td><input type="text" placeholder="Relationship"></td><td><input type="tel" placeholder="Contact"></td><td><input type="text" placeholder="Title / Company"></td><td>${DEL_BTN}</td></tr>`); }
function addRelRow() { const n = $('relBody').rows.length + 1; $('relBody').insertAdjacentHTML('beforeend', `<tr><td style="text-align:center;font-weight:700">${n}</td><td><input type="text" placeholder="Name"></td><td><input type="text" placeholder="Designation"></td><td><input type="text" placeholder="Dept"></td><td><input type="text" placeholder="Relationship"></td><td>${DEL_BTN}</td></tr>`); }

// ── WIZARD (4 steps) ─────────────────────────────────────────────────
function goTo(n) {
  document.querySelectorAll('.step-panel').forEach(p => p.classList.remove('active'));
  $(`step${n}`).classList.add('active');
  for (let i = 1; i <= 4; i++) {
    const ws = $(`ws${i}`), wc = $(`wc${i}`);
    ws.classList.remove('active', 'done');
    if (i === n) { ws.classList.add('active'); wc.innerHTML = i; }
    else if (i < n) { ws.classList.add('done'); wc.innerHTML = '<i class="fa-solid fa-check" style="font-size:11px"></i>'; }
    else wc.innerHTML = i;
  }
  $('wizardTrack').style.width = `calc((100% - 72px) * ${(n - 1) / 3})`;
  currentStep = n;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (n === 4) setTimeout(resizeSig, 50);
}

// ── VALIDATION ───────────────────────────────────────────────────────
const REQUIRED = {
  1: [['firstName','First Name'],['lastName','Last Name'],['fatherName',"Father's Name"],['position','Position Applied For'],
      ['source','Source (how you found us)'],['dob','Date of Birth'],['cnic','CNIC #'],['presentAddr','Present Address'],
      ['email','Email Address'],['mobile','Mobile Number'],['em1Name','Emergency Contact Name'],
      ['em1Rel','Emergency Relationship'],['em1Tel','Emergency Contact Number']],
  3: [['expSalary','Expected Salary'],['availability','Availability / Notice Period']]
};
// returns true if the step is OK; otherwise jumps to it and tells the candidate
function validateStep(n) {
  for (const [id, label] of (REQUIRED[n] || [])) {
    const el = $(id);
    if (!el || !el.value.trim()) { goTo(n); alert(`Please fill in: ${label}`); el && el.focus(); return false; }
  }
  if (n === 1) {
    if (!/^\d{5}-\d{7}-\d$/.test($('cnic').value)) { goTo(1); alert('CNIC must be in the format XXXXX-XXXXXXX-X'); $('cnic').focus(); return false; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test($('email').value)) { goTo(1); alert('Please enter a valid email address'); $('email').focus(); return false; }
  }
  if (n === 4 && sigPad && sigPad.isEmpty()) { goTo(4); alert('Please sign the form in the signature box before submitting.'); return false; }
  return true;
}
function next(from) { if (validateStep(from)) goTo(from + 1); }

// ── COLLECT DATA ─────────────────────────────────────────────────────
function getV(id) { const el = $(id); return el ? el.value.trim() : ''; }
function getRadio(name) { const el = document.querySelector(`input[name="${name}"]:checked`); return el ? el.value : ''; }
function collectTableData(tbodyId) {
  const rows = [];
  document.querySelectorAll(`#${tbodyId} tr`).forEach(tr => {
    const cells = []; tr.querySelectorAll('input,select,textarea').forEach(el => cells.push(el.value.trim()));
    if (cells.some(c => c)) rows.push(cells);
  });
  return rows;
}
const fmtDate = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || ''); };

function collectAll() {
  const fn = getV('firstName'), mn = getV('middleName'), ln = getV('lastName');
  return {
    personal: {
      firstName: fn, middleName: mn, lastName: ln, fullName: [fn, mn, ln].filter(Boolean).join(' '),
      fatherName: getV('fatherName'), position: getV('position'), source: getV('source'), sourceDetails: getV('sourceDetails'),
      gender: getV('gender'), dob: getV('dob'), age: getV('age'), placeOfBirth: getV('placeOfBirth'),
      citizenship: getV('citizenship'), religion: getV('religion'), marital: getV('marital'), blood: getV('blood'),
      cnic: getV('cnic'), presentAddr: getV('presentAddr'), email: getV('email'),
      permAddr: getV('permAddr') || getV('presentAddr'),
      mobile: getV('mobile'), resTel: getV('resTel'), permTel: getV('permTel'),
      em1Name: getV('em1Name'), em1Rel: getV('em1Rel'), em1Tel: getV('em1Tel'),
      em2Name: getV('em2Name'), em2Rel: getV('em2Rel'), em2Tel: getV('em2Tel')
    },
    education: collectTableData('eduBody').filter(r => r.slice(1, 5).some(Boolean)),
    family: collectTableData('famBody').filter(r => r[1] || r[3] || r[4] || r[5]),
    experience: { worked: getRadio('worked'), rows: collectTableData('expBody'), orgStr: getV('orgStr'), jobResp: getV('jobResp') },
    compensation: { salary: getV('expSalary'), benefits: getV('otherBenefits'), availability: getV('availability') },
    section3: {
      disease: getRadio('disease'), diseaseDetails: getV('diseaseBox'),
      applied: getRadio('applied'), appliedDetails: getV('appliedBox'), hasRel: getRadio('hasRel'),
      references: collectTableData('refBody'), relatives: collectTableData('relBody'),
      date: getV('sigDate')
    }
  };
}

// ── FULL TEXT VERSION OF THE APPLICATION (goes in the HR email body) ─
function buildDetailsText(d) {
  const p = d.personal, e = d.experience, s = d.section3, c = d.compensation;
  const L = (k, v) => `${k}: ${v || '-'}`;
  const tbl = (rows, labels) => rows.length
    ? rows.map((r, i) => `  ${i + 1}. ` + labels.map((l, j) => `${l}: ${r[j] || '-'}`).join(' | ')).join('\n') : '  -';
  return [
    '=== PERSONAL INFORMATION ===',
    L('Name', p.fullName), L("Father's Name", p.fatherName), L('Position Applied For', p.position),
    L('Came through', p.source + (p.sourceDetails ? ` (${p.sourceDetails})` : '')),
    L('Gender', p.gender === 'M' ? 'Male' : 'Female'), L('Date of Birth', fmtDate(p.dob)), L('Age', p.age),
    L('Place of Birth', p.placeOfBirth), L('Citizenship', p.citizenship), L('Religion', p.religion),
    L('Marital Status', p.marital), L('Blood Group', p.blood), L('CNIC', p.cnic),
    '', '=== CONTACT ===',
    L('Present Address', p.presentAddr), L('Permanent Address', p.permAddr), L('Email', p.email),
    L('Mobile', p.mobile), L('Residence Tel', p.resTel), L('Permanent Tel', p.permTel),
    L('Emergency Contact 1', `${p.em1Name} (${p.em1Rel}) ${p.em1Tel}`),
    L('Emergency Contact 2', p.em2Name ? `${p.em2Name} (${p.em2Rel}) ${p.em2Tel}` : ''),
    '', '=== EDUCATION ===', tbl(d.education, ['Degree', 'Year', 'Institute', 'Grade', 'Subject']),
    '', '=== FAMILY ===', tbl(d.family, ['Relation', 'Name', 'Dependent', 'Profession', 'Office', 'Contact']),
    '', '=== WORK EXPERIENCE ===', L('Worked earlier', e.worked),
    e.worked === 'No' ? '  -' : tbl(e.rows, ['Employer', 'Salary Start', 'Salary Last', 'Desig. Start', 'Desig. Last', 'From', 'To', 'Functions', 'Reason for leaving']),
    L('Organization Structure', e.orgStr), L('Present Job Responsibility', e.jobResp),
    '', '=== COMPENSATION ===', L('Expected Salary', c.salary), L('Other Benefits', c.benefits), L('Availability', c.availability),
    '', '=== HEALTH / HISTORY ===',
    L('Disease / hospitalized (last year)', s.disease === 'Yes' ? 'Yes - ' + s.diseaseDetails : 'No'),
    L('Applied to our units before', s.applied === 'Yes' ? 'Yes - ' + s.appliedDetails : 'No'),
    '', '=== REFERENCES ===', tbl(s.references, ['Name', 'Relationship', 'Contact', 'Title / Company']),
    '', '=== RELATIVES IN KASSIM / RAINBOW UNITS ===', L('Has relatives', s.hasRel),
    s.hasRel === 'Yes' ? tbl(s.relatives, ['Name', 'Designation', 'Dept', 'Relationship']) : '  -',
    '', L('Declaration signed on', fmtDate(s.date))
  ].join('\n');
}

// ── PDF (attached to the HR email) ────────────────────────────────────────────────────────────
function makePdfDataUri(d) {
  const p = d.personal, e = d.experience, s3 = d.section3, c = $('sigCanvas');
  const data = {
    photo: photoB64 && photoDim ? { dataUrl: photoB64, w: photoDim.w, h: photoDim.h } : null,
    firstName: p.firstName, middleName: p.middleName, lastName: p.lastName, fatherName: p.fatherName,
    position: p.position, source: p.source, sourceDetails: p.sourceDetails, gender: p.gender,
    dob: fmtDate(p.dob), age: p.age, placeOfBirth: p.placeOfBirth, citizenship: p.citizenship, religion: p.religion,
    married: p.marital === 'Married', blood: p.blood, cnic: p.cnic, presentAddr: p.presentAddr,
    permAddr: p.permAddr === p.presentAddr ? 'Same as present address' : p.permAddr,
    email: p.email, mobile: p.mobile, resTel: p.resTel, permTel: p.permTel,
    em1Name: p.em1Name, em1Rel: p.em1Rel, em1Tel: p.em1Tel, em2Name: p.em2Name, em2Rel: p.em2Rel, em2Tel: p.em2Tel,
    edu: d.education, family: d.family, worked: e.worked !== 'No', exp: e.rows, orgStr: e.orgStr, jobResp: e.jobResp,
    expSalary: d.compensation.salary, otherBenefits: d.compensation.benefits, availability: d.compensation.availability,
    disease: s3.disease, diseaseDetails: s3.diseaseDetails, applied: s3.applied, appliedDetails: s3.appliedDetails,
    refs: s3.references, hasRel: s3.hasRel === 'Yes', rels: s3.relatives,
    signature: !sigPad.isEmpty() ? { dataUrl: sigPad.toDataURL('image/png'), w: c.width, h: c.height } : null,
    sigDate: fmtDate(s3.date)
  };
  return buildPdf(data, window.jspdf.jsPDF).output('datauristring');
}

// ── SUBMIT ───────────────────────────────────────────────────────────
async function submitForm() {
  if (submitting) return;
  if (!validateStep(1) || !validateStep(3) || !validateStep(4)) return;

  submitting = true;
  const btn = $('submitBtn');
  btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Submitting...';
  $('spinnerOverlay').style.display = 'flex';

  try {
    const d = collectAll(), p = d.personal;
    const resp = await fetch(SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hp: getV('website'),                                   // honeypot (must stay empty)
        fields: { name: p.fullName, position: p.position, cnic: p.cnic, email: p.email, mobile: p.mobile },
        details: buildDetailsText(d),
        pdfBase64: makePdfDataUri(d)
      })
    });
    const out = await resp.json().catch(() => ({}));
    if (!resp.ok || !out.ok) throw new Error(out.error || ('HTTP ' + resp.status));

    $('spinnerOverlay').style.display = 'none';
    $('successOverlay').style.display = 'flex';        // thank-you screen (cannot be dismissed)
  } catch (err) {
    console.error('Submit error:', err);
    $('spinnerOverlay').style.display = 'none';
    submitting = false; btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Application';
    alert('Sorry, we could not submit your application right now. Please check your internet connection and try again.');
  }
}
