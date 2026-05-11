import { useState, useEffect } from 'react';
import { adminAPI } from '../../api/client';
import toast from 'react-hot-toast';
import { X, RefreshCw } from 'lucide-react';
import Badge from '../../components/ui/Badge';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { formatDistanceToNow } from 'date-fns';

export default function TaskQueue() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    try {
      const res = await adminAPI.getTasks({ status: statusFilter || undefined, limit: 50 });
      setTasks(res.data.data.tasks);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [statusFilter]);

  const cancel = async (id) => {
    try {
      await adminAPI.cancelTask(id);
      toast.success('Task cancelled');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to cancel');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Task Queue</h1>
          <p className="text-slate-500 text-sm mt-0.5">Background jobs and operations</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <Button variant="secondary" onClick={load} size="sm"><RefreshCw className="w-4 h-4" /></Button>
        </div>
      </div>

      <Card noPadding>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr className="text-left text-slate-500">
              <th className="px-4 py-3 font-medium">ID</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">VPS</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium">Error</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {loading ? [...Array(5)].map((_, i) => (
              <tr key={i}>{[...Array(8)].map((_, j) => <td key={j} className="px-4 py-4"><div className="h-4 bg-slate-100 rounded animate-pulse" /></td>)}</tr>
            )) : tasks.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">No tasks found</td></tr>
            ) : tasks.map((task) => (
              <tr key={task.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-400 text-xs">#{task.id}</td>
                <td className="px-4 py-3 font-medium text-slate-800">{task.type.replace(/_/g, ' ')}</td>
                <td className="px-4 py-3 text-slate-600 text-xs font-mono">{task.vps_hostname || '—'}</td>
                <td className="px-4 py-3 text-slate-500 text-xs">{task.user_email || 'System'}</td>
                <td className="px-4 py-3"><Badge status={task.status} label={task.status} /></td>
                <td className="px-4 py-3 text-slate-400 text-xs">{formatDistanceToNow(new Date(task.created_at), { addSuffix: true })}</td>
                <td className="px-4 py-3 text-red-500 text-xs max-w-xs truncate">{task.error_msg || ''}</td>
                <td className="px-4 py-3">
                  {task.status === 'pending' && (
                    <button onClick={() => cancel(task.id)} className="p-1 text-slate-400 hover:text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
