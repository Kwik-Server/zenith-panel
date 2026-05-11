import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import { Plus, Wifi, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

const EMPTY_FORM = { name: '', hostname: '', port: 8006, api_token_id: '', api_token_secret: '', proxmox_node: 'pve', storage: 'local', backup_storage: 'local', type: 'both', location: '', total_cpu: 0, total_ram: 0, total_disk: 0 };

export default function Nodes() {
  const [nodes, setNodes] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [testing, setTesting] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = () => adminAPI.getNodes().then(r => setNodes(r.data.data));
  useEffect(() => { load(); }, []);

  const update = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const openAdd = () => { setForm(EMPTY_FORM); setEditingId(null); setShowModal(true); };
  const openEdit = (n) => { setForm({ ...n, api_token_secret: '' }); setEditingId(n.id); setShowModal(true); };

  const save = async () => {
    try {
      if (editingId) {
        await adminAPI.updateNode(editingId, form);
        toast.success('Node updated');
      } else {
        await adminAPI.createNode(form);
        toast.success('Node added');
      }
      setShowModal(false);
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const testConn = async (id) => {
    setTesting(id);
    try { await adminAPI.testNode(id); toast.success('Connection successful'); }
    catch (e) { toast.error(e.response?.data?.error || 'Connection failed'); }
    finally { setTesting(null); }
  };

  const del = async (id, name) => {
    if (!window.confirm(`Remove node ${name}?`)) return;
    try { await adminAPI.deleteNode(id); toast.success('Node removed'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Nodes</h1>
        <button onClick={openAdd} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
          <Plus size={16} /> Add Node
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {nodes.map(n => (
          <div key={n.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-slate-900">{n.name}</h3>
                <p className="text-sm text-slate-500">{n.hostname}:{n.port}</p>
              </div>
              <span className={`w-2.5 h-2.5 rounded-full mt-1.5 ${n.is_active ? 'bg-green-400' : 'bg-red-400'}`} />
            </div>
            <div className="space-y-1 text-xs text-slate-500 mb-4">
              <p>PVE Node: <span className="font-mono text-slate-700">{n.proxmox_node}</span></p>
              <p>Storage: <span className="font-mono text-slate-700">{n.storage}</span></p>
              <p>Backup: <span className="font-mono text-slate-700">{n.backup_storage}</span></p>
              <p>Type: {n.type.toUpperCase()} · {n.location}</p>
              <p>{n.total_cpu} CPU · {n.total_ram >= 1024 ? n.total_ram/1024 + 'GB' : n.total_ram + 'MB'} RAM · {n.total_disk}GB Disk</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => testConn(n.id)} disabled={testing === n.id}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                <Wifi size={13} /> {testing === n.id ? 'Testing…' : 'Test API'}
              </button>
              <button onClick={() => openEdit(n)} className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-indigo-600 hover:border-indigo-200">
                <Pencil size={14} />
              </button>
              <button onClick={() => del(n.id, n.name)} className="p-1.5 border border-slate-200 rounded-lg text-slate-400 hover:text-red-600 hover:border-red-200">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
        {!nodes.length && <div className="col-span-3 text-center text-slate-400 py-12">No nodes yet. Add your first Proxmox server.</div>}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-5">{editingId ? 'Edit Node' : 'Add Proxmox Node'}</h2>
            <div className="space-y-4">
              {[
                { label: 'Node Name',             key: 'name',              placeholder: 'NYC-Node-01' },
                { label: 'Proxmox Hostname / IP', key: 'hostname',          placeholder: 'node1.example.com or 192.168.1.10' },
                { label: 'API Port',              key: 'port',              placeholder: '8006', type: 'number' },
                { label: 'API Token ID',          key: 'api_token_id',      placeholder: 'root@pam!zenith' },
                { label: 'API Token Secret',      key: 'api_token_secret',  placeholder: editingId ? 'Leave blank to keep existing' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', type: 'password' },
                { label: 'PVE Node Name',         key: 'proxmox_node',      placeholder: 'pve' },
                { label: 'VM Storage',            key: 'storage',           placeholder: 'local' },
                { label: 'Backup Storage',        key: 'backup_storage',    placeholder: 'local' },
                { label: 'Location',              key: 'location',          placeholder: 'New York, USA' },
                { label: 'Total CPU Cores',       key: 'total_cpu',         placeholder: '32', type: 'number' },
                { label: 'Total RAM (MB)',         key: 'total_ram',         placeholder: '65536', type: 'number' },
                { label: 'Total Disk (GB)',        key: 'total_disk',        placeholder: '2000', type: 'number' },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
                  <input type={type || 'text'} value={form[key]} onChange={e => update(key, e.target.value)} placeholder={placeholder}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none" />
                </div>
              ))}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                <select value={form.type} onChange={e => update('type', e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="both">KVM + LXC</option>
                  <option value="kvm">KVM only</option>
                  <option value="lxc">LXC only</option>
                </select>
              </div>
              {!editingId && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                  <strong>How to create a Proxmox API token:</strong><br />
                  Proxmox UI → Datacenter → Permissions → API Tokens → Add<br />
                  User: root@pam · Token ID: zenith · Uncheck "Privilege Separation"
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={save} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
                {editingId ? 'Save Changes' : 'Add Node'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
