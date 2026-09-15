import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ExternalLink, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { adminAPI } from '../../api/client';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';

const STATUS = {
  pending:   ['Pending',         'bg-blue-100 text-blue-700'],
  notified:  ['Client notified', 'bg-amber-100 text-amber-800'],
  review:    ['Needs review',    'bg-red-100 text-red-700'],
  suspended: ['Suspended',       'bg-yellow-100 text-yellow-800'],
  resolved:  ['Resolved',        'bg-green-100 text-green-700'],
  unmatched: ['Unmatched IP',    'bg-slate-100 text-slate-600'],
};
const FILTERS = [['open', 'Open'], ['review', 'Needs review'], ['notified', 'Notified'], ['suspended', 'Suspended'], ['unmatched', 'Unmatched'], ['resolved', 'Resolved'], ['', 'All']];

const errMsg = (e) => e.response?.data?.error || e.message;
const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');
function relative(d) {
  if (!d) return '';
  const ms = new Date(d) - Date.now();
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3600e3);
  const m = Math.floor((abs % 3600e3) / 60e3);
  const span = h >= 48 ? `${Math.floor(h / 24)}d` : h ? `${h}h ${m}m` : `${m}m`;
  return ms >= 0 ? `in ${span}` : `${span} ago`;
}
const providerLabel = (p) => (p === 'leaseweb' ? 'Leaseweb' : p);

