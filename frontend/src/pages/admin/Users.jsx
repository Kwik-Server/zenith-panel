import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import { Plus, Trash2, UserX, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ email:'', password:'', first_name:'', last_name:'', role:'client' });

  const load = () => adminAPI.getUsers().then(r => setUsers(r.data.data));
  useEffect(() => { load(); }, []);

  const create = async () => {
    try { await adminAPI.createUser(form); toast.success('User created'); setShowModal(false); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const del = async (id, email) => {
    if (!window.confirm(`Delete ${email}?`)) return;
    try { await adminAPI.deleteUser(id); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'User has active VPS'); }
  };

  const toggleSuspend = async (u) => {
    try {
      if (u.is_active) await adminAPI.suspendUser(u.id);
      else await adminAPI.unsuspendUser(u.id);
      toast.success(u.is_active ? 'Suspended' : 'Unsuspended');
      load();
    } catch (e) { toast.error('Failed'); }
  };

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium"><Plus size={16}/> New User</button>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
            <tr>{['Email','Name','Role','Status','Actions'].map(h => <th key={h} className="px-4 py-3 text-left">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-sm font-medium text-slate-900">{u.email}</td>
                <td className="px-4 py-3 text-sm text-slate-600">{u.first_name} {u.last_name}</td>
                <td className="px-4 py-3"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${u.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>{u.role}</span></td>
                <td className="px-4 py-3"><span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${u.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{u.is_active ? 'Active' : 'Suspended'}</span></td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => toggleSuspend(u)} title={u.is_active ? 'Suspend' : 'Unsuspend'}
                      className="p-1.5 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700">
                      {u.is_active ? <UserX size={15}/> : <UserCheck size={15}/>}
                    </button>
                    <button onClick={() => del(u.id, u.email)} className="p-1.5 hover:bg-red-100 rounded text-slate-400 hover:text-red-600"><Trash2 size={15}/></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4">New User</h2>
            <div className="space-y-3">
              {[['Email','email','email'],['Password','password','password'],['First Name','first_name','text'],['Last Name','last_name','text']].map(([l,k,t]) => (
                <div key={k}><label className="block text-sm font-medium text-slate-700 mb-1">{l}</label>
                <input type={t} value={form[k]} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"/></div>
              ))}
              <div><label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
              <select value={form.role} onChange={e => setForm(f => ({...f,role:e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none">
                <option value="client">Client</option><option value="admin">Admin</option>
              </select></div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={() => setShowModal(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={create} className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
