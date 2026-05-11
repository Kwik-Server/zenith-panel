import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { clientAPI } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import { Play, Square, RotateCcw, Terminal, AlertTriangle, Shield, Plus, Trash2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';

function OsIcon({ name }) {
  const n = (name || '').toLowerCase();
  let icon = null;
  if      (n.includes('ubuntu'))  icon = 'ubuntu';
  else if (n.includes('debian'))  icon = 'debian';
  else if (n.includes('alma'))    icon = 'almalinux';
  else if (n.includes('centos'))  icon = 'centos';
  else if (n.includes('fedora'))  icon = 'fedora';
  else if (n.includes('windows')) icon = 'windows';
  else if (n.includes('rocky'))   icon = 'rockylinux';
  if (!icon) return null;
  return <img src={`https://cdn.simpleicons.org/${icon}`} alt={name} className="w-10 h-10 object-contain" onError={e => e.target.style.display='none'} />;
}

function VncConsole({ vpsId, token }) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${window.location.host}/api/v1/client/vps/${vpsId}/console/ws?token=${token}`;
  const [VncScreen, setVncScreen] = useState(null);
  useEffect(() => { import('react-vnc').then(m => setVncScreen(() => m.VncScreen)); }, []);
  if (!VncScreen) return <div className="flex items-center justify-center h-full text-slate-400"><p className="text-sm">Loading console...</p></div>;
  return <VncScreen url={wsUrl} scaleViewport style={{ width:'100%', height:'100%', background:'#000' }} />;
}

export default function ClientVPSDetail() {
  const { id } = useParams();
  const token = useAuthStore(s => s.token);
  const [vps, setVps] = useState(null);
  const [tab, setTab] = useState('overview');
  const [backups, setBackups] = useState([]);
  const [reinstallPw, setReinstallPw] = useState('');
  const [reinstallTpl, setReinstallTpl] = useState('');
  const [reinstalling, setReinstalling] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [rdnsData, setRdnsData] = useState([]);
  const [rdnsEditing, setRdnsEditing] = useState({});
  const [firewall, setFirewall] = useState({ rules: [], options: {} });
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({ type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '', sport: '', source: '', dest: '', comment: '', enable: 1 });

  const load = () => clientAPI.getVpsDetail(id).then(r => setVps(r.data.data));
  useEffect(() => { load(); }, [id]);

  const action = async (a, label) => {
    try { await clientAPI.vpsAction(id, a); toast.success(`${label} queued`); setTimeout(load, 1500); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };


  const loadBackups = () => clientAPI.getBackups(id).then(r => setBackups(r.data.data));

  useEffect(() => { if (tab === 'backups') loadBackups(); }, [tab]);

  const loadRdns = () => clientAPI.getRdns(id).then(r => setRdnsData(r.data.data)).catch(() => {});

  const updateRdns = async (ip) => {
    const ptr = rdnsEditing[ip];
    if (!ptr) { toast.error('PTR cannot be empty'); return; }
    try {
      await clientAPI.updateRdns(id, { ip, ptr });
      toast.success('PTR record updated');
      loadRdns();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const loadFirewall = () => clientAPI.getFirewall(id).then(r => setFirewall(r.data.data)).catch(() => {});

  const toggleFirewall = async (enabled) => {
    try { await clientAPI.setFirewallOptions(id, { enable: enabled ? 1 : 0 }); loadFirewall(); toast.success(enabled ? 'Firewall enabled' : 'Firewall disabled'); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const openAddRule = () => {
    setEditingRule(null);
    setRuleForm({ type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '', sport: '', source: '', dest: '', comment: '', enable: 1 });
    setShowRuleModal(true);
  };

  const openEditRule = (rule) => {
    setEditingRule(rule.pos);
    setRuleForm({ type: rule.type || 'in', action: rule.action || 'ACCEPT', proto: rule.proto || 'tcp', dport: rule.dport || '', sport: rule.sport || '', source: rule.source || '', dest: rule.dest || '', comment: rule.comment || '', enable: rule.enable ?? 1 });
    setShowRuleModal(true);
  };

  const saveRule = async () => {
    const payload = {};
    Object.entries(ruleForm).forEach(([k, v]) => { if (v !== '') payload[k] = v; });
    try {
      if (editingRule !== null) await clientAPI.updateFirewallRule(id, editingRule, payload);
      else await clientAPI.addFirewallRule(id, payload);
      toast.success(editingRule !== null ? 'Rule updated' : 'Rule added');
      setShowRuleModal(false);
      loadFirewall();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const deleteRule = async (pos) => {
    if (!window.confirm('Delete this rule?')) return;
    try { await clientAPI.deleteFirewallRule(id, pos); toast.success('Rule deleted'); loadFirewall(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  useEffect(() => { if (tab === 'rdns') loadRdns(); }, [tab]);
  useEffect(() => { if (tab === 'firewall') loadFirewall(); }, [tab]);

  useEffect(() => {
    if (tab === 'reinstall' && vps) {
      clientAPI.getTemplates()
        .then(r => setTemplates(r.data.data.filter(t => t.type === vps.type)))
        .catch(() => {});
    }
  }, [tab, vps]);

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
    try {
      await clientAPI.reinstall(id, { root_password: reinstallPw, template_id: reinstallTpl || undefined });
      toast.success('Reinstall queued');
      setReinstallPw('');
      setReinstallTpl('');
    }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setReinstalling(false); }
  };

  if (!vps) return <div className="p-8 text-slate-500">Loading…</div>;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{vps.hostname}</h1>
          <p className="text-slate-500 text-sm mt-1 font-mono">{Array.isArray(vps.ip_addresses) && vps.ip_addresses.length > 0 ? vps.ip_addresses[0].ip_address : 'No IP'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => action('start','Start')} className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"><Play size={14}/> Start</button>
          <button onClick={() => action('stop','Stop')} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50"><Square size={14}/> Stop</button>
          <button onClick={() => action('restart','Restart')} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50"><RotateCcw size={14}/> Restart</button>
          <button onClick={() => setTab('console')} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"><Terminal size={14}/> Console</button>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {['overview','console','rdns','firewall','reinstall'].map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${tab===t?'border-indigo-600 text-indigo-600':'border-transparent text-slate-500 hover:text-slate-700'}`}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Specifications</h3>
            <dl className="space-y-3">
              {[['CPU',`${vps.cpu} vCPU`],['RAM',vps.ram>=1024?`${vps.ram/1024} GB`:`${vps.ram} MB`],['Disk',`${vps.disk} GB`],['Bandwidth',vps.bandwidth?`${vps.bandwidth} GB/mo`:'Unlimited'],['Type',vps.type?.toUpperCase()],['Node',vps.node_name]].map(([k,v]) => (
                <div key={k} className="flex justify-between text-sm"><dt className="text-slate-500">{k}</dt><dd className="font-medium text-slate-900">{v}</dd></div>
              ))}
            </dl>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Operating System</h3>
            <div className="flex items-center gap-4">
              <OsIcon name={vps.template_name} />
              <div>
                <p className="font-semibold text-slate-900">{vps.template_name || 'Unknown OS'}</p>
                <p className="text-xs text-slate-400 mt-0.5">{vps.type?.toUpperCase()} Container</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'console' && (
        <div style={{height:600}}>
          <VncConsole vpsId={id} token={token} />
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

      {tab === 'rdns' && (
        <div className="max-w-2xl space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-700">
            Reverse DNS (PTR) records map your IP address to a hostname. Changes may take up to 24 hours to propagate.
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <h3 className="font-semibold text-slate-900">IP Addresses & PTR Records</h3>
            </div>
            {rdnsData.length === 0
              ? <p className="p-6 text-center text-slate-400 text-sm">Loading...</p>
              : rdnsData.map((item) => (
                  <div key={item.ip} className="p-4 border-b border-slate-100 last:border-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm font-medium text-slate-900">{item.ip}</span>
                      {item.error && <span className="text-xs text-red-500">{item.error}</span>}
                    </div>
                    {!item.error && (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          defaultValue={item.ptr}
                          onChange={e => setRdnsEditing(prev => ({ ...prev, [item.ip]: e.target.value }))}
                          placeholder="e.g. mail.example.com"
                          className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                        />
                        <button onClick={() => updateRdns(item.ip)}
                          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
                          Update
                        </button>
                      </div>
                    )}
                    {item.ptr && (
                      <p className="text-xs text-slate-400 mt-1">Current: <span className="font-mono">{item.ptr}</span></p>
                    )}
                  </div>
                ))
            }
          </div>
        </div>
      )}

      {tab === 'firewall' && (
        <div className="max-w-4xl space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield size={20} className={firewall.options.enable ? 'text-green-600' : 'text-slate-400'} />
              <div>
                <p className="font-medium text-slate-900">Firewall</p>
                <p className="text-xs text-slate-500">{firewall.options.enable ? 'Active — rules are enforced' : 'Inactive — all traffic allowed'}</p>
              </div>
            </div>
            <button onClick={() => toggleFirewall(!firewall.options.enable)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${firewall.options.enable ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-green-600 text-white hover:bg-green-700'}`}>
              {firewall.options.enable ? 'Disable' : 'Enable'}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Rules</h3>
              <button onClick={openAddRule} className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                <Plus size={13}/> Add Rule
              </button>
            </div>
            {firewall.rules.length === 0
              ? <p className="p-6 text-center text-slate-400 text-sm">No rules yet. Add a rule to control traffic.</p>
              : <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
                    <tr>{['#','Dir','Action','Proto','Dest Port','Src Port','Source','Dest','Comment',''].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {firewall.rules.map((r, i) => (
                      <tr key={i} className={`hover:bg-slate-50 ${!r.enable ? 'opacity-50' : ''}`}>
                        <td className="px-3 py-2 text-slate-400">{r.pos}</td>
                        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${r.type==='in'?'bg-blue-100 text-blue-700':'bg-purple-100 text-purple-700'}`}>{r.type?.toUpperCase()}</span></td>
                        <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-medium ${r.action==='ACCEPT'?'bg-green-100 text-green-700':r.action==='DROP'?'bg-red-100 text-red-700':'bg-amber-100 text-amber-700'}`}>{r.action}</span></td>
                        <td className="px-3 py-2 font-mono text-slate-700">{r.proto || 'any'}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{r.dport || '—'}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{r.sport || '—'}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{r.source || '—'}</td>
                        <td className="px-3 py-2 font-mono text-slate-700">{r.dest || '—'}</td>
                        <td className="px-3 py-2 text-slate-500 text-xs">{r.comment || '—'}</td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <button onClick={() => openEditRule(r)} className="p-1 text-slate-400 hover:text-indigo-600"><Pencil size={13}/></button>
                            <button onClick={() => deleteRule(r.pos)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={13}/></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            }
          </div>
        </div>
      )}

      {showRuleModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-bold text-slate-900 mb-4">{editingRule !== null ? 'Edit Rule' : 'Add Firewall Rule'}</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Direction</label>
                  <select value={ruleForm.type} onChange={e => setRuleForm(f => ({...f, type: e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none">
                    <option value="in">Inbound (in)</option>
                    <option value="out">Outbound (out)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Action</label>
                  <select value={ruleForm.action} onChange={e => setRuleForm(f => ({...f, action: e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none">
                    <option value="ACCEPT">ACCEPT</option>
                    <option value="DROP">DROP</option>
                    <option value="REJECT">REJECT</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Protocol</label>
                <select value={ruleForm.proto} onChange={e => setRuleForm(f => ({...f, proto: e.target.value}))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none">
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="icmp">ICMP</option>
                  <option value="">Any</option>
                </select>
              </div>
              {[['dport','Destination Port(s)','e.g. 80, 443, 8000:9000'],['sport','Source Port(s)','e.g. 1024:65535'],['source','Source IP/CIDR','e.g. 192.168.1.0/24'],['dest','Destination IP/CIDR','e.g. 10.0.0.0/8'],['comment','Comment','Description for this rule']].map(([k, label, ph]) => (
                <div key={k}>
                  <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                  <input type="text" value={ruleForm[k]} onChange={e => setRuleForm(f => ({...f, [k]: e.target.value}))} placeholder={ph}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                </div>
              ))}
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={ruleForm.enable === 1} onChange={e => setRuleForm(f => ({...f, enable: e.target.checked ? 1 : 0}))} />
                Enable this rule
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowRuleModal(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={saveRule} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium">
                {editingRule !== null ? 'Save Changes' : 'Add Rule'}
              </button>
            </div>
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
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Operating System</label>
              <select value={reinstallTpl} onChange={e => setReinstallTpl(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none">
                <option value="">Keep current OS</option>
                {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Root Password</label>
              <input type="password" value={reinstallPw} onChange={e => setReinstallPw(e.target.value)} placeholder="Min 8 characters"
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none"/>
            </div>
            <button onClick={reinstall} disabled={reinstalling} className="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-50">
              {reinstalling ? 'Queuing…' : 'Reinstall OS'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
