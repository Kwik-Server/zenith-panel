import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Plans() {
  const [plans, setPlans] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name:'', cpu: 1, ram: 1024, disk: 25, bandwidth: 1000, price: 5, type: 'kvm' });

  const load = () => adminAPI.getPlans().then(r => setPlans(r.data.data));
  useEffect(() => { load(); }, []);
  const update = (k,v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    try {
      if (editing) await adminAPI.updatePlan(editing, form);
      else await adminAPI.createPlan(form);
      toast.success(editing ? 'Updated' : 'Plan created');
      setShowModal(false); setEditing(null); load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const del = async (id, name) => {
    if (!window.confirm(`Delete plan ${name}?`)) return;
    try { await adminAPI.deletePlan(id); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'In use by existing VPS'); }
  };

  const edit = (p) => { setForm({ name: p.name, cpu: p.cpu, ram: p.ram, disk: p.disk, bandwidth: p.bandwidth, price: p.price, type: p.type }); setEditing(p.id); setShowModal(true); };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Plans</h1>
        <button onClick={() => { setShowModal(true); setEditing(null); setForm({ name:'', cpu:1, ram:1024, disk:25, bandwidth:1000, price:5, type:'kvm' }); }}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> New Plan
        </button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {plans.map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-bold text-slate-900">{p.name}</h3>
              <span className="text-xs px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded font-medium">{p.type.toUpperCase()}</span>
            </div>
            <p className="text-2xl font-bold text-indigo-600 mb-3">${p.price}<span className="text-sm font-normal text-slate-400">/mo</span></p>
            <div className="space-y-1 text-sm text-slate-600 mb-4">
              <p>{p.cpu} vCPU · {p.ram >= 1024 ? `${p.ram/1024}GB` : `${p.ram}MB`} RAM</p>
              <p>{p.disk}GB NVMe · {p.bandwidth ? `${p.bandwidth}GB BW` : 'Unlimited'}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => edit(p)} className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50"><Edit2 size={12}/>Edit</button>
              <button onClick={() => del(p.id, p.name)} className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-red-600"><Trash2 size={14}/></button>
            </div>
          </div>
        ))}
      </div>
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{editing ? 'Edit Plan' : 'New Plan'}</h2>
            <div className="space-y-3">
              {[['Name','name','text'],['vCPU','cpu','number'],['RAM (MB)','ram','number'],['Disk (GB)','disk','number'],['Bandwidth (GB)','bandwidth','number'],['Price ($/mo)','price','number']].map(([l,k,t]) => (
                <div key={k}>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{l}</label>
                  <input type={t} value={form[k]} onChange={e => update(k, t === 'number' ? Number(e.target.value) : e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select value={form.type} onChange={e => update('type', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="kvm">KVM</option><option value="lxc">LXC</option>
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={save} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
