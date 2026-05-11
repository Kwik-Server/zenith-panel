import React, { useEffect, useState } from 'react';
import { adminAPI } from '../../api/client';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { Server, Users, Cpu, ListTodo } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

const STATUS_COLORS = { running: '#22C55E', stopped: '#94A3B8', suspended: '#F59E0B', creating: '#6366F1', error: '#EF4444' };

function StatCard({ icon: Icon, label, value, sub, color = 'indigo' }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl bg-${color}-100 flex items-center justify-center`}>
        <Icon className={`text-${color}-600`} size={22} />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-sm text-slate-500">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);

  const load = () => adminAPI.dashboard().then(r => setData(r.data.data));

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);

  if (!data) return <div className="p-8 text-slate-500">Loading…</div>;

  const pieData = Object.entries(STATUS_COLORS)
    .map(([k, c]) => ({ name: k, value: data.vps?.[k] || 0, color: c }))
    .filter(d => d.value > 0);

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Server} label="Total VPS" value={data.vps?.total || 0} sub={`${data.vps?.running || 0} running`} color="indigo" />
        <StatCard icon={Users}  label="Users"     value={data.users?.total || 0} sub={`${data.users?.clients || 0} clients`} color="green" />
        <StatCard icon={Cpu}    label="Nodes"     value={data.nodes?.total || 0} sub={`${data.nodes?.online || 0} online`} color="blue" />
        <StatCard icon={ListTodo} label="Tasks (24h)" value={(data.tasks?.pending || 0) + (data.tasks?.running || 0)} sub={`${data.tasks?.failed || 0} failed`} color="orange" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">VPS Distribution</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={e => `${e.name} (${e.value})`}>
                {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="font-semibold text-slate-900 mb-4">Recent Tasks</h2>
          <div className="space-y-2">
            {(data.recentTasks || []).slice(0, 6).map(t => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <span className="text-slate-700">{t.type} — {t.vps_hostname || '—'}</span>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  t.status === 'completed' ? 'bg-green-100 text-green-700' :
                  t.status === 'failed'    ? 'bg-red-100 text-red-700' :
                  t.status === 'running'   ? 'bg-indigo-100 text-indigo-700' :
                  'bg-slate-100 text-slate-600'}`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
