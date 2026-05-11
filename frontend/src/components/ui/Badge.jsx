import clsx from 'clsx';

const statusMap = {
  running: 'bg-green-100 text-green-700',
  online: 'bg-green-100 text-green-700',
  active: 'bg-green-100 text-green-700',
  completed: 'bg-green-100 text-green-700',
  stopped: 'bg-red-100 text-red-700',
  offline: 'bg-red-100 text-red-700',
  error: 'bg-red-100 text-red-700',
  failed: 'bg-red-100 text-red-700',
  inactive: 'bg-slate-100 text-slate-600',
  suspended: 'bg-yellow-100 text-yellow-700',
  maintenance: 'bg-yellow-100 text-yellow-700',
  warning: 'bg-yellow-100 text-yellow-700',
  creating: 'bg-blue-100 text-blue-700',
  pending: 'bg-blue-100 text-blue-700',
  deleting: 'bg-orange-100 text-orange-700',
  reinstalling: 'bg-purple-100 text-purple-700',
  running_worker: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-slate-100 text-slate-500',
  kvm: 'bg-indigo-100 text-indigo-700',
  lxc: 'bg-teal-100 text-teal-700',
  admin: 'bg-purple-100 text-purple-700',
  client: 'bg-slate-100 text-slate-600',
};

export default function Badge({ status, label, size = 'sm' }) {
  const key = (status || '').toLowerCase();
  const colorClass = statusMap[key] || 'bg-slate-100 text-slate-600';
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';

  return (
    <span className={clsx('inline-flex items-center font-medium rounded-full', colorClass, sizeClass)}>
      {key === 'running' || key === 'online' ? (
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1.5 animate-pulse" />
      ) : key === 'creating' || key === 'pending' || key === 'reinstalling' ? (
        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5 animate-pulse" />
      ) : null}
      {label || status}
    </span>
  );
}
