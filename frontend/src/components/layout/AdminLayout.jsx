import React from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { LayoutDashboard, Server, Plus, Cpu, Package, Network, Globe, Users, ListTodo, ShieldAlert, Settings, LogOut, ChevronRight } from 'lucide-react';

const nav = [
  { to: '/admin/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/admin/vps',       icon: Server,          label: 'Virtual Servers' },
  { to: '/admin/nodes',     icon: Cpu,             label: 'Nodes' },
  { to: '/admin/plans',     icon: Package,         label: 'Plans' },
  { to: '/admin/templates', icon: Plus,            label: 'Templates' },
  { to: '/admin/ippools',   icon: Globe,           label: 'IP Pools' },
  { to: '/admin/users',     icon: Users,           label: 'Users' },
  { to: '/admin/tasks',     icon: ListTodo,        label: 'Task Queue' },
  { to: '/admin/abuse',     icon: ShieldAlert,     label: 'Abuse' },
  { to: '/admin/settings',  icon: Settings,        label: 'Settings' },
];

export default function AdminLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-64 bg-sidebar flex flex-col shrink-0">
        <div className="px-6 py-5 border-b border-white/10">
          <img src="https://kwikserver.com/kwikserver.com-logo.png" alt="Kwik Server" className="h-8 object-contain" />
          <span className="ml-2 text-xs text-indigo-400 font-medium">ADMIN</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {nav.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:bg-white/10 hover:text-white'}`
              }>
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-white/10">
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold">
              {user?.email?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{user?.email}</p>
              <p className="text-slate-400 text-xs">Administrator</p>
            </div>
            <button onClick={handleLogout} className="text-slate-400 hover:text-white"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-slate-50">
        <Outlet />
      </main>
    </div>
  );
}
