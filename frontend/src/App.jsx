import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import Login from './pages/Login';
import AutoLogin from './pages/AutoLogin';
import AdminLayout from './components/layout/AdminLayout';
import ClientLayout from './components/layout/ClientLayout';
import Dashboard from './pages/admin/Dashboard';
import VPSList from './pages/admin/VPSList';
import VPSCreate from './pages/admin/VPSCreate';
import VPSDetail from './pages/admin/VPSDetail';
import Nodes from './pages/admin/Nodes';
import Plans from './pages/admin/Plans';
import Templates from './pages/admin/Templates';
import IPPools from './pages/admin/IPPools';
import Users from './pages/admin/Users';
import Tasks from './pages/admin/Tasks';
import Settings from './pages/admin/Settings';
import Abuse from './pages/admin/Abuse';
import ClientDashboard from './pages/client/Dashboard';
import ClientVPSDetail from './pages/client/VPSDetail';
import Profile from './pages/client/Profile';

function RequireAuth({ children, role }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (role && user?.role !== role) return <Navigate to={user?.role === 'admin' ? '/admin/dashboard' : '/client/dashboard'} replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/autologin" element={<AutoLogin />} />
      <Route path="/admin" element={<RequireAuth role="admin"><AdminLayout /></RequireAuth>}>
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="vps" element={<VPSList />} />
        <Route path="vps/create" element={<VPSCreate />} />
        <Route path="vps/:id" element={<VPSDetail />} />
        <Route path="nodes" element={<Nodes />} />
        <Route path="plans" element={<Plans />} />
        <Route path="templates" element={<Templates />} />
        <Route path="ippools" element={<IPPools />} />
        <Route path="users" element={<Users />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="abuse" element={<Abuse />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="/client" element={<RequireAuth><ClientLayout /></RequireAuth>}>
        <Route path="dashboard" element={<ClientDashboard />} />
        <Route path="vps/:id" element={<ClientVPSDetail />} />
        <Route path="profile" element={<Profile />} />
      </Route>
      <Route path="/" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
