import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

export function generateSecret(email) {
  const secret = speakeasy.generateSecret({
    name: `Zenith (${email})`,
    issuer: 'Zenith',
    length: 20,
  });
  return { base32: secret.base32, otpauth_url: secret.otpauth_url };
}

export function verifyToken(secret, token) {
  return speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });
}

export async function generateQRCode(otpauth_url) {
  return QRCode.toDataURL(otpauth_url);
}
