// Mailbox intake for abuse notices: covers providers without an API, and Leaseweb keys
// that don't have Abuse API access. The mailbox is only ever read — nothing is marked
// seen, moved or deleted — so it is safe to point at a shared inbox.
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const IPV4 = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function extractIps(text) {
  return [...new Set(String(text || '').match(IPV4) || [])];
}

const domainOf = (address) => String(address || '').split('@').pop().toLowerCase().trim();
const matchesDomain = (domain, allowed) => domain === allowed || domain.endsWith(`.${allowed}`);

// A From: header is trivially forged, and a forged notice could get a customer suspended.
// So besides the sender domain we require a DKIM pass for an allowed domain in the
// receiving server's own Authentication-Results header (the topmost one).
export function isTrustedSender(fromAddress, allowedDomains, authResults, requireDkim = true) {
  const from = domainOf(fromAddress);
  if (!from || !allowedDomains.some(d => matchesDomain(from, d))) return false;
  if (!requireDkim) return true;
  const passed = [...String(authResults || '').matchAll(/dkim=pass[^;]*?header\.(?:d|i)=@?([A-Za-z0-9.-]+)/gi)]
    .map(m => m[1].toLowerCase());
  return passed.some(d => allowedDomains.some(a => matchesDomain(d, a)));
}

// "September 15th at 17:53:05 UTC" (Leaseweb); also accepts an explicit year or ISO strings.
export function parseDeadline(text, receivedAt = new Date()) {
  if (!text) return null;
  const m = String(text).match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\s+(?:at\s+)?(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:UTC|GMT|Z)/i);
  if (m) {
    const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (month >= 0) {
      const build = (y) => new Date(Date.UTC(y, month, +m[2], +m[4], +m[5], +(m[6] || 0)));
      const ref = receivedAt instanceof Date && !isNaN(receivedAt) ? receivedAt : new Date();
      let d = build(m[3] ? +m[3] : ref.getUTCFullYear());
      // No year given and the date lands far in the past: the deadline crosses New Year.
      if (!m[3] && d < new Date(ref.getTime() - 180 * 86400e3)) d = build(ref.getUTCFullYear() + 1);
      return d;
    }
  }
  const iso = new Date(text);
  return isNaN(iso) ? null : iso;
}

const htmlToText = (html) => String(html || '')
  .replace(/<(br|\/p|\/div|\/tr)[^>]*>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Turns one notice into the fields ingestReport() needs, or { isAbuse: false }.
export function parseAbuseEmail({ from, subject = '', text = '', html = '', date, messageId }) {
  const body = text || htmlToText(html);
  const sender = domainOf(from);
  const isLeaseweb = /(^|\.)leaseweb\.com$/.test(sender);
  if (!/abuse/i.test(`${subject}\n${body}`)) return { isAbuse: false };

  const received = date instanceof Date ? date : new Date();
  const deadlineMatch = body.match(/deadline[^\[\n]{0,60}\[([^\]]+)\]/i) || body.match(/deadline:?\s*([^\n.]{6,60}UTC)/i);

  // Leaseweb quotes the original complaint below a marker line; the text above it is
  // Leaseweb's own boilerplate, which is not what the client needs to read.
  const split = body.split(/Original notification is placed below\s*\n\*+\s*\n?/i);
  const original = (split.length > 1 ? split.slice(1).join('\n') : body).trim();

  let externalId =
    body.match(/abuse-reports\/([A-Za-z0-9]+)/)?.[1] ||
    subject.match(/\[#?([A-Za-z0-9-]{4,})\]/)?.[1] ||
    null;
  if (!externalId) externalId = `msg-${Buffer.from(String(messageId || `${subject}${received.toISOString()}`)).toString('base64url').slice(0, 60)}`;

  const ips = extractIps(original);
  return {
    isAbuse:          true,
    provider:         isLeaseweb ? 'leaseweb' : sender,
    externalId,
    subject:          subject.slice(0, 500),
    abuseType:        null,
    body:             original,
    ips:              ips.length ? ips : extractIps(body),
    providerDeadline: deadlineMatch ? parseDeadline(deadlineMatch[1], received) : null,
    providerStatus:   'OPEN',
    reportedAt:       received,
  };
}

function imapClient(cfg) {
  return new ImapFlow({
    host:   cfg.host,
    port:   cfg.port,
    secure: cfg.secure,
    auth:   { user: cfg.user, pass: cfg.pass },
    logger: false,
  });
}

// Calls handler(parsedMail) for every message from an allowed sender domain received in
// the last `sinceDays` days. De-duplication is the caller's job (by report id).
export async function scanMailbox(cfg, senders, handler, { sinceDays = 3, max = 200 } = {}) {
  const client = imapClient(cfg);
  await client.connect();
  const lock = await client.getMailboxLock(cfg.folder || 'INBOX');
  let scanned = 0;
  try {
    const since = new Date(Date.now() - sinceDays * 86400e3);
    const uids = new Set();
    for (const domain of senders) {
      for (const uid of (await client.search({ since, from: domain }, { uid: true })) || []) uids.add(uid);
    }
    const newest = [...uids].sort((a, b) => b - a).slice(0, max);
    for (const uid of newest) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg?.source) continue;
      await handler(await simpleParser(msg.source));
      scanned++;
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return scanned;
}

export async function testMailboxConnection(cfg) {
  const client = imapClient(cfg);
  await client.connect();
  try {
    const status = await client.status(cfg.folder || 'INBOX', { messages: true });
    return { folder: cfg.folder || 'INBOX', messages: status.messages };
  } finally {
    await client.logout().catch(() => {});
  }
}
