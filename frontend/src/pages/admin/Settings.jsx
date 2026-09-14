import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import { Copy, CheckCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';

export default function Settings() {
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState(searchParams.get('tab') || 'general');
  const [abuseDefaults, setAbuseDefaults] = useState({});
  const [settings, setSettings] = useState({});
  const [whmcsKey, setWhmcsKey] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    adminAPI.getSettings().then(r => setSettings(r.data.data));
    adminAPI.getWhmcsKey().then(r => setWhmcsKey(r.data.data.whmcs_api_key));
    adminAPI.getAbuseStatus().then(r => setAbuseDefaults(r.data.data.defaults || {})).catch(() => {});
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

  // Plain function (not a component) so inputs keep focus while typing.
  const abuseValue = (k, fallback = '') => settings[k] ?? abuseDefaults[k] ?? fallback;
  const setAbuse = (k) => (e) => setSettings(s => ({ ...s, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 'true' : 'false') : e.target.value }));
  const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none';
  const abuseInput = (label, k, { type = 'text', placeholder, fallback, help } = {}) => (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input type={type} value={abuseValue(k, fallback)} onChange={setAbuse(k)} placeholder={placeholder} className={inputCls} />
      {help && <p className="text-xs text-slate-500 mt-1">{help}</p>}
    </div>
  );
  const abuseCheck = (label, k, fallback, help) => (
    <label className="flex items-start gap-2">
      <input type="checkbox" className="rounded mt-0.5" checked={abuseValue(k, fallback) === 'true'} onChange={setAbuse(k)} />
      <span><span className="text-sm text-slate-700">{label}</span>{help && <span className="block text-xs text-slate-500">{help}</span>}</span>
    </label>
  );
  const ABUSE_KEYS = ['abuse_enabled','abuse_auto_suspend','abuse_client_ratio','abuse_min_client_hours','abuse_suspend_margin_hours',
    'abuse_default_window_hours','abuse_max_suspends_per_hour','abuse_whmcs_deptid','abuse_whmcs_admin_username','abuse_provider_updates',
    'abuse_imap_host','abuse_imap_port','abuse_imap_secure','abuse_imap_user','abuse_imap_pass','abuse_imap_folder','abuse_imap_senders',
    'abuse_imap_require_dkim','abuse_ticket_subject','abuse_ticket_template','abuse_suspend_template'];
  const saveAbuse = () => save(Object.fromEntries(ABUSE_KEYS.filter(k => settings[k] !== undefined).map(k => [k, settings[k]])));

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
        {['general','email','whmcs','abuse','security'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${tab===t?'border-indigo-600 text-indigo-600':'border-transparent text-slate-500 hover:text-slate-700'}`}>{t}</button>
        ))}
      </div>
      <div className={`bg-white rounded-xl border border-slate-200 p-6 ${tab === 'abuse' ? 'max-w-3xl' : 'max-w-lg'}`}>
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
            <div className="flex gap-3">
              <button onClick={() => save({ whmcs_url: settings.whmcs_url, whmcs_identifier: settings.whmcs_identifier, whmcs_secret: settings.whmcs_secret })}
                className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium">Save</button>
              <button onClick={async () => {
                try { await adminAPI.testWhmcs(); toast.success('WHMCS API connection successful'); }
                catch (e) { toast.error(e.response?.data?.error || 'WHMCS connection failed'); }
              }} className="border border-slate-200 text-slate-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50">Test Connection</button>
            </div>
          </div>
        )}
        {tab === 'abuse' && (
          <div className="space-y-6">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Automation</h3>
              {abuseCheck('Enable abuse automation', 'abuse_enabled', 'false', 'Every 5 minutes: fetch reports, open a WHMCS ticket for the client, and act on expired deadlines.')}
              {abuseCheck('Suspend the VPS automatically when the client deadline passes', 'abuse_auto_suspend', 'true', 'When off, expired cases move to "Needs review" and you are alerted instead.')}
              {abuseCheck('Post updates to Leaseweb', 'abuse_provider_updates', 'true', 'Tell Leaseweb compliance when the client is notified and when the VPS is suspended (API reports only).')}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {abuseInput('Client share of provider deadline', 'abuse_client_ratio', { type: 'number', fallback: '0.5', help: '0.5 = the client gets half of the time Leaseweb gave you.' })}
              {abuseInput('Minimum client time (hours)', 'abuse_min_client_hours', { type: 'number', fallback: '2' })}
              {abuseInput('Suspend at least this long before the provider deadline (hours)', 'abuse_suspend_margin_hours', { type: 'number', fallback: '1' })}
              {abuseInput('Window for reports without a deadline (hours)', 'abuse_default_window_hours', { type: 'number', fallback: '24' })}
              {abuseInput('Max automatic suspensions per hour', 'abuse_max_suspends_per_hour', { type: 'number', fallback: '5', help: 'Safety limit; extra cases go to review. 0 = no limit.' })}
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">WHMCS tickets</h3>
              <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                Uses the credentials on the WHMCS tab. The API role needs: GetClientsProducts, OpenTicket, GetTicket, AddTicketReply, ModuleSuspend, ModuleUnsuspend, SendAdminEmail.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {abuseInput('Support department ID', 'abuse_whmcs_deptid', { placeholder: 'e.g. 2', help: 'WHMCS → Setup → Support → Support Departments (the id in the edit link).' })}
                {abuseInput('Admin username for ticket replies', 'abuse_whmcs_admin_username', { placeholder: 'optional' })}
              </div>
              {abuseInput('Ticket subject', 'abuse_ticket_subject')}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ticket message (Markdown)</label>
                <textarea rows={12} value={abuseValue('abuse_ticket_template')} onChange={setAbuse('abuse_ticket_template')} className={`${inputCls} font-mono text-xs`} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reply posted when the VPS is suspended</label>
                <textarea rows={4} value={abuseValue('abuse_suspend_template')} onChange={setAbuse('abuse_suspend_template')} className={`${inputCls} font-mono text-xs`} />
              </div>
              <p className="text-xs text-slate-500">Placeholders: {'{ip} {hostname} {service_id} {provider} {report_id} {abuse_type} {subject} {client_deadline} {provider_deadline} {report_body}'}</p>
            </div>
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Mailbox (fallback intake)</h3>
              <p className="text-xs text-slate-500">Read-only IMAP scan of the last 3 days for mail from the trusted domains. Nothing in the mailbox is marked read, moved or deleted. For Gmail use imap.gmail.com with an app password.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {abuseInput('IMAP host', 'abuse_imap_host', { placeholder: 'imap.gmail.com' })}
                {abuseInput('Port', 'abuse_imap_port', { fallback: '993' })}
                {abuseInput('Username', 'abuse_imap_user', { placeholder: 'abuse@example.com' })}
                {abuseInput('Password / app password', 'abuse_imap_pass', { type: 'password' })}
                {abuseInput('Folder', 'abuse_imap_folder', { fallback: 'INBOX' })}
                {abuseInput('Trusted sender domains', 'abuse_imap_senders', { fallback: 'leaseweb.com', help: 'Comma separated; subdomains included.' })}
              </div>
              {abuseCheck('Use SSL/TLS', 'abuse_imap_secure', 'true')}
              {abuseCheck('Require a DKIM pass from the sender domain', 'abuse_imap_require_dkim', 'true', 'Stops forged "Leaseweb" emails from getting a customer suspended. Only turn off if your mail server does not add Authentication-Results headers.')}
            </div>
            <div className="flex gap-3">
              <button onClick={saveAbuse} className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-lg text-sm font-medium">Save</button>
              <button onClick={async () => {
                try { const r = await adminAPI.testAbuseImap(); toast.success(`Mailbox OK: ${r.data.data.messages} messages in ${r.data.data.folder}`); }
                catch (e) { toast.error(e.response?.data?.error || 'Mailbox test failed'); }
              }} className="border border-slate-200 text-slate-600 px-5 py-2 rounded-lg text-sm font-medium hover:bg-slate-50">Test mailbox (save first)</button>
            </div>
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
