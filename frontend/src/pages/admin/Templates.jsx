import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import { Plus, Trash2, Edit2, Download } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Templates() {
  const [templates, setTemplates] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const [browseNode, setBrowseNode] = useState('');
  const [available, setAvailable] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'kvm', proxmox_template_id: '', os_family: '', description: '' });
  const [editing, setEditing] = useState(null);

  const load = () => adminAPI.getTemplates().then(r => setTemplates(r.data.data));
  useEffect(() => { load(); adminAPI.getNodes().then(r => setNodes(r.data.data)); }, []);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    try {
      if (editing) await adminAPI.updateTemplate(editing, form);
      else await adminAPI.createTemplate(form);
      toast.success(editing ? 'Updated' : 'Template added');
      setShowModal(false); setEditing(null);
      setForm({ name: '', type: 'kvm', proxmox_template_id: '', os_family: '', description: '' });
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const del = async (id, name) => {
    if (!window.confirm(`Delete template ${name}?`)) return;
    try { await adminAPI.deleteTemplate(id); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const edit = (t) => {
    setForm({ name: t.name, type: t.type, proxmox_template_id: t.proxmox_template_id || '', os_family: t.os_family || '', description: t.description || '' });
    setEditing(t.id); setShowModal(true);
  };

  const browse = async () => {
    if (!browseNode) return;
    try {
      const r = await adminAPI.proxmoxTemplates(browseNode);
      setAvailable(r.data.data || []); setShowBrowse(true);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed to fetch templates'); }
  };

  const importTemplate = async (tpl) => {
    setForm({ name: tpl.name || tpl.package, type: 'lxc', proxmox_template_id: tpl.template || tpl.volid || '', os_family: tpl.os || '', description: tpl.description || '' });
    setShowBrowse(false); setShowModal(true);
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">OS Templates</h1>
        <div className="flex gap-2">
          <button onClick={() => { setShowModal(true); setEditing(null); }} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <Plus size={16} /> Add Template
          </button>
        </div>
      </div>

      {/* Browse Proxmox LXC templates */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <p className="text-sm font-medium text-blue-800 mb-2">Browse LXC Templates from Proxmox</p>
        <div className="flex gap-2">
          <select value={browseNode} onChange={e => setBrowseNode(e.target.value)} className="flex-1 px-3 py-2 border border-blue-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white">
            <option value="">Select a node…</option>
            {nodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
          </select>
          <button onClick={browse} disabled={!browseNode} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium disabled:opacity-40">Browse</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
            <tr>{['Name','Type','Proxmox Ref','OS','Status','Actions'].map(h => <th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {templates.map(t => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-sm text-slate-900">{t.name}</td>
                <td className="px-4 py-3"><span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs font-mono">{t.type}</span></td>
                <td className="px-4 py-3 text-sm font-mono text-slate-600 max-w-xs truncate">{t.proxmox_template_id || <span className="text-amber-500 italic">Not set</span>}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{t.os_family}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>{t.is_active ? 'Active' : 'Inactive'}</span></td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => edit(t)} className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700"><Edit2 size={14} /></button>
                    <button onClick={() => del(t.id, t.name)} className="p-1.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{editing ? 'Edit Template' : 'Add Template'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input value={form.name} onChange={e => update('name', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select value={form.type} onChange={e => update('type', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="kvm">KVM</option>
                  <option value="lxc">LXC</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {form.type === 'kvm' ? 'Proxmox VMID (e.g. 9000)' : 'Proxmox volid (e.g. local:vztmpl/ubuntu-22.04...)'}
                </label>
                <input value={form.proxmox_template_id} onChange={e => update('proxmox_template_id', e.target.value)}
                  placeholder={form.type === 'kvm' ? '9000' : 'local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst'}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">OS Family</label>
                <input value={form.os_family} onChange={e => update('os_family', e.target.value)} placeholder="ubuntu, debian, centos…" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              {form.type === 'kvm' && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  For KVM: create a cloud-init enabled VM template in Proxmox, note its VMID, and enter it above. Zenith will clone this template for each new VPS.
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => { setShowModal(false); setEditing(null); }} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={save} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}

      {showBrowse && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-2xl max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold text-slate-900">Available LXC Templates</h2>
              <button onClick={() => setShowBrowse(false)} className="text-slate-400 hover:text-slate-600 text-2xl leading-none">×</button>
            </div>
            <div className="overflow-y-auto flex-1 space-y-2">
              {available.map((t, i) => (
                <div key={i} className="flex items-center justify-between p-3 border border-slate-200 rounded-xl hover:bg-slate-50">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{t.name || t.package}</p>
                    <p className="text-xs text-slate-400 font-mono">{t.template || t.volid}</p>
                  </div>
                  <button onClick={() => importTemplate(t)} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium">
                    <Download size={13} /> Import
                  </button>
                </div>
              ))}
              {!available.length && <p className="text-center text-slate-400 py-8">No templates found on this node</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
