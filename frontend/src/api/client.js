import axios from 'axios';
import { useAuthStore } from '../store/authStore';

const BASE = import.meta.env.VITE_API_URL || '';

const api = axios.create({ baseURL: `${BASE}/api/v1` });

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const { refreshToken, setToken, logout } = useAuthStore.getState();
      if (refreshToken) {
        try {
          const { data } = await axios.post(`${BASE}/api/v1/auth/refresh`, { refreshToken });
          setToken(data.data.token);
          error.config.headers.Authorization = `Bearer ${data.data.token}`;
          return api(error.config);
        } catch { logout(); }
      } else { logout(); }
    }
    return Promise.reject(error);
  }
);

// Auth
export const authAPI = {
  login:      (d) => api.post('/auth/login', d),
  verify2fa:  (d) => api.post('/auth/2fa/verify', d),
  me:         ()  => api.get('/auth/me'),
  autologin:  (t) => api.get(`/auth/autologin?token=${t}`),
};

// Admin
export const adminAPI = {
  // Dashboard
  dashboard: () => api.get('/admin/dashboard'),

  // Nodes
  getNodes:            ()     => api.get('/admin/nodes'),
  getNodeAvailability: ()     => api.get('/admin/nodes/availability'),
  createNode:  (d)    => api.post('/admin/nodes', d),
  getNode:     (id)   => api.get(`/admin/nodes/${id}`),
  updateNode:  (id,d) => api.put(`/admin/nodes/${id}`, d),
  deleteNode:  (id)   => api.delete(`/admin/nodes/${id}`),
  testNode:    (id)   => api.post(`/admin/nodes/${id}/test`),
  nodeStats:   (id)   => api.get(`/admin/nodes/${id}/stats`),

  // VPS
  getVps:      (params) => api.get('/admin/vps', { params }),
  createVps:   (d)      => api.post('/admin/vps', d),
  importVps:           (d)   => api.post('/admin/vps/import', d),
  reconfigureNetwork:  (id)  => api.post(`/admin/vps/${id}/reconfigure-network`),
  forceDeleteVps:      (id)  => api.delete(`/admin/vps/${id}/force`),
  getVpsDetail:(id)     => api.get(`/admin/vps/${id}`),
  deleteVps:   (id)     => api.delete(`/admin/vps/${id}`),
  vpsAction:   (id, a, d) => api.post(`/admin/vps/${id}/${a}`, d || {}),
  vpsConsole:  (id)     => api.get(`/admin/vps/${id}/console`),
  vpsStats:    (id)     => api.get(`/admin/vps/${id}/stats`),
  getVpsIps:   (id)     => api.get(`/admin/vps/${id}/ips`),
  assignVpsIp: (id, d)  => api.post(`/admin/vps/${id}/ips`, d),
  removeVpsIp: (id, ipId) => api.delete(`/admin/vps/${id}/ips/${ipId}`),
  setPrimaryVpsIp: (id, ipId) => api.put(`/admin/vps/${id}/ips/${ipId}/primary`),
  getVpsRdns:  (id)     => api.get(`/admin/vps/${id}/rdns`),
  updateVpsRdns:(id, d) => api.put(`/admin/vps/${id}/rdns`, d),
  updateAdminVps: (id, d) => api.put(`/admin/vps/${id}`, d),
  getVpsFirewall:         (id)        => api.get(`/admin/vps/${id}/firewall`),
  addVpsFirewallRule:     (id, d)     => api.post(`/admin/vps/${id}/firewall`, d),
  updateVpsFirewallRule:  (id, pos, d)=> api.put(`/admin/vps/${id}/firewall/${pos}`, d),
  deleteVpsFirewallRule:  (id, pos)   => api.delete(`/admin/vps/${id}/firewall/${pos}`),
  setVpsFirewallOptions:  (id, d)     => api.put(`/admin/vps/${id}/firewall-options`, d),

  // Users
  getUsers:    ()     => api.get('/admin/users'),
  createUser:  (d)    => api.post('/admin/users', d),
  getUser:     (id)   => api.get(`/admin/users/${id}`),
  updateUser:  (id,d) => api.put(`/admin/users/${id}`, d),
  deleteUser:  (id)   => api.delete(`/admin/users/${id}`),
  suspendUser: (id)   => api.post(`/admin/users/${id}/suspend`),
  unsuspendUser:(id)  => api.post(`/admin/users/${id}/unsuspend`),

  // Plans
  getPlans:    ()     => api.get('/admin/plans'),
  createPlan:  (d)    => api.post('/admin/plans', d),
  updatePlan:  (id,d) => api.put(`/admin/plans/${id}`, d),
  deletePlan:  (id)   => api.delete(`/admin/plans/${id}`),

  // Templates
  getTemplates:    ()       => api.get('/admin/templates'),
  createTemplate:  (d)      => api.post('/admin/templates', d),
  updateTemplate:  (id, d)  => api.put(`/admin/templates/${id}`, d),
  deleteTemplate:  (id)     => api.delete(`/admin/templates/${id}`),
  proxmoxTemplates:         (nodeId)        => api.get(`/admin/templates/proxmox/${nodeId}/available`),
  proxmoxInstalledTemplates:(nodeId, storage) => api.get(`/admin/templates/proxmox/${nodeId}/installed${storage ? `?storage=${storage}` : ''}`),
  downloadTemplate:(nodeId,d) => api.post(`/admin/templates/proxmox/${nodeId}/download`, d),

  // IP Pools
  getIpPools:      ()         => api.get('/admin/ippools'),
  updatePool:      (id, d)    => api.put(`/admin/ippools/${id}`, d),
  getAvailableIps: (nodeId)   => api.get(`/admin/ippools/available?node_id=${nodeId}`),
  createPool:      (d)        => api.post('/admin/ippools', d),
  getPool:         (id)       => api.get(`/admin/ippools/${id}`),
  deletePool:      (id)       => api.delete(`/admin/ippools/${id}`),
  addIps:          (id, d)    => api.post(`/admin/ippools/${id}/ips`, d),
  removeIp:        (pid, iid) => api.delete(`/admin/ippools/${pid}/ips/${iid}`),
  updateIpMac:     (pid, iid, mac) => api.put(`/admin/ippools/${pid}/ips/${iid}`, { mac_address: mac }),

  // Tasks & Logs
  getTasks:    (params) => api.get('/admin/tasks', { params }),
  getLogs:     (params) => api.get('/admin/logs', { params }),

  // Settings
  getSettings: ()  => api.get('/admin/settings'),
  saveSettings:(d) => api.put('/admin/settings', d),
  getWhmcsKey: ()  => api.get('/admin/settings/whmcs-key'),
  testSmtp:    (d) => api.post('/admin/settings/test-smtp', d),
  testWhmcs:   ()  => api.post('/admin/settings/test-whmcs'),

  // Abuse
  getAbuseCases:       (params)   => api.get('/admin/abuse', { params }),
  getAbuseStatus:      ()         => api.get('/admin/abuse/status'),
  getAbuseCase:        (id)       => api.get(`/admin/abuse/${id}`),
  pollAbuse:           ()         => api.post('/admin/abuse/poll'),
  abuseCaseAction:     (id, a, d) => api.post(`/admin/abuse/${id}/${a}`, d || {}),
  getAbuseResolutions: (id)       => api.get(`/admin/abuse/${id}/resolutions`),
  createAbuseCase:     (d)        => api.post('/admin/abuse/manual', d),
  testAbuseImap:       ()         => api.post('/admin/abuse/test-imap'),
};

