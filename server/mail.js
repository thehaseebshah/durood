// Transactional email. Providers: resend | sendgrid | console (default).
// With no provider configured, messages are logged and kept in `outbox`, so flows work end to end in development
// and in tests, and an admin can still copy a reset link by hand (see the admin page).
export const outbox = [];

const FROM = () => process.env.MAIL_FROM || 'Seerah Quest <no-reply@example.org>';

async function viaResend({ to, subject, text }) {
  const r = await fetch('https://api.resend.com/emails', {
    signal: AbortSignal.timeout(10_000),
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM(), to: [to], subject, text }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}`);
}

async function viaSendgrid({ to, subject, text }) {
  const from = FROM();
  const m = /^(.*)<(.+)>$/.exec(from);
  const r = await fetch('https://api.sendgrid.com/v3/mail/send', {
    signal: AbortSignal.timeout(10_000),
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.SENDGRID_API_KEY}` },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: m ? { name: m[1].trim(), email: m[2].trim() } : { email: from },
      subject, content: [{ type: 'text/plain', value: text }],
    }),
  });
  if (!r.ok) throw new Error(`sendgrid ${r.status}`);
}

/** Never throws: a failed email must not break sign-up or a reset request. Resolves true when handed to the provider. */
const maskLinks = (t) => String(t).replace(/([?&](?:reset|confirm)=)[^\s&]+/g, '$1…');

export async function sendMail(msg) {
  const provider = (process.env.MAIL_PROVIDER || 'console').toLowerCase();
  try {
    if (provider === 'resend') await viaResend(msg);
    else if (provider === 'sendgrid') await viaSendgrid(msg);
    else {
      outbox.push({ ...msg, at: Date.now() });
      if (outbox.length > 200) outbox.shift();
      if (process.env.NODE_ENV !== 'test' && process.env.DB_PATH !== ':memory:') console.log(`[mail:console] to=${msg.to} subject="${msg.subject}"\n${process.env.NODE_ENV === 'production' ? maskLinks(msg.text) : msg.text}\n`); // in production a log reader must not get working reset links
    }
    return true;
  } catch (e) {
    console.error('mail failed:', e.message);
    return false;
  }
}

export const baseUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

// One message carries both languages: members read whichever they prefer.
export const resetEmail = (to, url) => ({
  to,
  subject: 'Reset your password · پاس ورڈ بدلیں',
  text: `Assalamu alaikum,\n\nUse this link to choose a new password for Seerah Quest. It works once and expires in one hour:\n${url}\n\nIf you did not ask for this, ignore this email.\n\n— — —\n\nالسلام علیکم،\n\nسیرت کوئسٹ کا نیا پاس ورڈ منتخب کرنے کے لیے یہ لنک استعمال کریں۔ یہ ایک بار چلتا ہے اور ایک گھنٹے میں ختم ہو جاتا ہے:\n${url}\n\nاگر آپ نے یہ درخواست نہیں کی تو اس ای میل کو نظر انداز کر دیں۔`,
});

export const confirmEmail = (to, url) => ({
  to,
  subject: 'Confirm your email · ای میل کی تصدیق کریں',
  text: `Assalamu alaikum,\n\nWelcome to Seerah Quest. Confirm this email address so we can reach you if you forget your password:\n${url}\n\n— — —\n\nالسلام علیکم،\n\nسیرت کوئسٹ میں خوش آمدید۔ اس ای میل کی تصدیق کریں تاکہ پاس ورڈ بھول جانے پر ہم آپ سے رابطہ کر سکیں:\n${url}`,
});

export const inviteEmail = (to, code) => ({
  to,
  subject: 'Your Seerah Quest invite code · آپ کا دعوتی کوڈ',
  text: `Assalamu alaikum,\n\nYour request was approved. Your single-use invite code is:\n${code}\n\nOpen the app and enter it when you register.\n\n— — —\n\nالسلام علیکم،\n\nآپ کی درخواست منظور ہو گئی۔ آپ کا ایک بار استعمال ہونے والا دعوتی کوڈ:\n${code}\n\nرجسٹر کرتے وقت اسے درج کریں۔`,
});
