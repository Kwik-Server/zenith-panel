import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { clientAPI } from '../../api/client';
import { Play, Square, RotateCcw } from 'lucide-react';
import toast from 'react-hot-toast';

const STATUS = { running:'bg-green-100 text-green-700', stopped:'bg-slate-100 text-slate-600', suspended:'bg-amber-100 text-amber-700', creating:'bg-indigo-100 text-indigo-700', error:'bg-red-100 text-red-700' };

export default function ClientDashboard() {
  const [vps, setVps] = useState([]);

  const load = () => clientAPI.getVps().then(r => setVps(r.data.data));
  useEffect(() => { load(); }, []);

  const action = async (id, a, label) => {
    try { await clientAPI.vpsAction(id, a); toast.success(`${label} queued`); setTimeout(load, 1500); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">My Servers</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {vps.map(v => (
          <div key={v.id} className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <Link to={`/client/vps/${v.id}`} className="font-semibold text-slate-900 hover:text-indigo-600">{v.hostname}</Link>
                <p className="text-sm text-slate-500 font-mono mt-0.5">{v.ip_address || 'IP pending'}</p>
              </div>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS[v.status]}`}>{v.status}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs text-slate-500 mb-4">
              <div className="bg-slate-50 rounded p-2 text-center"><p className="font-bold text-slate-800 text-sm">{v.cpu}</p><p>vCPU</p></div>
              <div className="bg-slate-50 rounded p-2 text-center"><p className="font-bold text-slate-800 text-sm">{v.ram >= 1024 ? v.ram/1024+'G' : v.ram+'M'}</p><p>RAM</p></div>
              <div className="bg-slate-50 rounded p-2 text-center"><p className="font-bold text-slate-800 text-sm">{v.disk}G</p><p>Disk</p></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => action(v.id, 'start', 'Start')} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700"><Play size={12}/> Start</button>
              <button onClick={() => action(v.id, 'stop', 'Stop')} className="flex-1 flex items-center justify-center gap-1 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs font-medium hover:bg-slate-50"><Square size={12}/> Stop</button>
              <button onClick={() => action(v.id, 'restart', 'Restart')} className="p-1.5 border border-slate-200 text-slate-400 rounded-lg hover:bg-slate-50"><RotateCcw size={14}/></button>
            </div>
          </div>
        ))}
        {!vps.length && <div className="col-span-3 text-center text-slate-400 py-16">You have no VPS yet. Contact support to get started.</div>}
      </div>
    </div>
  );
}
