import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { clientAPI } from '../../api/client';
import { Play, Square, RotateCcw, Terminal, HardDrive, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function ClientVPSDetail() {
  const { id } = useParams();
  const [vps, setVps] = useState(null);
  const [tab, setTab] = useState('overview');
  const [console_, setConsole] = useState(null);
  const [backups, setBackups] = useState([]);
  const [reinstallPw, setReinstallPw] = useState('');
  const [reinstalling, setReinstalling] = useState(false);

  const load = () => clientAPI.getVpsDetail(id).then(r => setVps(r.data.data));
  useEffect(() => { load(); }, [id]);

  const action = async (a, label) => {
    try { await clientAPI.vpsAction(id, a); toast.success(`${label} queued`); setTimeout(load, 1500); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const openConsole = async () => {
    try {
      const r = await clientAPI.vpsConsole(id);
      setConsole(r.data.data); setTab('console');
    } catch (e) { toast.error(e.response?.data?.error || 'Console unavailable'); }
  };

  const loadBackups = () => clientAPI.getBackups(id).then(r => setBackups(r.data.data));

  useEffect(() => { if (tab === 'backups') loadBackups(); }, [tab]);

  const createBackup = async () => {
    try { await clientAPI.createBackup(id); toast.success('Backup queued'); setTimeout(loadBackups, 2000); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const restore = async (bid) => {
    if (!window.confirm('Restore this backup? Current data will be replaced.')) return;
    try { await clientAPI.restoreBackup(id, bid); toast.success('Restore queued'); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const reinstall = async () => {
    if (!window.confirm('Reinstall OS? All data on this VPS will be erased.')) return;
    if (!reinstallPw || reinstallPw.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setReinstalling(true);
    try { await clientAPI.reinstall(id, { root_password: reinstallPw }); toast.success('Reinstall queued'); setReinstallPw(''); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setReinstalling(false); }
  };

  if (!vps) return <div className="p-8 text-slate-500">Loading…</div>;

  const consoleUrl = console_
    ? `https://${console_.host}:${console_.port}/?console=${vps.type === 'lxc' ? 'lxc' : 'kvm'}&novnc=1&vmid=${console_.vmid}&node=${vps.node_name}&resize=off&vncticket=${encodeURIComponent(console_.ticket)}`
    : null;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{vps.hostname}</h1>
          <p className="text-slate-500 text-sm mt-1 font-mono">{vps.ip_addresses?.[0]?.ip_address || 'No IP'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => action('start','Start')} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"><Play size={14}/> Start</button>
          <button onClick={() => action('stop','Stop')} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50"><Square size={14}/> Stop</button>
          <button onClick={() => action('restart','Restart')} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50"><RotateCcw size={14}/> Restart</button>
          <button onClick={openConsole} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"><Terminal size={14}/> Console</button>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {['overview','console','backups','reinstall'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${tab===t?'border-indigo-600 text-indigo-600':'border-transparent text-slate-500 hover:text-slate-700'}`}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
          <dl className="space-y-3">
            {[['CPU',`${vps.cpu} vCPU`],['RAM',vps.ram>=1024?`${vps.ram/1024} GB`:`${vps.ram} MB`],['Disk',`${vps.disk} GB`],['Bandwidth',vps.bandwidth?`${vps.bandwidth} GB/mo`:'Unlimited'],['Type',vps.type?.toUpperCase()],['Node',vps.node_name]].map(([k,v]) => (
              <div key={k} className="flex justify-between text-sm"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>
            ))}
          </dl>
        </div>
      )}

      {tab === 'console' && (
        <div className="bg-black rounded-xl overflow-hidden" style={{height:600}}>
          {consoleUrl
            ? <iframe src={consoleUrl} className="w-full h-full border-0" title="Console"/>
            : <div className="flex items-center justify-center h-full text-slate-400">
                <div className="text-center">
                  <Terminal size={48} className="mx-auto mb-4 opacity-30"/>
                  <button onClick={openConsole} className="bg-indigo-600 text-white px-6 py-2 rounded-lg text-sm font-medium">Open Console</button>
                </div>
              </div>}
        </div>
      )}

      {tab === 'backups' && (
        <div className="space-y-4 max-w-2xl">
          <button onClick={createBackup} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"><HardDrive size={15}/> Create Backup</button>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {backups.length === 0
              ? <p className="p-6 text-slate-400 text-sm text-center">No backups yet</p>
              : <table className="w-full"><tbody>{backups.map(b => (
                  <tr key={b.id} className="border-b border-slate-100 text-sm">
                    <td className="px-4 py-3 text-slate-700">{b.name}</td>
                    <td className="px-4 py-3 text-slate-500">{b.size ? `${(b.size/1024/1024/1024).toFixed(1)} GB` : '—'}</td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{new Date(b.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3"><button onClick={() => restore(b.id)} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">Restore</button></td>
                  </tr>
                ))}</tbody></table>}
          </div>
        </div>
      )}

      {tab === 'reinstall' && (
        <div className="max-w-md">
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex gap-3">
            <AlertTriangle size={20} className="text-red-500 shrink-0 mt-0.5"/>
            <div className="text-sm text-red-700">
              <p className="font-semibold mb-1">Warning: This will erase all data</p>
              <p>Reinstalling the OS will destroy all files, databases, and configurations on this VPS. This cannot be undone.</p>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <label className="block text-sm font-medium text-slate-700 mb-1">New Root Password</label>
            <input type="password" value={reinstallPw} onChange={e => setReinstallPw(e.target.value)} placeholder="Min 8 characters"
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none mb-4"/>
            <button onClick={reinstall} disabled={reinstalling} className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {reinstalling ? 'Queuing…' : 'Reinstall OS'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