// Client
export const clientAPI = {
  getVps:         ()      => api.get('/client/vps'),
  getTemplates:   ()      => api.get('/client/vps/templates'),
  updateVps:      (id, d) => api.put(`/client/vps/${id}`, d),
  enableRescue:   (id)    => api.post(`/client/vps/${id}/rescue`),
  disableRescue:  (id)    => api.delete(`/client/vps/${id}/rescue`),
  getRdns:        (id)    => api.get(`/client/vps/${id}/rdns`),
  updateRdns:     (id, d) => api.put(`/client/vps/${id}/rdns`, d),
  getFirewall:    (id)    => api.get(`/client/vps/${id}/firewall`),
  addFirewallRule:(id, d) => api.post(`/client/vps/${id}/firewall`, d),
  updateFirewallRule:(id, pos, d) => api.put(`/client/vps/${id}/firewall/${pos}`, d),
  deleteFirewallRule:(id, pos)    => api.delete(`/client/vps/${id}/firewall/${pos}`),
  setFirewallOptions:(id, d)      => api.put(`/client/vps/${id}/firewall-options`, d),
  getVpsDetail:   (id)    => api.get(`/client/vps/${id}`),
  vpsAction:      (id, a) => api.post(`/client/vps/${id}/${a}`),
  vpsStats:       (id)    => api.get(`/client/vps/${id}/stats`),
  vpsConsole:     (id)    => api.get(`/client/vps/${id}/console`),
  reinstall:      (id, d) => api.post(`/client/vps/${id}/reinstall`, d),
  getBackups:     (id)    => api.get(`/client/vps/${id}/backups`),
  createBackup:   (id)    => api.post(`/client/vps/${id}/backup`),
  restoreBackup:  (id,bid)=> api.post(`/client/vps/${id}/backups/${bid}/restore`),
  getProfile:     ()      => api.get('/client/profile'),
  updateProfile:  (d)     => api.put('/client/profile', d),
  changePassword: (d)     => api.post('/client/profile/change-password', d),
  setup2fa:       ()      => api.post('/client/profile/2fa/setup'),
  enable2fa:      (d)     => api.post('/client/profile/2fa/enable', d),
  disable2fa:     (d)     => api.post('/client/profile/2fa/disable', d),
  getApiKey:      ()      => api.get('/client/profile/apikey'),
  regenApiKey:    ()      => api.post('/client/profile/apikey'),
};
