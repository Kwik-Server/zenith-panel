import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';
import toast from 'react-hot-toast';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuthStore();
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await authAPI.login({ email, password });
      if (data.data.require2FA) {
        setTempToken(data.data.tempToken);
      } else {
        login(data.data.user, data.data.token, data.data.refreshToken);
        navigate(data.data.user.role === 'admin' ? '/admin/dashboard' : '/client/dashboard');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  const handle2FA = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await authAPI.verify2fa({ tempToken, code });
      login(data.data.user, data.data.token, data.data.refreshToken);
      navigate(data.data.user.role === 'admin' ? '/admin/dashboard' : '/client/dashboard');
    } catch { toast.error('Invalid 2FA code'); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white">Zenith</h1>
          <p className="text-slate-400 mt-2">VPS Management Platform</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {!tempToken ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none" />
              </div>
              <button type="submit" disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50">
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handle2FA} className="space-y-5">
              <p className="text-slate-600 text-sm">Enter the 6-digit code from your authenticator app.</p>
              <input type="text" value={code} onChange={e => setCode(e.target.value)} maxLength={6} placeholder="000000"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-center text-2xl tracking-widest focus:ring-2 focus:ring-indigo-500 outline-none" />
              <button type="submit" disabled={loading}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50">
                {loading ? 'Verifying…' : 'Verify'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
