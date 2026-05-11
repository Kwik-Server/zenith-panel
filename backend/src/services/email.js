import nodemailer from 'nodemailer';
import { queryOne } from '../config/database.js';

async function getTransporter() {
  const settings = await queryOne('SELECT * FROM settings WHERE key = "smtp_host"').catch(() => null);
  if (!settings) return null;

  const rows = await require('../config/database.js').query('SELECT * FROM settings WHERE `key` IN ("smtp_host","smtp_port","smtp_user","smtp_pass","smtp_from","smtp_secure")');
  const cfg = Object.fromEntries(rows.map(r => [r.key, r.value]));

  if (!cfg.smtp_host) return null;

  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: parseInt(cfg.smtp_port || '587'),
    secure: cfg.smtp_secure === 'true',
    auth: cfg.smtp_user ? { user: cfg.smtp_user, pass: cfg.smtp_pass } : undefined,
  });
}

export async function sendVpsCreatedEmail(to, { hostname, ip, password }) {
  const t = await getTransporter();
  if (!t) return;
  await t.sendMail({
    to,
    subject: 'Your VPS is Ready',
    text: `Your VPS ${hostname} has been created.\nIP: ${ip}\nRoot Password: ${password}\n\nManage it at your client portal.`,
  });
}

export async function sendVpsSuspendedEmail(to, { hostname }) {
  const t = await getTransporter();
  if (!t) return;
  await t.sendMail({
    to,
    subject: `VPS ${hostname} Suspended`,
    text: `Your VPS ${hostname} has been suspended. Please settle any outstanding invoices to restore access.`,
  });
}

export async function testSmtp(config) {
  const t = nodemailer.createTransport({
    host: config.smtp_host,
    port: parseInt(config.smtp_port || '587'),
    secure: config.smtp_secure === 'true',
    auth: config.smtp_user ? { user: config.smtp_user, pass: config.smtp_pass } : undefined,
  });
  await t.verify();
}
