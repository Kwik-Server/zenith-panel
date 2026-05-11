import clsx from 'clsx';

const variants = {
  primary: 'bg-indigo-500 hover:bg-indigo-600 text-white border-transparent',
  secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-transparent',
  danger: 'bg-red-500 hover:bg-red-600 text-white border-transparent',
  outline: 'bg-white hover:bg-slate-50 text-slate-700 border-slate-300',
  ghost: 'bg-transparent hover:bg-slate-100 text-slate-600 border-transparent',
  success: 'bg-green-500 hover:bg-green-600 text-white border-transparent',
  warning: 'bg-amber-500 hover:bg-amber-600 text-white border-transparent',
};

const sizes = {
  xs: 'px-2.5 py-1 text-xs',
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-base',
};

export default function Button({ children, variant = 'primary', size = 'md', loading, disabled, className, onClick, type = 'button', ...props }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 font-medium rounded-lg border transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {loading && (
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
