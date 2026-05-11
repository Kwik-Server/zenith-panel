import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';

const STATUS = { pending:'bg-slate-100 text-slate-600', running:'bg-indigo-100 text-indigo-700', completed:'bg-green-100 text-green-700', failed:'bg-red-100 text-red-700', cancelled:'bg-slate-100 text-slate-400' };

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState('');

  const load = () => adminAPI.getTasks(filter ? { status: filter } : {}).then(r => setTasks(r.data.data));
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [filter]);

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Task Queue</h1>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
          <option value="">All statuses</option>
          {['pending','running','completed','failed','cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
            <tr>{['Type','VPS','Status','Output','Created'].map(h => <th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.map(t => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">{t.type}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{t.vps_hostname || '—'}</td>
                <td className="px-4 py-3"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS[t.status]}`}>{t.status}</span></td>
                <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{t.output || '—'}</td>
                <td className="px-4 py-3 text-xs text-slate-400">{new Date(t.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {!tasks.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">No tasks</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
