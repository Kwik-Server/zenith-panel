import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminAPI } from '../../api/client';
import toast from 'react-hot-toast';

export default function VPSCreate() {
  const [step, setStep] = useState(1);
  const [plans, setPlans] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [nodeAvailability, setNodeAvailability] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ plan_id: '', template_id: '', node_id: '', user_id: '', hostname: '', root_password: '', ip_address_ids: [] });
  const [loading, setLoading] = useState(false);
  const [availableIps, setAvailableIps] = useState([]);
  const [showNewUser, setShowNewUser] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', first_name: '', last_name: '' });
  const [creatingUser, setCreatingUser] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [showUserDropdown, setShowUserDropdown] = useState(false);
  const userDropdownRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (userDropdownRef.current && !userDropdownRef.current.contains(e.target)) {
        setShowUserDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    Promise.all([adminAPI.getPlans(), adminAPI.getTemplates(), adminAPI.getNodeAvailability(), adminAPI.getUsers()])
      .then(([p, t, n, u]) => {
        setPlans(p.data.data); setTemplates(t.data.data); setNodeAvailability(n.data.data); setUsers(u.data.data);
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

  const locLabel = (loc) => loc || 'Default';
  const locations = [...new Set(nodeAvailability.map(n => locLabel(n.location)))].sort();

  const eligibleNodes = nodeAvailability
    .filter(n => {
      if (locLabel(n.location) !== selectedLocation) return false;
      if (selectedPlan) {
        if (n.total_ram  > 0 && n.available_ram  < selectedPlan.ram)  return false;
        if (n.total_disk > 0 && n.available_disk < selectedPlan.disk) return false;
      }
      return true;
    })
    .sort((a, b) => b.available_ram - a.available_ram);

  useEffect(() => {
    const selectable = eligibleNodes.filter(n => n.free_ip_count > 0);
    if (selectable.length === 1) {
      update('node_id', selectable[0].id);
    } else if (selectedLocation) {
      update('node_id', '');
    }
  }, [eligibleNodes.map(n => n.id).join(','), selectedLocation]);

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
              <label className="block text-sm font-medium text-slate-700 mb-2">Location</label>
              {locations.length === 0 && <p className="text-sm text-slate-400">No active nodes found.</p>}
              <div className="grid grid-cols-2 gap-2">
                {locations.map(loc => (
                  <button
                    key={loc}
                    type="button"
                    onClick={() => {
                      setSelectedLocation(loc);
                      update('node_id', '');
                      setAvailableIps([]);
                    }}
                    className={`px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-colors text-left ${
                      selectedLocation === loc
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {loc}
                  </button>
                ))}
              </div>
            </div>

            {selectedLocation && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">Node</label>
                {eligibleNodes.length === 0 && (
                  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No nodes in {selectedLocation} have enough resources for this plan.
                  </p>
                )}
                {eligibleNodes.length > 0 && (() => {
                  const selectable = eligibleNodes.filter(n => n.free_ip_count > 0);
                  return (
                    <div className="space-y-2">
                      {eligibleNodes.map((n, idx) => {
                        const noIps    = n.free_ip_count < 1;
                        const isAuto   = selectable.length === 1 && selectable[0].id === n.id;
                        const isMostFree = !noIps && idx === eligibleNodes.findIndex(x => x.free_ip_count > 0);
                        return (
                          <label key={n.id} className={`flex items-center justify-between p-3 border-2 rounded-xl transition-colors ${
                            noIps
                              ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed'
                              : form.node_id == n.id
                                ? 'border-indigo-500 bg-indigo-50 cursor-pointer'
                                : 'border-slate-200 hover:border-slate-300 cursor-pointer'
                          }`}>
                            <input type="radio" name="node" value={n.id} checked={form.node_id == n.id}
                              onChange={() => !noIps && update('node_id', n.id)} disabled={noIps} className="sr-only" />
                            <div>
                              <p className="font-medium text-slate-900">{n.name}</p>
                              <p className="text-xs text-slate-500">
                                {noIps
                                  ? <span className="text-red-500">No free IPs — assign IPs to this node's pool first</span>
                                  : <>
                                      {n.free_ip_count} free IP{n.free_ip_count !== 1 ? 's' : ''}
                                      {n.total_ram  > 0 && ` · ${n.available_ram >= 1024 ? `${Math.floor(n.available_ram / 1024)}GB` : `${n.available_ram}MB`} RAM free`}
                                      {n.total_disk > 0 && ` · ${n.available_disk}GB disk free`}
                                      {(n.total_ram === 0 || n.total_disk === 0) && <span className="ml-1 text-amber-500">(capacity not configured)</span>}
                                    </>
                                }
                              </p>
                            </div>
                            {isAuto   && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">Auto-selected</span>}
                            {isMostFree && !isAuto && <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Most free</span>}
                          </label>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-slate-700">Assign to User</label>
                <button type="button" onClick={() => setShowNewUser(!showNewUser)} className="text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                  {showNewUser ? '← Select existing' : '+ New User'}
                </button>
              </div>
              {!showNewUser ? (
                <div className="relative" ref={userDropdownRef}>
                  <button
                    type="button"
                    onClick={() => setShowUserDropdown(v => !v)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-left flex items-center justify-between focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                  >
                    <span className={form.user_id ? 'text-slate-900' : 'text-slate-400'}>
                      {form.user_id
                        ? (() => { const u = users.find(u => u.id == form.user_id); return u ? `${[u.first_name, u.last_name].filter(Boolean).join(' ') || u.email} (${u.email})` : 'Select user…'; })()
                        : 'Select user…'}
                    </span>
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {showUserDropdown && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg">
                      <div className="p-2 border-b border-slate-100">
                        <input
                          autoFocus
                          type="text"
                          value={userSearch}
                          onChange={e => setUserSearch(e.target.value)}
                          placeholder="Search by name or email…"
                          className="w-full px-3 py-1.5 border border-slate-200 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        />
                      </div>
                      <ul className="max-h-48 overflow-y-auto py-1">
                        {users
                          .filter(u => {
                            const q = userSearch.toLowerCase();
                            const name = [u.first_name, u.last_name].filter(Boolean).join(' ').toLowerCase();
                            return name.includes(q) || u.email.toLowerCase().includes(q);
                          })
                          .map(u => {
                            const name = [u.first_name, u.last_name].filter(Boolean).join(' ');
                            return (
                              <li
                                key={u.id}
                                onClick={() => { update('user_id', u.id); setShowUserDropdown(false); setUserSearch(''); }}
                                className={`px-3 py-2 text-sm cursor-pointer hover:bg-indigo-50 flex flex-col ${form.user_id == u.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-800'}`}
                              >
                                <span className="font-medium">{name || u.email}</span>
                                {name && <span className="text-xs text-slate-400">{u.email}</span>}
                              </li>
                            );
                          })}
                        {users.filter(u => {
                          const q = userSearch.toLowerCase();
                          const name = [u.first_name, u.last_name].filter(Boolean).join(' ').toLowerCase();
                          return name.includes(q) || u.email.toLowerCase().includes(q);
                        }).length === 0 && (
                          <li className="px-3 py-2 text-sm text-slate-400">No users found</li>
                        )}
                      </ul>
                    </div>
                  )}
                </div>
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
              <button onClick={() => setStep(4)} disabled={!form.hostname || !form.root_password || !form.node_id || !form.user_id || (nodeAvailability.find(n => n.id == form.node_id)?.free_ip_count < 1)} className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium disabled:opacity-40">Review →</button>
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
                ['Node', nodeAvailability.find(n => n.id == form.node_id)?.name],
                ['User', (() => { const u = users.find(u => u.id == form.user_id); if (!u) return '—'; const name = [u.first_name, u.last_name].filter(Boolean).join(' '); return name ? `${name} (${u.email})` : u.email; })()],
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
