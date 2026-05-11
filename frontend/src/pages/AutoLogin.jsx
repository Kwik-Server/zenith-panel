import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authAPI } from '../api/client';
import { useAuthStore } from '../store/authStore';

export default function AutoLogin() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setError('No token provided'); return; }

    authAPI.autologin(token)
      .then(({ data }) => {
        login(data.data.user, data.data.token, data.data.refreshToken);
        navigate(data.data.user.role === 'admin' ? '/admin/dashboard' : '/client/dashboard', { replace: true });
      })
      .catch(() => setError('This link has expired or is invalid. Please request a new one from your client area.'));
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl p-8 w-full max-w-sm text-center">
        {error ? (
          <>
            <div className="text-red-500 text-4xl mb-4">✗</div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Link Expired</h2>
            <p className="text-sm text-slate-500 mb-4">{error}</p>
            <a href="/login" className="text-indigo-600 text-sm font-medium hover:underline">Go to Login</a>
          </>
        ) : (
          <>
            <div className="animate-spin w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-slate-600 text-sm">Logging you in...</p>
          </>
        )}
      </div>
    </div>
  );
}
