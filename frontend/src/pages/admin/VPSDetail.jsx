import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { adminAPI } from '../../api/client';
import { Play, Square, RotateCcw, Zap, PauseCircle, Terminal, Plus, Trash2, RefreshCw, Network, Shield, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuthStore } from '../../store/authStore';

const STATUS_COLOR = { running: 'bg-green-100 text-green-700', stopped: 'bg-slate-100 text-slate-600', suspended: 'bg-amber-100 text-amber-700', error: 'bg-red-100 text-red-700', creating: 'bg-indigo-100 text-indigo-700' };

function VncConsole({ vpsId, token }) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${window.location.host}/api/v1/admin/vps/${vpsId}/console/ws?token=${token}`;
  const [VncScreen, setVncScreen] = useState(null);

  useEffect(() => {
    import('react-vnc').then(m => setVncScreen(() => m.VncScreen));
  }, []);

  if (!VncScreen) return (
    <div className="flex items-center justify-center h-full bg-black rounded-xl text-slate-400">
      <p className="text-sm">Loading console...</p>
    </div>
  );

  return (
    <VncScreen
      url={wsUrl}
      scaleViewport
      style={{ width: '100%', height: '100%', background: '#000', borderRadius: '12px' }}
    />
  );
}

export default function VPSDetail() {
  const { id } = useParams();
  const token = useAuthStore(s => s.token);
  const [vps, setVps] = useState(null);
  const [tab, setTab] = useState('overview');
  const [backups, setBackups] = useState([]);
  const [assignedIps, setAssignedIps] = useState([]);
  const [availableIps, setAvailableIps] = useState([]);
  const [rdns, setRdns] = useState([]);
  const [editingRdns, setEditingRdns] = useState(null);
  const [rdnsValue, setRdnsValue] = useState('');
  const [savingRdns, setSavingRdns] = useState(false);
  const [showIpModal, setShowIpModal] = useState(false);
  const [showReinstall, setShowReinstall] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [reinstallForm, setReinstallForm] = useState({ template_id: '', root_password: '' });
  const [firewall, setFirewall] = useState({ rules: [], options: {} });
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [ruleForm, setRuleForm] = useState({ type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '', sport: '', source: '', dest: '', comment: '', enable: 1 });

  const load = () => adminAPI.getVpsDetail(id).then(r => setVps(r.data.data));

  useEffect(() => { load(); }, [id]);

  const action = async (a, label, opts = {}) => {
    try { await adminAPI.vpsAction(id, a, opts); toast.success(`${label} queued`); setTimeout(load, 1500); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const loadBackups = async () => {
    const r = await adminAPI.getTasks({ vps_id: id });
    setBackups(r.data.data.filter(t => t.type === 'create_backup'));
  };

  const loadIps = async () => {
    const r = await adminAPI.getVpsIps(id);
    setAssignedIps(r.data.data);
  };

  const loadRdns = async () => {
    try {
      const r = await adminAPI.getVpsRdns(id);
      setRdns(r.data.data || []);
    } catch { setRdns([]); }
  };

  const startEditRdns = (entry) => {
    setEditingRdns(entry.ip);
    setRdnsValue(entry.ptr || '');
  };

  const saveRdns = async () => {
    setSavingRdns(true);
    try {
      await adminAPI.updateVpsRdns(id, { ip: editingRdns, ptr: rdnsValue });
      toast.success('PTR record updated');
      setEditingRdns(null);
      loadRdns();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
    finally { setSavingRdns(false); }
  };

  const assignIp = async (ipId) => {
    try {
      await adminAPI.assignVpsIp(id, { ip_address_id: ipId });
      toast.success('IP assigned');
      setShowIpModal(false);
      loadIps();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const removeIp = async (ipId) => {
    if (!window.confirm('Remove this IP from the VPS?')) return;
    try {
      await adminAPI.removeVpsIp(id, ipId);
      toast.success('IP removed');
      loadIps();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const openIpModal = async () => {
    if (vps) {
      const r = await adminAPI.getAvailableIps(vps.node_id).catch(() => ({ data: { data: [] } }));
      setAvailableIps(r.data.data);
    }
    setShowIpModal(true);
  };

  const openReinstall = async () => {
    const r = await adminAPI.getTemplates().catch(() => ({ data: { data: [] } }));
    const filtered = r.data.data.filter(t => t.is_active && t.type === vps.type);
    setTemplates(filtered);
    setReinstallForm({ template_id: vps.template_id || '', root_password: '' });
    setShowReinstall(true);
  };

  const forceDelete = async () => {
    if (!window.confirm(`Force-remove "${vps.hostname}" from Zenith? This does NOT delete it from Proxmox — only removes the record from Zenith.`)) return;
    try {
      await adminAPI.forceDeleteVps(id);
      toast.success('VPS removed from Zenith');
      window.location.href = '/admin/vps';
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const reconfigureNetwork = async () => {
    if (!window.confirm('Re-apply current IP pool gateway/netmask to this VPS and reboot. Continue?')) return;
    try {
      const r = await adminAPI.reconfigureNetwork(id);
      toast.success(`Network reconfigured — applied: ${r.data.data.ipConfig}`);
      setTimeout(load, 2000);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const confirmReinstall = async () => {
    if (!reinstallForm.root_password) { toast.error('New root password required'); return; }
    if (!window.confirm('Reinstall will erase all data on this VPS. Continue?')) return;
    try {
      await adminAPI.vpsAction(id, 'reinstall', reinstallForm);
      toast.success('Reinstall queued');
      setShowReinstall(false);
      setTimeout(load, 1500);
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const loadFirewall = () => adminAPI.getVpsFirewall(id).then(r => setFirewall(r.data.data)).catch(() => {});

  const toggleFirewall = async (enabled) => {
    try { await adminAPI.setVpsFirewallOptions(id, { enable: enabled ? 1 : 0 }); loadFirewall(); toast.success(enabled ? 'Firewall enabled' : 'Firewall disabled'); }
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
      if (editingRule !== null) await adminAPI.updateVpsFirewallRule(id, editingRule, payload);
      else await adminAPI.addVpsFirewallRule(id, payload);
      toast.success(editingRule !== null ? 'Rule updated' : 'Rule added');
      setShowRuleModal(false);
      loadFirewall();
    } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  const deleteRule = async (pos) => {
    if (!window.confirm('Delete this rule?')) return;
    try { await adminAPI.deleteVpsFirewallRule(id, pos); toast.success('Rule deleted'); loadFirewall(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  useEffect(() => { if (tab === 'backups') loadBackups(); }, [tab]);
  useEffect(() => { if (tab === 'firewall') loadFirewall(); }, [tab]);
  useEffect(() => { loadIps(); loadRdns(); }, [id]);

  if (!vps) return <div className="p-8 text-slate-500">Loading…</div>;

  return (
    <div className="p-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{vps.hostname}</h1>
          <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLOR[vps.status] || 'bg-slate-100'}`}>{vps.status}</span>
            <span>VMID: {vps.proxmox_vmid || 'pending'}</span>
            <span>Node: {vps.node_name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => action('start','Start')}      className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"><Play size={14}/> Start</button>
          <button onClick={() => action('stop','Stop')}        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-600 text-white rounded-lg text-sm hover:bg-slate-700"><Square size={14}/> Stop</button>
          <button onClick={() => action('restart','Restart')}  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"><RotateCcw size={14}/> Restart</button>
          <button onClick={() => action('forceStop','Force Stop')} className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm hover:bg-orange-700"><Zap size={14}/> Force</button>
          <button onClick={() => action('suspend','Suspend')}  className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700"><PauseCircle size={14}/> Suspend</button>
          <button onClick={reconfigureNetwork} className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700"><Network size={14}/> Reconfig Network</button>
          {(vps.status === 'error' || vps.status === 'deleting') && (
            <button onClick={forceDelete} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-800 text-white rounded-lg text-sm hover:bg-red-900"><Trash2 size={14}/> Force Remove</button>
          )}
          <button onClick={openReinstall} className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 text-white rounded-lg text-sm hover:bg-rose-700"><RefreshCw size={14}/> Reinstall</button>
          <button onClick={() => setTab('console')} className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700"><Terminal size={14}/> Console</button>
        </div>
      </div>

      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {['overview','console','firewall','backups'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors ${tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="font-semibold text-slate-900 mb-4">Specifications</h3>
            <dl className="space-y-3">
              {[
                ['CPU', `${vps.cpu} vCPU`],
                ['RAM', `${vps.ram >= 1024 ? vps.ram/1024 + ' GB' : vps.ram + ' MB'}`],
                ['Disk', `${vps.disk} GB`],
                ['Bandwidth', vps.bandwidth ? `${vps.bandwidth} GB/mo` : 'Unlimited'],
                ['Type', vps.type?.toUpperCase()],
                ['VMID', vps.proxmox_vmid || 'Pending'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between text-sm">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="font-medium text-slate-900">{v}</dd>
                </div>
              ))}
              <div className="flex justify-between text-sm items-center">
                <dt className="text-slate-500">UUID</dt>
                <dd className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-slate-700 truncate max-w-[180px]" title={vps.uuid}>{vps.uuid}</span>
                  <button
                    onClick={() => { navigator.clipboard.writeText(vps.uuid); toast.success('UUID copied'); }}
                    className="text-slate-400 hover:text-indigo-600 transition-colors"
                    title="Copy UUID"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  </button>
                </dd>
              </div>
            </dl>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-900">Network</h3>
              <button onClick={openIpModal} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                <Plus size={13}/> Add IP
              </button>
            </div>
            <dl className="space-y-2">
              {assignedIps.length === 0 && <p className="text-sm text-slate-400">No IPs assigned</p>}
              {assignedIps.map((ip, i) => (
                <div key={ip.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500">IPv{ip.ip_address.includes(':') ? '6' : '4'}</span>
                    {i === 0 && <span className="text-xs bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded font-medium">primary</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-slate-900">{ip.ip_address}</span>
                    <button onClick={() => removeIp(ip.id)} className="text-slate-300 hover:text-red-500 transition-colors">
                      <Trash2 size={13}/>
                    </button>
                  </div>
                </div>
              ))}
            </dl>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-6 md:col-span-2">
            <h3 className="font-semibold text-slate-900 mb-4">rDNS / PTR Records</h3>
            {rdns.length === 0 && (
              <p className="text-sm text-slate-400">No IPs assigned or no Leaseweb API key configured on the pool.</p>
            )}
            <div className="space-y-3">
              {rdns.map(entry => (
                <div key={entry.ip} className="flex items-center gap-3">
                  <span className="font-mono text-sm text-slate-700 w-36 shrink-0">{entry.ip}</span>
                  {editingRdns === entry.ip ? (
                    <>
                      <input
                        autoFocus
                        value={rdnsValue}
                        onChange={e => setRdnsValue(e.target.value)}
                        placeholder="e.g. mail.example.com"
                        className="flex-1 px-3 py-1.5 border border-indigo-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                        onKeyDown={e => { if (e.key === 'Enter') saveRdns(); if (e.key === 'Escape') setEditingRdns(null); }}
                      />
                      <button onClick={saveRdns} disabled={savingRdns}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium disabled:opacity-40">
                        {savingRdns ? 'Saving…' : 'Save'}
                      </button>
                      <button onClick={() => setEditingRdns(null)}
                        className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={`flex-1 text-sm font-mono ${entry.error ? 'text-amber-500 italic' : entry.ptr ? 'text-slate-800' : 'text-slate-400'}`}>
                        {entry.error || entry.ptr || 'not set'}
                      </span>
                      {!entry.error && (
                        <button onClick={() => startEditRdns(entry)}
                          className="px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50 hover:border-indigo-300">
                          Edit
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'firewall' && (
        <div className="space-y-4">
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

      {tab === 'console' && (
        <div style={{ height: 600 }}>
          <VncConsole vpsId={id} token={token} />
        </div>
      )}

      {tab === 'backups' && (
        <div className="bg-white rounded-xl border border-slate-200">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-semibold text-slate-900">Backups</h3>
          </div>
          {backups.length === 0
            ? <p className="p-6 text-slate-400 text-sm text-center">No backup tasks found</p>
            : <table className="w-full"><tbody>{backups.map(b => (
                <tr key={b.id} className="border-b border-slate-100 text-sm">
                  <td className="px-4 py-3 text-slate-600">{new Date(b.created_at).toLocaleString()}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs ${b.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{b.status}</span></td>
                </tr>
              ))}</tbody></table>}
        </div>
      )}
      {showReinstall && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-900 mb-1">Reinstall OS</h2>
            <p className="text-sm text-red-600 mb-4">Warning: All data on this VPS will be erased.</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Select OS Template</label>
                <select value={reinstallForm.template_id} onChange={e => setReinstallForm(f => ({...f, template_id: e.target.value}))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 outline-none">
                  <option value="">Keep current OS</option>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">New Root Password *</label>
                <input type="password" value={reinstallForm.root_password} onChange={e => setReinstallForm(f => ({...f, root_password: e.target.value}))}
                  placeholder="Min 8 characters" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-rose-500 outline-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setShowReinstall(false)} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
              <button onClick={confirmReinstall} className="flex-1 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-medium">Reinstall</button>
            </div>
          </div>
        </div>
      )}

      {showIpModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4">Assign IP Address</h2>
            {availableIps.length === 0
              ? <p className="text-sm text-slate-400 mb-4">No available IPs in pool for this node.</p>
              : <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
                  {availableIps.map(ip => (
                    <button key={ip.id} onClick={() => assignIp(ip.id)}
                      className="w-full flex items-center justify-between p-3 border border-slate-200 rounded-lg hover:border-indigo-500 hover:bg-indigo-50 text-sm transition-colors">
                      <span className="font-mono font-medium text-slate-900">{ip.ip_address}</span>
                      <span className="text-xs text-slate-400">{ip.pool_name}</span>
                    </button>
                  ))}
                </div>
            }
            <button onClick={() => setShowIpModal(false)} className="w-full py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
