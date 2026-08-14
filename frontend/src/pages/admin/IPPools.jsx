import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import { Plus, ChevronDown, ChevronUp, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

export default function IPPools() {
  const [pools, setPools] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [poolDetail, setPoolDetail] = useState({});
  const [showPool, setShowPool] = useState(false);
  const [showIps, setShowIps] = useState(null);
  const [editPool, setEditPool] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [poolForm, setPoolForm] = useState({ name:'', gateway:'', netmask:'', leaseweb_api_key:'', node_id:'' });
  const [ipsText, setIpsText] = useState('');
  const [nodes, setNodes] = useState([]);

  const load = () => adminAPI.getIpPools().then(r => setPools(r.data.data));
  useEffect(() => { load(); adminAPI.getNodes().then(r => setNodes(r.data.data)); }, []);

  const toggle = async (id) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!poolDetail[id]) {
      const r = await adminAPI.getPool(id);
      setPoolDetail(d => ({ ...d, [id]: r.data.data }));
    }
  };

  const openEdit = (p) => { setEditPool(p.id); setEditForm({ name: p.name, gateway: p.gateway || '', netmask: p.netmask || '', node_id: p.node_id || '', leaseweb_api_key: p.leaseweb_api_key || '' }); };
  const savePool = async () => {
    try { await adminAPI.updatePool(editPool, editForm); toast.success('Pool updated'); setEditPool(null); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const createPool = async () => {
    if (!poolForm.node_id) { toast.error('Please select a node'); return; }
    try { await adminAPI.createPool(poolForm); toast.success('Pool created'); setShowPool(false); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const addIps = async (poolId) => {
    const ips = ipsText.split('\n').map(s => s.trim()).filter(Boolean);
    if (!ips.length) return;
    try {
      const r = await adminAPI.addIps(poolId, { ip_addresses: ips });
      toast.success(r.data.message || 'IPs added');
      setShowIps(null); setIpsText('');
      const pool = await adminAPI.getPool(poolId);
      setPoolDetail(d => ({ ...d, [poolId]: pool.data.data }));
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const editMac = async (poolId, ip) => {
    const mac = window.prompt(
      `MAC address for ${ip.ip_address}\n(needed for OneProvider IPs — leave empty for automatic MAC, e.g. Leaseweb)`,
      ip.mac_address || ''
    );
    if (mac === null) return; // cancelled
    try {
      await adminAPI.updateIpMac(poolId, ip.id, mac.trim());
      toast.success(mac.trim() ? 'MAC saved' : 'MAC cleared');
      const r = await adminAPI.getPool(poolId);
      setPoolDetail(d => ({ ...d, [poolId]: r.data.data }));
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const removeIp = async (poolId, ipId, ipAddress) => {
    if (!window.confirm(`Remove IP ${ipAddress} from pool?`)) return;
    try {
      await adminAPI.removeIp(poolId, ipId);
      toast.success(`${ipAddress} removed`);
      const r = await adminAPI.getPool(poolId);
      setPoolDetail(d => ({ ...d, [poolId]: r.data.data }));
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'IP is assigned to a VPS — delete the VPS first'); }
  };

  const deletePool = async (p) => {
    if (!window.confirm(`Delete pool "${p.name}"? All unassigned IPs will be removed.`)) return;
    try {
      await adminAPI.deletePool(p.id);
      toast.success('Pool deleted');
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Pool has IPs assigned to VPS — remove them first'); }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">IP Pools</h1>
        <button onClick={() => setShowPool(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"><Plus size={16}/> New Pool</button>
      </div>
      <div className="space-y-3">
        {pools.map(p => (
          <div key={p.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50" onClick={() => toggle(p.id)}>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-slate-900">{p.name}</h3>
                  {!p.node_id && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">No node — click edit</span>}
                </div>
                <p className="text-sm text-slate-500">
                  {p.gateway || <span className="text-red-500 font-medium">No gateway!</span>}
                  {p.netmask ? ` / ${p.netmask}` : ' / no netmask'}
                  {' · '}{p.used_ips || 0}/{p.total_ips || 0} IPs used
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={e => { e.stopPropagation(); openEdit(p); }} className="p-1.5 text-slate-400 hover:text-indigo-600"><Pencil size={15}/></button>
                <button onClick={e => { e.stopPropagation(); setShowIps(p.id); setIpsText(''); }} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add IPs</button>
                <button onClick={e => { e.stopPropagation(); deletePool(p); }} className="p-1.5 text-slate-400 hover:text-red-600"><Trash2 size={15}/></button>
                {expanded === p.id ? <ChevronUp size={18} className="text-slate-400"/> : <ChevronDown size={18} className="text-slate-400"/>}
              </div>
            </div>
            {expanded === p.id && poolDetail[p.id] && (
              <div className="border-t border-slate-100 p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {poolDetail[p.id].ips?.map(ip => (
                    <div key={ip.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-mono ${ip.vps_id ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-700'}`}>
                      <div className="min-w-0">
                        <span>{ip.ip_address}</span>
                        {ip.mac_address && <p className="text-[10px] text-slate-400 truncate">{ip.mac_address}</p>}
                      </div>
                      <div className="flex items-center shrink-0">
                        <button onClick={() => editMac(p.id, ip)} title="Set MAC address" className="text-slate-300 hover:text-indigo-500 ml-2"><Pencil size={12}/></button>
                        {!ip.vps_id && <button onClick={() => removeIp(p.id, ip.id, ip.ip_address)} className="text-slate-300 hover:text-red-500 ml-2"><Trash2 size={12}/></button>}
                      </div>
                    </div>
                  ))}
                </div>
                {!poolDetail[p.id].ips?.length && <p className="text-slate-400 text-sm">No IPs in this pool. Click "+ Add IPs" to add some.</p>}
              </div>
            )}
          </div>
        ))}
        {!pools.length && <div className="text-center text-slate-400 py-12">No IP pools yet.</div>}
      </div>

      {showPool && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4">New IP Pool</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Node <span className="text-red-500">*</span></label>
                <select value={poolForm.node_id} onChange={e => setPoolForm(f => ({...f, node_id: e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                  <option value="">Select node…</option>
                  {nodes.filter(n => n.is_active).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
              {[['Name','name'],['Gateway','gateway'],['Netmask','netmask'],['Leaseweb API Key','leaseweb_api_key']].map(([l,k]) => (
                <div key={k}><label className="block text-sm font-medium text-slate-700 mb-1">{l}</label>
                <input value={poolForm[k]} onChange={e => setPoolForm(f => ({...f,[k]:e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"/></div>
              ))}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowPool(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={createPool} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">Create</button>
            </div>
          </div>
        </div>
      )}

      {editPool && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Edit IP Pool</h2>
            {!editForm.node_id && (
              <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                This pool has no node assigned — likely because its node was deleted. Re-assign it below.
              </div>
            )}
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Node <span className="text-red-500">*</span></label>
                <select value={editForm.node_id || ''} onChange={e => setEditForm(f => ({...f, node_id: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white">
                  <option value="">— Unassigned —</option>
                  {nodes.filter(n => n.is_active).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
              {[['Name','name'],['Gateway','gateway'],['Netmask','netmask'],['Leaseweb API Key','leaseweb_api_key']].map(([l,k]) => (
                <div key={k}><label className="block text-sm font-medium text-slate-700 mb-1">{l}</label>
                <input value={editForm[k]||''} onChange={e => setEditForm(f => ({...f,[k]:e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  type={k==='leaseweb_api_key'?'password':'text'}/></div>
              ))}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setEditPool(null)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={savePool} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">Save</button>
            </div>
          </div>
        </div>
      )}

      {showIps && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-2">Add IPs</h2>
            <p className="text-sm text-slate-500 mb-3">One IP per line. For providers that require a specific MAC per IP (e.g. OneProvider), append it after a comma — Leaseweb-style IPs need no MAC.</p>
            <textarea value={ipsText} onChange={e => setIpsText(e.target.value)} rows={8} placeholder={"203.0.113.10\n203.0.113.11,aa:bb:cc:dd:ee:ff\n203.0.113.12 aa-bb-cc-dd-ee-01"}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-indigo-500 outline-none"/>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowIps(null)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={() => addIps(showIps)} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">Add IPs</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
