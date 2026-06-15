import { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import { formatDistanceToNow } from 'date-fns';
import { Search } from 'lucide-react';

const ACTION_COLORS = {
  vps_created:               'bg-green-100 text-green-700',
  vps_imported:              'bg-teal-100 text-teal-700',
  vps_deleted:               'bg-red-100 text-red-700',
  vps_force_deleted:         'bg-red-100 text-red-700',
  vps_started:               'bg-green-100 text-green-700',
  vps_stopped:               'bg-slate-100 text-slate-600',
  vps_restarted:             'bg-blue-100 text-blue-700',
  vps_force_stopped:         'bg-orange-100 text-orange-700',
  vps_suspended:             'bg-amber-100 text-amber-700',
  vps_unsuspended:           'bg-green-100 text-green-700',
  vps_reinstalled:           'bg-rose-100 text-rose-700',
  vps_rdns_updated:          'bg-indigo-100 text-indigo-700',
  vps_network_reconfigured:  'bg-indigo-100 text-indigo-700',
  vps_firewall_rule_added:   'bg-violet-100 text-violet-700',
  vps_firewall_rule_deleted: 'bg-violet-100 text-violet-700',
  vps_firewall_options_updated: 'bg-violet-100 text-violet-700',
};

function describe(action, details) {
  const d = details || {};
  const map = {
    vps_created:               () => `Created VPS "${d.hostname || ''}"`,
    vps_imported:              () => `Imported VPS "${d.hostname || ''}" (Proxmox VMID ${d.proxmox_vmid || ''})`,
    vps_deleted:               () => `Deleted VPS "${d.hostname || ''}"`,
    vps_force_deleted:         () => `Force removed VPS "${d.hostname || ''}" (VMID ${d.proxmox_vmid || ''})`,
    vps_started:               () => `Started VPS`,
    vps_stopped:               () => `Stopped VPS`,
    vps_restarted:             () => `Restarted VPS`,
    vps_force_stopped:         () => `Force stopped VPS`,
    vps_suspended:             () => `Suspended VPS`,
    vps_unsuspended:           () => `Unsuspended VPS`,
    vps_reinstalled:           () => `Queued OS reinstall on VPS`,
    vps_rdns_updated:          () => `Updated PTR for ${d.ip || ''} → ${d.ptr || '(cleared)'}`,
    vps_network_reconfigured:  () => `Reconfigured network — applied: ${d.ipConfig || ''}`,
    vps_firewall_rule_added:   () => `Added firewall rule: ${[d.type, d.action, d.proto, d.dport ? 'port ' + d.dport : ''].filter(Boolean).join(' ')}`,
    vps_firewall_rule_deleted: () => `Deleted firewall rule #${d.pos ?? ''}`,
    vps_firewall_options_updated: () => `${d.enable ? 'Enabled' : 'Disabled'} firewall`,
  };
  const fn = map[action];
  return fn ? fn() : action.replace(/_/g, ' ');
}

const PAGE_SIZE = 50;

export default function Logs() {
  const [logs, setLogs]       = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [search, setSearch]   = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const load = (p = page, q = search) => {
    setLoading(true);
    adminAPI.getLogs({ page: p, limit: PAGE_SIZE, ...(q ? { search: q } : {}) })
      .then(r => {
        setLogs(r.data.data.logs || []);
        setTotal(r.data.data.total || 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(1, search); setPage(1); }, [search]);
  useEffect(() => { load(page, search); }, [page]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Log</h1>
          <p className="text-slate-500 text-sm mt-0.5">{total} total entries</p>
        </div>
        <div className="relative w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by action, user, hostname…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-100">
            <tr>
              <th className="px-4 py-3 text-left">Time</th>
              <th className="px-4 py-3 text-left">Admin</th>
              <th className="px-4 py-3 text-left">Action</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-left">Resource</th>
              <th className="px-4 py-3 text-left">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && logs.length === 0 && [...Array(8)].map((_, i) => (
              <tr key={i}>{[...Array(6)].map((_, j) => (
                <td key={j} className="px-4 py-3"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>
              ))}</tr>
            ))}
            {!loading && logs.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">No log entries found</td></tr>
            )}
            {logs.map(log => {
              const details = typeof log.details === 'string' ? JSON.parse(log.details || '{}') : (log.details || {});
              const isExpanded = expanded === log.id;
              return (
                <tr key={log.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : log.id)}>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                    <span title={new Date(log.created_at).toLocaleString()}>
                      {formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{log.user_email || <span className="text-slate-400">System</span>}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ACTION_COLORS[log.action] || 'bg-slate-100 text-slate-600'}`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700 text-sm">
                    <div>{describe(log.action, details)}</div>
                    {isExpanded && Object.keys(details).length > 0 && (
                      <pre className="mt-2 p-2 bg-slate-50 rounded text-xs text-slate-500 whitespace-pre-wrap font-mono">
                        {JSON.stringify(details, null, 2)}
                      </pre>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {log.resource_type ? `${log.resource_type} #${log.resource_id}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{log.ip_address || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-500">
            <span>{total} entries · page {page} of {totalPages}</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">← Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
