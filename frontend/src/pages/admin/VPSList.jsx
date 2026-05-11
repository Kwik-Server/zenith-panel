import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api/client';
import { Plus, Search, Play, Square, RotateCcw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS = { running: 'bg-green-100 text-green-700', stopped: 'bg-slate-100 text-slate-600', suspended: 'bg-amber-100 text-amber-700', creating: 'bg-indigo-100 text-indigo-700', error: 'bg-red-100 text-red-700' };

function OsIcon({ name }) {
  const n = (name || '').toLowerCase();
  let icon = null;
  if      (n.includes('ubuntu'))  icon = 'ubuntu';
  else if (n.includes('debian'))  icon = 'debian';
  else if (n.includes('alma'))    icon = 'almalinux';
  else if (n.includes('centos'))  icon = 'centos';
  else if (n.includes('fedora'))  icon = 'fedora';
  else if (n.includes('windows')) icon = 'windows';
  else if (n.includes('rocky'))   icon = 'rockylinux';
  else if (n.includes('arch'))    icon = 'archlinux';

  if (!icon) return (
    <span title={name} className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 shrink-0">
      <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-500" fill="currentColor"><path d="M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5A2.5 2.5 0 0 0 10.5 1 2.5 2.5 0 0 0 8 3.5V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.5 0 2.7 1.2 2.7 2.7S5 16.2 3.5 16.2H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.5 1.2-2.7 2.7-2.7 1.5 0 2.7 1.2 2.7 2.7V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 2.5-2.5 2.5 2.5 0 0 0-2.5-2.5z"/></svg>
    </span>
  );

  return (
    <img
      src={`https://cdn.simpleicons.org/${icon}`}
      alt={name}
      title={name}
      className="w-8 h-8 rounded-lg p-1.5 bg-slate-50 border border-slate-100 object-contain shrink-0"
      onError={e => { e.target.style.display = 'none'; }}
    />
  );
}

export default function VPSList() {
  const [vps, setVps] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const navigate = useNavigate();

  const load = () => adminAPI.getVps().then(r => { setVps(r.data.data.vps || []); setLoading(false); });

  useEffect(() => { load(); }, []);

  const action = async (id, a, label) => {
    try { await adminAPI.vpsAction(id, a); toast.success(`${label} queued`); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const del = async (v) => {
    if (!window.confirm(`Delete ${v.hostname}? This is irreversible.`)) return;
    setDeleting(v.id);
    try { await adminAPI.deleteVps(v.id); toast.success('Deletion queued'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setDeleting(null); }
  };

  const filtered = vps.filter(v => v.hostname?.toLowerCase().includes(search.toLowerCase()) || v.ip_address?.includes(search) || v.user_email?.toLowerCase().includes(search.toLowerCase()));

  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Virtual Servers</h1>
        <Link to="/admin/vps/create" className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Plus size={16} /> New VPS
        </Link>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by hostname, IP or user…"
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
            <tr>
              {['Hostname','IP','User','Node','Plan','Status','Actions'].map(h => <th key={h} className="px-4 py-3 text-left">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map(v => (
              <tr key={v.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <OsIcon name={v.template_name} />
                    <div>
                      <Link to={`/admin/vps/${v.id}`} className="text-indigo-600 hover:text-indigo-800 font-medium text-sm">{v.hostname}</Link>
                      <p className="text-xs text-slate-400">ID: {v.proxmox_vmid || 'pending'}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-slate-600">{v.ip_address || '—'}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{v.user_email}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{v.node_name}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{v.plan_name}</td>
                <td className="px-4 py-3">
                  <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS[v.status] || 'bg-slate-100 text-slate-600'}`}>{v.status}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <button onClick={() => action(v.id, 'start', 'Start')} title="Start" className="p-1.5 hover:bg-green-100 rounded text-slate-400 hover:text-green-600"><Play size={14} /></button>
                    <button onClick={() => action(v.id, 'stop', 'Stop')} title="Stop" className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-600"><Square size={14} /></button>
                    <button onClick={() => action(v.id, 'restart', 'Restart')} title="Restart" className="p-1.5 hover:bg-blue-100 rounded text-slate-400 hover:text-blue-600"><RotateCcw size={14} /></button>
                    <button onClick={() => del(v)} disabled={deleting === v.id} title="Delete" className="p-1.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-sm">No VPS found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
