import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import { Copy, CheckCircle } from 'lucide-react';
import toast from 'react-hot-toast';

export default function Settings() {
  const [tab, setTab] = useState('general');
  const [settings, setSettings] = useState({});
  const [whmcsKey, setWhmcsKey] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    adminAPI.getSettings().then(r => setSettings(r.data.data));
    adminAPI.getWhmcsKey().then(r => setWhmcsKey(r.data.data.whmcs_api_key));
  }, []);

  const save = async (data) => {
    try { await adminAPI.saveSettings(data); toast.success('Saved'); }
    catch { toast.error('Failed'); }
  };

  const testSmtp = async () => {
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure } = settings;
    try { await adminAPI.testSmtp({ smtp_host, smtp_port, smtp_user, smtp_pass, smtp_secure }); toast.success('SMTP connection OK'); }
    catch (e) { toast.error(e.response?.data?.error || 'SMTP test failed'); }
  };

  const copy = () => { navigator.clipboard.writeText(whmcsKey); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const Field = ({ label, k, type = 'text', placeholder }) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input type={type} value={settings[k] || ''} onChange={e => setSettings(s => ({...s,[k]:e.target.value}))} placeholder={placeholder}
        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"/>
    </div>
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-slate-900 mb-6">Settings</h1>
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {['general','email','whmcs','security'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${tab===t?'border-indigo-600 text-indigo-600':'border-transparent text-slate-500 hover:text-slate-700'}`}>{t}</button>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 p-6 max-w-lg">
        {tab === 'general' && (
          <div className="space-y-4">
            <Field label="Panel Name" k="panel_name" placeholder="Zenith" />
            <Field label="Panel URL" k="panel_url" placeholder="https://panel.example.com" />
            <button onClick={() => save({ panel_name: settings.panel_name, panel_url: settings.panel_url })}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium">Save</button>
          </div>
        )}
        {tab === 'email' && (
          <div className="space-y-4">
            <Field label="SMTP Host" k="smtp_host" placeholder="smtp.example.com" />
            <Field label="SMTP Port" k="smtp_port" placeholder="587" />
            <Field label="SMTP User" k="smtp_user" placeholder="user@example.com" />
            <Field label="SMTP Password" k="smtp_pass" type="password" />
            <Field label="From Address" k="smtp_from" placeholder="noreply@example.com" />
            <div className="flex items-center gap-2">
              <input type="checkbox" id="secure" checked={settings.smtp_secure === 'true'} onChange={e => setSettings(s => ({...s,smtp_secure:e.target.checked?'true':'false'}))} className="rounded" />
              <label htmlFor="secure" className="text-sm text-slate-700">Use TLS/SSL</label>
            </div>
            <div className="flex gap-3">
              <button onClick={() => save({ smtp_host:settings.smtp_host, smtp_port:settings.smtp_port, smtp_user:settings.smtp_user, smtp_pass:settings.smtp_pass, smtp_from:settings.smtp_from, smtp_secure:settings.smtp_secure })}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium">Save</button>
              <button onClick={testSmtp} className="border border-slate-200 text-slate-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50">Test Connection</button>
            </div>
          </div>
        )}
        {tab === 'whmcs' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              These credentials allow Zenith to log client actions (stop, restart, reinstall, rDNS) to the WHMCS Activity Log.<br/>
              Find them in WHMCS under <strong>Setup → API Credentials</strong>.
            </p>
            <Field label="WHMCS URL" k="whmcs_url" placeholder="https://billing.example.com" />
            <Field label="API Identifier" k="whmcs_identifier" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            <Field label="API Secret" k="whmcs_secret" type="password" placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
            <button onClick={() => save({ whmcs_url: settings.whmcs_url, whmcs_identifier: settings.whmcs_identifier, whmcs_secret: settings.whmcs_secret })}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium">Save</button>
          </div>
        )}
        {tab === 'security' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">WHMCS API Key</label>
              <p className="text-xs text-slate-500 mb-2">Use this key as the "Server Password" when adding Zenith in WHMCS.</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-slate-100 rounded-lg text-sm font-mono text-slate-700 truncate">{whmcsKey || 'Not set'}</code>
                <button onClick={copy} className="p-2 border border-slate-200 rounded-lg text-slate-400 hover:text-slate-700">
                  {copied ? <CheckCircle size={16} className="text-green-600"/> : <Copy size={16}/>}
                </button>
              </div>
            </div>
            <button onClick={() => save({ whmcs_api_key: settings.whmcs_api_key })}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium">Update Key</button>
          </div>
        )}
      </div>
    </div>
  );
}
