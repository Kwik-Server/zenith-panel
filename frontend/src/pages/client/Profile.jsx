import React, { useState, useEffect } from 'react';
import { clientAPI } from '../../api/client';
import { Copy, CheckCircle, QrCode } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Profile() {
  const [profile, setProfile] = useState({});
  const [pwForm, setPwForm] = useState({ current_password:'', new_password:'' });
  const [apiKey, setApiKey] = useState('');
  const [qr, setQr] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    clientAPI.getProfile().then(r => setProfile(r.data.data));
    clientAPI.getApiKey().then(r => setApiKey(r.data.data.api_key || '')).catch(()=>{});
  }, []);

  const saveProfile = async () => {
    try { await clientAPI.updateProfile(profile); toast.success('Profile saved'); }
    catch { toast.error('Failed'); }
  };

  const changePassword = async () => {
    try { await clientAPI.changePassword(pwForm); toast.success('Password changed'); setPwForm({ current_password:'', new_password:'' }); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const setup2fa = async () => {
    const r = await clientAPI.setup2fa();
    setQr(r.data.data.qrCode);
  };

  const enable2fa = async () => {
    try { await clientAPI.enable2fa({ code: totpCode }); toast.success('2FA enabled'); setQr(''); setTotpCode(''); setProfile(p => ({...p, totp_enabled: true})); }
    catch { toast.error('Invalid code'); }
  };

  const disable2fa = async () => {
    try { await clientAPI.disable2fa({ code: totpCode }); toast.success('2FA disabled'); setTotpCode(''); setProfile(p => ({...p, totp_enabled: false})); }
    catch { toast.error('Invalid code'); }
  };

  const regenKey = async () => {
    try { const r = await clientAPI.regenApiKey(); setApiKey(r.data.data.api_key); toast.success('API key regenerated'); }
    catch { toast.error('Failed'); }
  };

  const copy = () => { navigator.clipboard.writeText(apiKey); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Profile</h1>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-900 mb-4">Account Details</h2>
        <div className="space-y-3">
          {[['First Name','first_name'],['Last Name','last_name'],['Email','email','email']].map(([l,k,t]) => (
            <div key={k}><label className="block text-sm font-medium text-slate-700 mb-1">{l}</label>
            <input type={t||'text'} value={profile[k]||''} onChange={e => setProfile(p=>({...p,[k]:e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"/></div>
          ))}
          <button onClick={saveProfile} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Save</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-900 mb-4">Change Password</h2>
        <div className="space-y-3">
          <div><label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
          <input type="password" value={pwForm.current_password} onChange={e => setPwForm(f=>({...f,current_password:e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"/></div>
          <div><label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
          <input type="password" value={pwForm.new_password} onChange={e => setPwForm(f=>({...f,new_password:e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"/></div>
          <button onClick={changePassword} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">Change Password</button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-900 mb-1">Two-Factor Authentication</h2>
        <p className="text-sm text-slate-500 mb-4">{profile.totp_enabled ? '2FA is enabled.' : '2FA is disabled.'}</p>
        {!profile.totp_enabled && !qr && <button onClick={setup2fa} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">Set Up 2FA</button>}
        {qr && (
          <div className="space-y-3">
            <img src={qr} alt="QR code" className="w-40 h-40"/>
            <input value={totpCode} onChange={e => setTotpCode(e.target.value)} placeholder="Enter 6-digit code" className="w-48 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"/>
            <button onClick={enable2fa} className="block bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700">Enable 2FA</button>
          </div>
        )}
        {profile.totp_enabled && (
          <div className="space-y-2">
            <input value={totpCode} onChange={e => setTotpCode(e.target.value)} placeholder="Enter code to disable" className="w-48 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"/>
            <button onClick={disable2fa} className="block bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">Disable 2FA</button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="font-semibold text-slate-900 mb-1">API Key</h2>
        <p className="text-sm text-slate-500 mb-3">Use with header <code className="font-mono bg-slate-100 px-1 py-0.5 rounded text-xs">X-API-Key</code></p>
        <div className="flex items-center gap-2 mb-3">
          <code className="flex-1 px-3 py-2 bg-slate-100 rounded-lg text-sm font-mono text-slate-700 truncate">{apiKey || 'No key — generate one below'}</code>
          {apiKey && <button onClick={copy} className="p-2 border border-slate-200 rounded-lg text-slate-400 hover:text-slate-700">{copied?<CheckCircle size={16} className="text-green-600"/>:<Copy size={16}/>}</button>}
        </div>
        <button onClick={regenKey} className="border border-slate-200 text-slate-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50">{apiKey ? 'Regenerate' : 'Generate'} API Key</button>
      </div>
    </div>
  );
}
