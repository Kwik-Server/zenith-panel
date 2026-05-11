import clsx from 'clsx';

export default function Select({ label, error, children, className, ...props }) {
  return (
    <div className={clsx('w-full', className)}>
      {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
      <select
        className={clsx(
          'w-full px-3 py-2 border rounded-lg text-slate-900 bg-white text-sm',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all',
          error ? 'border-red-400' : 'border-slate-300'
        )}
        {...props}
      >
        {children}
      </select>
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  );
}
