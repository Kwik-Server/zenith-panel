import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api/client';
import { Plus, Download, Search, Play, Square, RotateCcw, Trash2 } from 'lucide-react';
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

function ImportModal({ onClose, onDone }) {
  const [nodes, setNodes]           = useState([]);
  const [plans, setPlans]           = useState([]);
  const [users, setUsers]           = useState([]);
  const [availableIps, setAvailableIps] = useState([]);
  const [form, setForm]             = useState({ proxmox_vmid: '', hostname: '', node_id: '', plan_id: '', user_id: '', ip_address_id: '', whmcs_service_id: '', notes: '' });
  const [userSearch, setUserSearch] = useState('');
  const [showUserDrop, setShowUserDrop] = useState(false);
  const [loading, setLoading]       = useState(false);
  const userDropRef                 = useRef(null);

  useEffect(() => {
    Promise.all([adminAPI.getNodes(), adminAPI.getPlans(), adminAPI.getUsers()])
      .then(([n, p, u]) => { setNodes(n.data.data); setPlans(p.data.data); setUsers(u.data.data); });
    const handler = (e) => { if (userDropRef.current && !userDropRef.current.contains(e.target)) setShowUserDrop(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (form.node_id) {
      adminAPI.getAvailableIps(form.node_id).then(r => setAvailableIps(r.data.data)).catch(() => setAvailableIps([]));
    } else {
      setAvailableIps([]);
    }
  }, [form.node_id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.proxmox_vmid || !form.hostname || !form.node_id || !form.plan_id || !form.user_id) {
      toast.error('VMID, hostname, node, plan and user are required');
      return;
    }
    setLoading(true);
    try {
      const payload = {
        proxmox_vmid:    parseInt(form.proxmox_vmid),
        hostname:        form.hostname,
        node_id:         form.node_id,
        plan_id:         form.plan_id,
        user_id:         form.user_id,
        ip_address_id:   form.ip_address_id || undefined,
        whmcs_service_id:form.whmcs_service_id || undefined,
        notes:           form.notes || undefined,
      };
      await adminAPI.importVps(payload);
      toast.success('VPS imported successfully');
      onDone();
    } catch (e) {
      toast.error(e.response?.data?.error || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const selectedUser = users.find(u => u.id == form.user_id);
  const filteredUsers = users.filter(u => {
    const q = userSearch.toLowerCase();
    const name = [u.first_name, u.last_name].filter(Boolean).join(' ').toLowerCase();
    return name.includes(q) || u.email.toLowerCase().includes(q);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Import Existing VPS</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <p className="text-sm text-slate-500">Register a VPS that was manually created on Proxmox. No provisioning is done — Zenith will detect the current status automatically.</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Proxmox VMID *</label>
            <input type="number" min="100" value={form.proxmox_vmid} onChange={e => set('proxmox_vmid', e.target.value)} placeholder="e.g. 101"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Hostname *</label>
            <input type="text" value={form.hostname} onChange={e => set('hostname', e.target.value)} placeholder="vps01.example.com"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Node *</label>
          <select value={form.node_id} onChange={e => set('node_id', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
            <option value="">Select node…</option>
            {nodes.filter(n => n.is_active).map(n => <option key={n.id} value={n.id}>{n.name} ({n.proxmox_node})</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Plan *</label>
          <select value={form.plan_id} onChange={e => set('plan_id', e.target.value)}
            className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
            <option value="">Select plan…</option>
            {plans.filter(p => p.is_active).map(p => <option key={p.id} value={p.id}>{p.name} — {p.cpu} vCPU / {p.ram >= 1024 ? `${p.ram/1024}GB` : `${p.ram}MB`} / {p.disk}GB</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Assign to User *</label>
          <div className="relative" ref={userDropRef}>
            <button type="button" onClick={() => setShowUserDrop(v => !v)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-left flex items-center justify-between focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
              <span className={selectedUser ? 'text-slate-900' : 'text-slate-400'}>
                {selectedUser
                  ? `${[selectedUser.first_name, selectedUser.last_name].filter(Boolean).join(' ') || selectedUser.email} (${selectedUser.email})`
                  : 'Select user…'}
              </span>
              <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {showUserDrop && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg">
                <div className="p-2 border-b border-slate-100">
                  <input autoFocus type="text" value={userSearch} onChange={e => setUserSearch(e.target.value)} placeholder="Search by name or email…"
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
                <ul className="max-h-40 overflow-y-auto py-1">
                  {filteredUsers.map(u => {
                    const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
                    return (
                      <li key={u.id} onClick={() => { set('user_id', u.id); setShowUserDrop(false); setUserSearch(''); }}
                        className={`px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 flex flex-col ${form.user_id == u.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-800'}`}>
                        <span className="font-medium">{name || u.email}</span>
                        {name && <span className="text-xs text-slate-400">{u.email}</span>}
                      </li>
                    );
                  })}
                  {filteredUsers.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No users found</li>}
                </ul>
              </div>
            )}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">Assign IP from Pool <span className="text-slate-400 font-normal">(optional)</span></label>
          {!form.node_id && <p className="text-xs text-slate-400">Select a node first</p>}
          {form.node_id && (
            <select value={form.ip_address_id} onChange={e => set('ip_address_id', e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
              <option value="">None / already configured outside Zenith</option>
              {availableIps.map(ip => <option key={ip.id} value={ip.id}>{ip.ip_address} ({ip.pool_name})</option>)}
            </select>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">WHMCS Service ID <span className="text-slate-400 font-normal">(optional)</span></label>
            <input type="text" value={form.whmcs_service_id} onChange={e => set('whmcs_service_id', e.target.value)} placeholder="e.g. 42"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
            <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="e.g. Manually created"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={submit} disabled={loading}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-40">
            {loading ? 'Importing…' : 'Import VPS'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function VPSList() {
  const [vps, setVps] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(null);
  const [showImport, setShowImport] = useState(false);
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
      {showImport && <ImportModal onClose={() => setShowImport(false)} onDone={() => { setShowImport(false); load(); }} />}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Virtual Servers</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)} className="flex items-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Download size={16} /> Import VPS
          </button>
          <Link to="/admin/vps/create" className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus size={16} /> New VPS
          </Link>
        </div>
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