function Pill({ status }) {
  const [label, cls] = STATUS[status] || [status, 'bg-slate-100 text-slate-600'];
  return <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${cls}`}>{label}</span>;
}

function Deadline({ at, urgent }) {
  if (!at) return <span className="text-slate-400">—</span>;
  const past = new Date(at) < Date.now();
  return (
    <div>
      <div className="text-xs text-slate-700">{fmt(at)}</div>
      <div className={`text-xs ${past ? 'text-red-600 font-medium' : urgent ? 'text-amber-700' : 'text-slate-400'}`}>{relative(at)}</div>
    </div>
  );
}

function StatusStrip({ status }) {
  if (!status) return null;
  const run = status.lastRun;
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Automation</p>
        <p className={`text-sm font-medium ${status.enabled ? 'text-green-700' : 'text-slate-500'}`}>{status.enabled ? 'Enabled' : 'Disabled'}</p>
        <p className="text-xs text-slate-500">Auto-suspend {status.autoSuspend ? 'on' : 'off'}{!status.deptConfigured && ' · WHMCS department not set'}</p>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Leaseweb API ({status.leasewebKeys} key{status.leasewebKeys === 1 ? '' : 's'})</p>
        {!status.apiStatus.length && <p className="text-xs text-slate-500">Not checked yet — press Poll now</p>}
        {status.apiStatus.map(k => (
          <p key={k.key} className="text-xs" title={k.error || ''}>
            <span className={k.ok ? 'text-green-700' : 'text-red-600'}>{k.ok ? '●' : '●'}</span>{' '}
            <span className="text-slate-700">{k.pools.join(', ')}</span>{' '}
            <span className="text-slate-400">{k.ok ? `${k.open} open` : (k.http ? `HTTP ${k.http}` : 'error')}</span>
          </p>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Mailbox</p>
        {!status.imapConfigured ? <p className="text-xs text-slate-500">Not configured</p> : run?.mailbox ? (
          <p className={`text-xs ${run.mailbox.ok ? 'text-slate-700' : 'text-red-600'}`}>
            {run.mailbox.ok ? `${run.mailbox.scanned} scanned · ${run.mailbox.ingested} new${run.mailbox.untrusted ? ` · ${run.mailbox.untrusted} failed sender check` : ''}` : run.mailbox.error}
          </p>
        ) : <p className="text-xs text-slate-500">Configured, not polled yet</p>}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Last run</p>
        {run ? (
          <>
            <p className="text-xs text-slate-700">{fmt(run.finishedAt || run.startedAt)} <span className="text-slate-400">({relative(run.finishedAt || run.startedAt)})</span></p>
            <p className="text-xs text-slate-500">{run.ingested} new · {run.notified} notified · {run.suspended} suspended</p>
            {run.errors?.length > 0 && <p className="text-xs text-red-600 truncate" title={run.errors.join('\n')}>{run.errors.length} error(s): {run.errors[0]}</p>}
          </>
        ) : <p className="text-xs text-slate-500">Never</p>}
      </div>
    </div>
  );
}

function CaseDetail({ id, whmcsUrl, onClose, onChanged }) {
  const [c, setC] = useState(null);
  const [busy, setBusy] = useState('');
  const [hours, setHours] = useState('');
  const [note, setNote] = useState('');
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [lswMessage, setLswMessage] = useState('');
  const [resolutions, setResolutions] = useState(null);
  const [messageRequired, setMessageRequired] = useState(false);
  const [picked, setPicked] = useState([]);

  const load = useCallback(() => adminAPI.getAbuseCase(id).then(r => setC(r.data.data)).catch(e => toast.error(errMsg(e))), [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (name, fn, success) => {
    setBusy(name);
    try {
      const r = await fn();
      const warning = r?.data?.data?.warning;
      toast.success(success);
      if (warning) toast(warning, { icon: '⚠️', duration: 8000 });
      setConfirmSuspend(false);
      await load();
      onChanged();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(''); }
  };

  const act = (a, d, msg) => run(a, () => adminAPI.abuseCaseAction(id, a, d), msg);

  if (!c) return <Modal open onClose={onClose} title="Abuse case" size="xl"><p className="text-sm text-slate-500">Loading…</p></Modal>;

  const canNotify  = ['pending', 'review'].includes(c.status) && c.vps_id && !c.notified_at;
  const canExtend  = ['notified', 'review'].includes(c.status) && c.notified_at;
  const canSuspend = c.vps_id && !['suspended', 'resolved'].includes(c.status) && c.vps_status !== 'suspended';
  const Row = ({ label, children }) => (
    <div><p className="text-xs text-slate-500">{label}</p><div className="text-sm text-slate-900">{children}</div></div>
  );

  return (
    <Modal open onClose={onClose} size="xl" title={`${providerLabel(c.provider)} #${c.external_id}`}>
      <div className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        <div className="flex items-center gap-3 flex-wrap">
          <Pill status={c.status} />
          <span className="text-xs text-slate-500">via {c.source}</span>
          {c.provider_status && <span className="text-xs text-slate-500">provider status: {c.provider_status}</span>}
          {c.provider_url && <a href={c.provider_url} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1">Open in Leaseweb <ExternalLink size={12} /></a>}
        </div>

        {c.last_error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{c.last_error}</div>}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Row label="Reported IP">{c.ip_address || '—'}</Row>
          <Row label="VPS">{c.vps_id ? <Link to={`/admin/vps/${c.vps_id}`} className="text-indigo-600 hover:underline">{c.hostname}</Link> : '—'} {c.vps_status && <span className="text-xs text-slate-400">({c.vps_status})</span>}</Row>
          <Row label="Client">{c.user_email || '—'}</Row>
          <Row label="WHMCS service">{c.vps_service_id ? `#${c.vps_service_id}` : 'Not linked'}</Row>
          <Row label="Ticket">{c.whmcs_ticket_tid ? (whmcsUrl
            ? <a href={`${whmcsUrl}/admin/supporttickets.php?action=view&id=${c.whmcs_ticket_id}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">#{c.whmcs_ticket_tid}</a>
            : `#${c.whmcs_ticket_tid}`) : '—'} {c.whmcs_ticket_status && <span className="text-xs text-slate-400">({c.whmcs_ticket_status})</span>}</Row>
          <Row label="Client last replied">{c.client_last_reply || '—'}</Row>
          <Row label="Client deadline"><Deadline at={c.client_deadline} urgent /></Row>
          <Row label="Provider deadline"><Deadline at={c.provider_deadline} /></Row>
          <Row label="Type">{c.abuse_type || '—'}</Row>
        </div>

        {c.otherCases?.length > 0 && (
          <p className="text-xs text-slate-500">This report also covers: {c.otherCases.map(o => `${o.ip_address || 'no IP'} (${o.status})`).join(', ')}</p>
        )}

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase mb-1">{c.report_subject || 'Report'}</p>
          <pre className="whitespace-pre-wrap break-words text-xs bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-72 overflow-y-auto">{c.report_body || '(no body)'}</pre>
        </div>

        <div className="border-t border-slate-200 pt-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase">Actions</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="number" min="0.5" step="0.5" value={hours} onChange={e => setHours(e.target.value)} placeholder="hours"
              className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
            {canNotify && <Button size="sm" loading={busy === 'notify'} onClick={() => act('notify', { hours: hours || null }, 'Client notified')}>
              Notify client {hours ? `(${hours}h)` : '(auto deadline)'}</Button>}
            {canExtend && <Button size="sm" variant="outline" disabled={!hours} loading={busy === 'extend'} onClick={() => act('extend', { hours }, 'Deadline extended')}>Extend deadline</Button>}
            {canSuspend && (confirmSuspend
              ? <Button size="sm" variant="danger" loading={busy === 'suspend'} onClick={() => act('suspend', {}, 'VPS suspended')}>Confirm suspend</Button>
              : <Button size="sm" variant="warning" onClick={() => setConfirmSuspend(true)}>Suspend now</Button>)}
            {c.status === 'suspended' && <Button size="sm" variant="success" loading={busy === 'unsuspend'} onClick={() => act('unsuspend', { note }, 'VPS unsuspended')}>Unsuspend &amp; resolve</Button>}
          </div>
          {c.status !== 'resolved' && (
            <div className="flex items-center gap-2">
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Resolution note (e.g. client removed the spam script)"
                className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              <Button size="sm" variant="outline" loading={busy === 'resolve'} onClick={() => act('resolve', { note }, 'Case resolved')}>Mark resolved</Button>
            </div>
          )}
          <p className="text-xs text-slate-400">Marking resolved cancels a scheduled suspension. It does not close the report at the provider.</p>
        </div>

        {c.provider === 'leaseweb' && (
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase">Leaseweb</p>
            {!c.provider_api && <p className="text-xs text-slate-500">This report came in by email, so replies go through the <a href={c.provider_url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">Leaseweb portal</a>.</p>}
            {c.providerError && <p className="text-xs text-red-600">{c.providerError}</p>}
            {c.providerMessages?.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {c.providerMessages.map((m, i) => (
                  <div key={i} className="text-xs bg-slate-50 border border-slate-200 rounded-lg p-2">
                    <p className="text-slate-500 mb-1">{m.postedBy} · {fmt(m.postedAt)}</p>
                    <p className="whitespace-pre-wrap text-slate-800">{m.body}</p>
                  </div>
                ))}
              </div>
            )}
            {c.provider_api && (
              <>
                <div className="flex items-start gap-2">
                  <textarea value={lswMessage} onChange={e => setLswMessage(e.target.value)} rows={2} placeholder="Message to Leaseweb compliance"
                    className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                  <Button size="sm" variant="outline" disabled={!lswMessage.trim()} loading={busy === 'lswmsg'}
                    onClick={() => run('lswmsg', () => adminAPI.abuseCaseAction(id, 'provider-message', { body: lswMessage }), 'Sent to Leaseweb').then(() => setLswMessage(''))}>Send</Button>
                </div>
                {resolutions === null ? (
                  <Button size="sm" variant="ghost" onClick={() => adminAPI.getAbuseResolutions(id).then(r => { setResolutions(r.data.data?.resolutions || []); setMessageRequired(!!r.data.data?.isMessageRequired); }).catch(e => toast.error(errMsg(e)))}>
                    Resolve report at Leaseweb…</Button>
                ) : (
                  <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                    {resolutions.map(r => (
                      <label key={r.id} className="flex items-center gap-2 text-sm text-slate-700">
                        <input type="checkbox" checked={picked.includes(r.id)} onChange={e => setPicked(p => e.target.checked ? [...p, r.id] : p.filter(x => x !== r.id))} />
                        {r.description}
                      </label>
                    ))}
                    {messageRequired && (
                      <p className="text-xs text-amber-700">An IP on this report is null routed, so Leaseweb requires a message: type it in the box above before resolving.</p>
                    )}
                    <Button size="sm" disabled={!picked.length || (messageRequired && !lswMessage.trim())} loading={busy === 'lswresolve'}
                      onClick={() => run('lswresolve', () => adminAPI.abuseCaseAction(id, 'provider-resolve', { resolutions: picked, message: messageRequired ? lswMessage : undefined }), 'Report resolved at Leaseweb')}>
                      Resolve at Leaseweb</Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ManualCase({ onClose, onCreated }) {
  const [f, setF] = useState({ ip: '', provider: '', reference: '', subject: '', body: '', providerDeadline: '' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF(s => ({ ...s, [k]: e.target.value }));
  const input = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none';
  const submit = async () => {
    setBusy(true);
    try {
      await adminAPI.createAbuseCase({ ...f, providerDeadline: f.providerDeadline ? new Date(f.providerDeadline).toISOString() : null });
      toast.success('Case created — the client is notified on the next run');
      onCreated();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New abuse case" size="lg"
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.ip} onClick={submit}>Create case</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-slate-500">For reports that neither the Leaseweb API nor the mailbox picked up (e.g. another provider's portal).</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Reported IP(s)</label><input className={input} value={f.ip} onChange={set('ip')} placeholder="85.17.4.94" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Provider deadline (your local time)</label><input type="datetime-local" className={input} value={f.providerDeadline} onChange={set('providerDeadline')} /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Provider</label><input className={input} value={f.provider} onChange={set('provider')} placeholder="oneprovider" /></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Provider reference</label><input className={input} value={f.reference} onChange={set('reference')} placeholder="ticket id" /></div>
        </div>
        <div><label className="block text-sm font-medium text-slate-700 mb-1">Subject</label><input className={input} value={f.subject} onChange={set('subject')} /></div>
        <div><label className="block text-sm font-medium text-slate-700 mb-1">Report text (sent to the client)</label><textarea rows={8} className={input} value={f.body} onChange={set('body')} /></div>
      </div>
    </Modal>
  );
}

export default function Abuse() {
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const [data, setData] = useState({ cases: [], counts: {} });
  const [status, setStatus] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [manual, setManual] = useState(false);
  const [polling, setPolling] = useState(false);

  const load = useCallback(() => {
    adminAPI.getAbuseCases({ status: filter || undefined, search: search || undefined }).then(r => setData(r.data.data)).catch(() => {});
    adminAPI.getAbuseStatus().then(r => setStatus(r.data.data)).catch(() => {});
  }, [filter, search]);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  const poll = async () => {
    setPolling(true);
    try {
      const r = await adminAPI.pollAbuse();
      const s = r.data.data;
      if (s.skipped) toast(s.skipped);
      else toast.success(`${s.ingested} new report(s) · ${s.notified} notified · ${s.suspended} suspended${s.errors.length ? ` · ${s.errors.length} error(s)` : ''}`);
      if (s.note) toast(s.note, { duration: 6000 });
      load();
    } catch (e) { toast.error(errMsg(e)); }
    finally { setPolling(false); }
  };

  const openCount = (data.counts.pending || 0) + (data.counts.notified || 0) + (data.counts.review || 0);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <ShieldAlert className="text-indigo-600" />
          <h1 className="text-2xl font-bold text-slate-900">Abuse</h1>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/admin/settings?tab=abuse" className="text-sm text-slate-500 hover:text-slate-700 mr-2">Settings</Link>
          <Button variant="outline" onClick={() => setManual(true)}><Plus size={16} /> New case</Button>
          <Button loading={polling} onClick={poll}>{!polling && <RefreshCw size={16} />} Poll now</Button>
        </div>
      </div>

      {status && !status.enabled && (
        <div className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3">
          Automation is off. Reports can be fetched with Poll now, but no client is notified and nothing is suspended until you enable it in <Link to="/admin/settings?tab=abuse" className="underline">Settings → Abuse</Link>.
        </div>
      )}

      <StatusStrip status={status} />

      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {FILTERS.map(([key, label]) => {
            const n = key === 'open' ? openCount : key ? data.counts[key] : null;
            return (
              <button key={key} onClick={() => setFilter(key)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === key ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                {label}{n ? ` (${n})` : ''}
              </button>
            );
          })}
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search IP, report, hostname, email"
          className="px-3 py-2 border border-slate-200 rounded-lg text-sm w-72 focus:ring-2 focus:ring-indigo-500 outline-none" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
            <tr>{['Report', 'IP / VPS', 'Client', 'Status', 'Client deadline', 'Provider deadline', 'Ticket'].map(h => <th key={h} className="px-4 py-3 text-left whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.cases.map(c => (
              <tr key={c.id} onClick={() => setOpenId(c.id)} className="hover:bg-slate-50 cursor-pointer align-top">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-slate-900">{providerLabel(c.provider)} #{c.external_id}</p>
                  <p className="text-xs text-slate-500 max-w-xs truncate">{c.abuse_type || c.subject}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="text-sm text-slate-900 font-mono">{c.ip_address || '—'}</p>
                  <p className="text-xs text-slate-500">{c.hostname || 'no VPS'}</p>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{c.user_email || '—'}</td>
                <td className="px-4 py-3">
                  <Pill status={c.status} />
                  {c.client_last_reply && ['notified', 'review'].includes(c.status) && <p className="text-xs text-indigo-600 mt-1">client replied</p>}
                  {c.last_error && <p className="text-xs text-red-600 mt-1 max-w-[14rem] truncate" title={c.last_error}>{c.last_error}</p>}
                </td>
                <td className="px-4 py-3">{['notified', 'review'].includes(c.status) ? <Deadline at={c.client_deadline} urgent /> : <span className="text-xs text-slate-400">{c.client_deadline ? fmt(c.client_deadline) : '—'}</span>}</td>
                <td className="px-4 py-3"><Deadline at={c.provider_deadline} /></td>
                <td className="px-4 py-3 text-sm text-slate-600">{c.whmcs_ticket_tid ? `#${c.whmcs_ticket_tid}` : '—'}</td>
              </tr>
            ))}
            {!data.cases.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 text-sm">No abuse cases</td></tr>}
          </tbody>
        </table>
      </div>

      {openId && <CaseDetail id={openId} whmcsUrl={status?.whmcsUrl} onClose={() => setOpenId(null)} onChanged={load} />}
      {manual && <ManualCase onClose={() => setManual(false)} onCreated={() => { setManual(false); load(); }} />}
    </div>
  );
}
