import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api/client';
import toast from 'react-hot-toast';

export default function VPSCreate() {
  const [step, setStep] = useState(1);
  const [plans, setPlans] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ plan_id: '', template_id: '', node_id: '', user_id: '', hostname: '', root_password: '', ip_address_ids: [] });
  const [loading, setLoading] = useState(false);
  const [availableIps, setAvailableIps] = useState([]);
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', first_name: '', last_name: '' });
  const [creatingUser, setCreatingUser] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.all([adminAPI.getPlans(), adminAPI.getTemplates(), adminAPI.getNodes(), adminAPI.getUsers()])
      .then(([p, t, n, u]) => {
        setPlans(p.data.data); setTemplates(t.data.data); setNodes(n.data.data); setUsers(u.data.data);
      });
  }, []);

  useEffect(() => {
    if (form.node_id) {
      adminAPI.getAvailableIps(form.node_id).then(r => setAvailableIps(r.data.data)).catch(() => setAvailableIps([]));
    } else {
      setAvailableIps([]);
    }
  }, [form.node_id]);

  const toggleIp = (ipId) => {
    setForm(f => ({
      ...f,
      ip_address_ids: f.ip_address_ids.includes(ipId)
        ? f.ip_address_ids.filter(id => id !== ipId)
        : [...f.ip_address_ids, ipId]
    }));
  };

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const createNewUser = async () => {
    if (!newUser.email || !newUser.password) { toast.error('Email and password required'); return; }
    setCreatingUser(true);
    try {
      const r = await adminAPI.createUser(newUser);
      const createdId = r.data.data.id;
      const updatedUsers = await adminAPI.getUsers();
      setUsers(updatedUsers.data.data);
      update('user_id', createdId);
      setShowNewUser(false);
      setNewUser({ email: '', password: '', first_name: '', last_name: '' });
      toast.success('User created and selected');
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to create user'); }
    finally { setCreatingUser(false); }
  };

  const submit = async () => {
    setLoading(true);
    try {
      await adminAPI.createVps(form);
      toast.success('VPS creation queued');
      navigate('/admin/vps');
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setLoading(false); }
  };

  const selectedPlan = plans.find(p => p.id == form.plan_id);
  const selectedTpl  = templates.find(t => t.id == form.template_id);

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">Create VPS</h1>
      <div className="flex items-center gap-2 mb-8">
        {['Plan','Template','Configure','Review'].map((s, i) => (
          <React.Fragment key={s}>
            <div className={`flex items-center gap-2 text-sm font-medium ${step > i ? 'text-indigo-600' : step === i+1 ? 'text-slate-900' : 'text-slate-400'}`}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${step > i ? 'bg-indigo-600 text-white' : step === i+1 ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>{i+1}</span>
              {s}
            </div>
            {i < 3 && <div className="flex-1 h-px bg-slate-200" />}
          </React.Fragment>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        {step === 1 && (
          <div>
            <h2 className="font-semibold text-slate-900 mb-4">Select a Plan</h2>
            <div className="grid grid-cols-1 gap-3">
              {plans.filter(p => p.is_active).map(p => (
                <label key={p.id} className={`flex items-center justify-between p-4 border-2 rounded-xl cursor-pointer transition-colors ${form.plan_id == p.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" name="plan" value={p.id} checked={form.plan_id == p.id} onChange={() => update('plan_id', p.id)} className="sr-only" />
                  <div>
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    <p className="text-sm text-slate-500">{p.cpu} vCPU · {p.ram >= 1024 ? `${p.ram/1024}GB` : `${p.ram}MB`} RAM · {p.disk}GB Disk</p>
                  </div>
                  <p className="text-lg font-bold text-indigo-600">${p.price}<span className="text-sm font-normal text-slate-400">/mo</span></p>
                </label>
              ))}
            </div>
            <button onClick={() => setStep(2)} disabled={!form.plan_id} className="mt-6 bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40">Next →</button>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="font-semibold text-slate-900 mb-4">Select OS Template</h2>
            <div className="grid grid-cols-1 gap-3">
              {templates.filter(t => t.is_active && (!selectedPlan || t.type === selectedPlan.type)).map(t => (
                <label key={t.id} className={`flex items-center gap-3 p-4 border-2 rounded-xl cursor-pointer transition-colors ${form.template_id == t.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" name="tpl" value={t.id} checked={form.template_id == t.id} onChange={() => update('template_id', t.id)} className="sr-only" />
                  <div>
                    <p className="font-semibold text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-400">{t.type.toUpperCase()} · {t.os_family} · Proxmox ref: {t.proxmox_template_id || 'not set'}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setStep(1)} className="text-slate-600 px-4 py-2 rounded-lg border border-slate-200 text-sm">← Back</button>
              <button onClick={() => setStep(3)} disabled={!form.template_id} className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40">Next →</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="font-semibold text-slate-900 mb-4">Configure</h2>
            {[
              { label: 'Hostname', key: 'hostname', placeholder: 'vps01.example.com' },
              { label: 'Root Password', key: 'root_password', placeholder: 'Min 8 characters', type: 'password' },
            ].map(({ label, key, placeholder, type }) => (
              <div key={key}>
                <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
                <input type={type || 'text'} value={form[key]} onChange={e => update(key, e.target.value)} placeholder={placeholder}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
            ))}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Node</label>
              <select value={form.node_id} onChange={e => update('node_id', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="">Select node…</option>
                {nodes.filter(n => n.is_active).map(n => <option key={n.id} value={n.id}>{n.name} ({n.location})</option>)}
              </select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">Assign to User</label>
                <button type="button" onClick={() => setShowNewUser(!showNewUser)} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  {showNewUser ? '← Select existing' : '+ New User'}
                </button>
              </div>
              {!showNewUser ? (
                <select value={form.user_id} onChange={e => update('user_id', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="">Select user…</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.email}</option>)}
                </select>
              ) : (
                <div className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">First Name</label>
                      <input type="text" value={newUser.first_name} onChange={e => setNewUser(u => ({...u, first_name: e.target.value}))} placeholder="John"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-slate-600 mb-1">Last Name</label>
                      <input type="text" value={newUser.last_name} onChange={e => setNewUser(u => ({...u, last_name: e.target.value}))} placeholder="Doe"
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Email *</label>
                    <input type="email" value={newUser.email} onChange={e => setNewUser(u => ({...u, email: e.target.value}))} placeholder="client@example.com"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Password *</label>
                    <input type="password" value={newUser.password} onChange={e => setNewUser(u => ({...u, password: e.target.value}))} placeholder="Min 8 characters"
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white" />
                  </div>
                  <button onClick={createNewUser} disabled={creatingUser} className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-40">
                    {creatingUser ? 'Creating…' : 'Create & Select User'}
                  </button>
                </div>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                IP Addresses
                <span className="ml-2 text-xs text-slate-400 font-normal">First selected = primary. Leave empty to auto-assign.</span>
              </label>
              {!form.node_id && <p className="text-sm text-slate-400">Select a node first to see available IPs</p>}
              {form.node_id && availableIps.length === 0 && <p className="text-sm text-slate-400">No available IPs in pool for this node</p>}
              {availableIps.length > 0 && (
                <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-48 overflow-y-auto">
                  {availableIps.map((ip, idx) => (
                    <label key={ip.id} className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 ${form.ip_address_ids.includes(ip.id) ? 'bg-indigo-50' : ''}`}>
                      <input type="checkbox" checked={form.ip_address_ids.includes(ip.id)} onChange={() => toggleIp(ip.id)} className="rounded" />
                      <span className="font-mono text-sm text-slate-900">{ip.ip_address}</span>
                      {form.ip_address_ids[0] === ip.id && <span className="text-xs bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-medium">primary</span>}
                      {form.ip_address_ids.indexOf(ip.id) > 0 && <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">additional</span>}
                      <span className="text-xs text-slate-400 ml-auto">{ip.pool_name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-2">
              <button onClick={() => setStep(2)} className="text-slate-600 px-4 py-2 rounded-lg border border-slate-200 text-sm">← Back</button>
              <button onClick={() => setStep(4)} disabled={!form.hostname || !form.root_password || !form.node_id || !form.user_id} className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40">Review →</button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="font-semibold text-slate-900 mb-4">Review & Create</h2>
            <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm mb-6">
              {[
                ['Plan', selectedPlan?.name],
                ['Template', selectedTpl?.name],
                ['Hostname', form.hostname],
                ['Node', nodes.find(n => n.id == form.node_id)?.name],
                ['User', users.find(u => u.id == form.user_id)?.email],
                ['IPs', form.ip_address_ids.length > 0
                  ? availableIps.filter(i => form.ip_address_ids.includes(i.id)).map(i => i.ip_address).join(', ')
                  : 'Auto-assign'],
              ].map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-medium text-slate-900">{v}</span></div>)}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className="text-slate-600 px-4 py-2 rounded-lg border border-slate-200 text-sm">← Back</button>
              <button onClick={submit} disabled={loading} className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40">
                {loading ? 'Creating…' : 'Create VPS'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
