import clsx from 'clsx';

export default function Input({ label, error, icon: Icon, className, type = 'text', ...props }) {
  return (
    <div className={clsx('w-full', className)}>
      {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
      <div className="relative">
        {Icon && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Icon className="w-4 h-4 text-slate-400" />
          </div>
        )}
        <input
          type={type}
          className={clsx(
            'w-full px-3 py-2 border rounded-lg text-slate-900 placeholder-slate-400',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all text-sm',
            Icon ? 'pl-10' : '',
            error ? 'border-red-400 focus:ring-red-500' : 'border-slate-300'
          )}
          {...props}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
