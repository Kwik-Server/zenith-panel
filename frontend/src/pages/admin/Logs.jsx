import { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import Card from '../../components/ui/Card';
import { formatDistanceToNow } from 'date-fns';

export default function Logs() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const limit = 50;

  const load = async () => {
    setLoading(true);
    try {
      const res = await adminAPI.getLogs({ page, limit, action: actionFilter || undefined });
      setLogs(res.data.data.logs);
      setTotal(res.data.data.total);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, [page, actionFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>
          <p className="text-slate-500 text-sm mt-0.5">{total} total log entries</p>
        </div>
        <input value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
          placeholder="Filter by action..."
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 w-48" />
      </div>

      <Card noPadding>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left text-slate-500">
              <th className="px-4 py-3 font-medium">Time</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Action</th>
              <th className="px-4 py-3 font-medium">Resource</th>
              <th className="px-4 py-3 font-medium">IP Address</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(10)].map((_, i) => (
              <tr key={i}>{[...Array(5)].map((_, j) => <td key={j} className="px-4 py-4"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>
            )) : logs.map((log) => (
              <tr key={log.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{formatDistanceToNow(new Date(log.created_at), { addSuffix: true })}</td>
                <td className="px-4 py-3 text-slate-600 text-xs">{log.user_email || 'System'}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{log.action}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{log.resource_type || '—'} {log.resource_id ? `#${log.resource_id}` : ''}</td>
                <td className="px-4 py-3 text-slate-400 text-xs font-mono">{log.ip_address || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <p className="text-sm text-slate-500">Page {page} of {Math.ceil(total/limit)}</p>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
                className="px-3 py-1 text-sm border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50">← Prev</button>
              <button onClick={() => setPage(p => p+1)} disabled={page * limit >= total}
                className="px-3 py-1 text-sm border border-slate-200 rounded-lg disabled:opacity-50 hover:bg-slate-50">Next →</button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
