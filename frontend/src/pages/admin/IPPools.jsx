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
  const [poolForm, setPoolForm] = useState({ name:'', gateway:'', netmask:'', leaseweb_api_key:'' });
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

  const openEdit = (p) => { setEditPool(p.id); setEditForm({ name: p.name, gateway: p.gateway, netmask: p.netmask, leaseweb_api_key: p.leaseweb_api_key || '' }); };
  const savePool = async () => {
    try { await adminAPI.updatePool(editPool, editForm); toast.success('Pool updated'); setEditPool(null); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const createPool = async () => {
    try { await adminAPI.createPool(poolForm); toast.success('Pool created'); setShowPool(false); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const addIps = async (poolId) => {
    const ips = ipsText.split('\n').map(s => s.trim()).filter(Boolean);
    if (!ips.length) return;
    try {
      await adminAPI.addIps(poolId, { ip_addresses: ips });
      toast.success(`${ips.length} IPs added`);
      setShowIps(null); setIpsText('');
      const r = await adminAPI.getPool(poolId);
      setPoolDetail(d => ({ ...d, [poolId]: r.data.data }));
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const removeIp = async (poolId, ipId) => {
    try {
      await adminAPI.removeIp(poolId, ipId);
      const r = await adminAPI.getPool(poolId);
      setPoolDetail(d => ({ ...d, [poolId]: r.data.data }));
      load();
    } catch (e) { toast.error(e.response?.data?.error || 'IP is assigned to a VPS'); }
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
                <h3 className="font-semibold text-slate-900">{p.name}</h3>
                <p className="text-sm text-slate-500">{p.gateway} · {p.used_ips || 0}/{p.total_ips || 0} IPs used</p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={e => { e.stopPropagation(); openEdit(p); }} className="p-1.5 text-slate-400 hover:text-indigo-600"><Pencil size={15}/></button>
                <button onClick={e => { e.stopPropagation(); setShowIps(p.id); setIpsText(''); }} className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">+ Add IPs</button>
                {expanded === p.id ? <ChevronUp size={18} className="text-slate-400"/> : <ChevronDown size={18} className="text-slate-400"/>}
              </div>
            </div>
            {expanded === p.id && poolDetail[p.id] && (
              <div className="border-t border-slate-100 p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {poolDetail[p.id].ips?.map(ip => (
                    <div key={ip.id} className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm font-mono ${ip.vps_id ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-700'}`}>
                      <span>{ip.ip_address}</span>
                      {!ip.vps_id && <button onClick={() => removeIp(p.id, ip.id)} className="text-slate-300 hover:text-red-500 ml-2"><Trash2 size={12}/></button>}
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
            <div className="space-y-3">
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
            <p className="text-sm text-slate-500 mb-3">One IP address per line</p>
            <textarea value={ipsText} onChange={e => setIpsText(e.target.value)} rows={8} placeholder={"203.0.113.10\n203.0.113.11\n203.0.113.12"}
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
