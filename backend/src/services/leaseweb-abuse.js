// Leaseweb Abuse API v1 (https://developer.leaseweb.com/api-docs/abuse_v1.html).
// Access is not on by default — Leaseweb enables it per account on request, so a 401/403
// here usually means "not enabled for this key" rather than a bad key.
import { fetch } from 'undici';

const BASE = 'https://api.leaseweb.com/abuse/v1';
const PAGE = 50;

export class LeasewebApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function lsw(key, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'X-LSW-Auth': key,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body:   body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    throw new LeasewebApiError(res.status, json?.errorMessage || json?.message || text.slice(0, 200) || `HTTP ${res.status}`);
  }
  return json;
}

const id = (reportId) => encodeURIComponent(reportId);

// Every report that is not CLOSED. Statuses are OPEN, WAITING and CLOSED, and an
// unfiltered list defaults to all three, so ask for OPEN,WAITING explicitly — WAITING
// reports are still unresolved and still have a deadline. If Leaseweb rejects the filter,
// page through the unfiltered list (bounded, so a long history can't stall a cycle).
export async function listOpenReports(key) {
  try {
    const out = [];
    for (let offset = 0; offset < 1000; offset += PAGE) {
      const page = (await lsw(key, 'GET', `/reports?status=OPEN,WAITING&limit=${PAGE}&offset=${offset}`))?.reports || [];
      out.push(...page);
      if (page.length < PAGE) break;
    }
    return out;
  } catch (err) {
    if (err.status !== 400) throw err;
  }
  const out = [];
  for (let offset = 0; offset < 500; offset += PAGE) {
    const page = (await lsw(key, 'GET', `/reports?limit=${PAGE}&offset=${offset}`))?.reports || [];
    out.push(...page.filter(r => String(r.status || '').toUpperCase() !== 'CLOSED'));
    if (page.length < PAGE) break;
  }
  return out;
}

export const getReport       = (key, reportId) => lsw(key, 'GET', `/reports/${id(reportId)}`);
export const listMessages    = async (key, reportId) => (await lsw(key, 'GET', `/reports/${id(reportId)}/messages?limit=100`))?.messages || [];
export const postMessage     = (key, reportId, body) => lsw(key, 'POST', `/reports/${id(reportId)}/messages`, { body });
export const listResolutions = (key, reportId) => lsw(key, 'GET', `/reports/${id(reportId)}/resolutions`);
export const resolveReport   = (key, reportId, resolutions, message) =>
  lsw(key, 'POST', `/reports/${id(reportId)}/resolve`, { resolutions, ...(message ? { message } : {}) });
