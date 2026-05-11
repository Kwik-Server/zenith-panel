# Zenith REST API Reference

## Base URL
```
https://your-panel-domain.com/api/v1
```

## Authentication

Zenith supports two authentication methods:

### JWT Bearer Token
```
Authorization: Bearer <token>
```

### API Key Header
```
X-API-Key: <your-api-key>
```

### WHMCS Module Key
```
X-WHMCS-Key: <whmcs-api-key>
```
Used exclusively for WHMCS module endpoints.

---

## Response Format

All responses follow a consistent format:

**Success:**
```json
{ "success": true, "data": { ... }, "message": "Optional message" }
```

**Error:**
```json
{ "success": false, "error": "Error description", "details": {} }
```

---

## Rate Limiting

- General: 200 requests/minute
- Auth endpoints: 10 requests/minute

Rate limit headers are included in all responses:
- `X-RateLimit-Limit`
- `X-RateLimit-Remaining`
- `X-RateLimit-Reset`

---

## Authentication Endpoints

### POST /auth/login
Login with email and password.

**Request:**
```json
{ "email": "admin@example.com", "password": "yourpassword" }
```

**Response (no 2FA):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGc...",
    "refreshToken": "eyJhbGc...",
    "user": { "id": 1, "email": "admin@example.com", "role": "admin" }
  }
}
```

**Response (2FA required):**
```json
{ "success": true, "data": { "require2FA": true, "tempToken": "eyJhbGc..." } }
```

---

### POST /auth/2fa/verify
Verify 2FA code and exchange for full token.

**Request:**
```json
{ "tempToken": "eyJhbGc...", "code": "123456" }
```

---

### POST /auth/refresh
Refresh an expired JWT token.

**Request:**
```json
{ "refreshToken": "eyJhbGc..." }
```

---

### GET /auth/me
Get current authenticated user.

**Headers:** `Authorization: Bearer <token>`

---

## Admin Endpoints

> All admin endpoints require an admin user token.

### GET /admin/dashboard
Get dashboard statistics.

**Response:**
```json
{
  "vps": { "total": 42, "running": 30, "stopped": 8, "suspended": 4 },
  "users": { "total": 25, "clients": 23, "admins": 2 },
  "nodes": { "total": 3, "online": 3, "offline": 0 },
  "tasks": { "pending": 2, "running": 1, "failed": 0 },
  "recentTasks": [...],
  "recentLogs": [...]
}
```

---

### Nodes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/nodes | List all nodes |
| POST | /admin/nodes | Add node |
| GET | /admin/nodes/:id | Get node details |
| PUT | /admin/nodes/:id | Update node |
| DELETE | /admin/nodes/:id | Delete node |
| POST | /admin/nodes/:id/test | Test SSH connection |
| GET | /admin/nodes/:id/stats | Get live resource stats |

**Create Node body:**
```json
{
  "name": "NYC-Node-01",
  "hostname": "node1.example.com",
  "ip_address": "203.0.113.1",
  "ssh_port": 22,
  "ssh_user": "root",
  "ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\n...",
  "type": "kvm",
  "location": "New York, USA",
  "total_cpu": 32,
  "total_ram": 65536,
  "total_disk": 2000
}
```

---

### VPS

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/vps | List VPS (paginated) |
| POST | /admin/vps | Create VPS |
| GET | /admin/vps/:id | Get VPS details |
| PUT | /admin/vps/:id | Update VPS |
| DELETE | /admin/vps/:id | Delete VPS (queued) |
| POST | /admin/vps/:id/start | Start VPS |
| POST | /admin/vps/:id/stop | Stop VPS (graceful) |
| POST | /admin/vps/:id/restart | Restart VPS |
| POST | /admin/vps/:id/forceStop | Force stop VPS |
| POST | /admin/vps/:id/suspend | Suspend VPS |
| POST | /admin/vps/:id/unsuspend | Unsuspend VPS |
| GET | /admin/vps/:id/console | Get VNC console URL |

**Create VPS body:**
```json
{
  "hostname": "vps01.example.com",
  "user_id": 5,
  "node_id": 1,
  "plan_id": 2,
  "template_id": 1,
  "root_password": "SecurePass123!"
}
```

**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "VPS creation queued",
  "data": { "vps": { "id": 42, "uuid": "...", "status": "creating", ... } }
}
```

---

### Users

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/users | List users |
| POST | /admin/users | Create user |
| GET | /admin/users/:id | Get user + VPS list |
| PUT | /admin/users/:id | Update user |
| DELETE | /admin/users/:id | Delete user |
| POST | /admin/users/:id/suspend | Suspend user |
| POST | /admin/users/:id/unsuspend | Unsuspend user |

---

### Plans

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/plans | List plans |
| POST | /admin/plans | Create plan |
| GET | /admin/plans/:id | Get plan |
| PUT | /admin/plans/:id | Update plan |
| DELETE | /admin/plans/:id | Delete plan |

---

### Templates

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/templates | List templates |
| POST | /admin/templates | Add template |
| GET | /admin/templates/:id | Get template |
| PUT | /admin/templates/:id | Update template |
| DELETE | /admin/templates/:id | Delete template |

---

### IP Pools

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/ippools | List pools |
| POST | /admin/ippools | Create pool |
| GET | /admin/ippools/:id | Get pool + IPs |
| DELETE | /admin/ippools/:id | Delete pool |
| POST | /admin/ippools/:id/ips | Add IPs to pool |
| DELETE | /admin/ippools/:id/ips/:ipId | Remove IP |

**Add IPs body:**
```json
{ "ip_addresses": ["203.0.113.10", "203.0.113.11", "203.0.113.12"] }
```

---

### Tasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/tasks | List tasks (filter: ?status=pending) |
| DELETE | /admin/tasks/:id/cancel | Cancel pending task |

---

### Logs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/logs | List audit logs |

**Query params:** `?page=1&limit=50&action=login&user_id=5`

---

### Settings

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /admin/settings | Get all settings |
| PUT | /admin/settings | Update settings |
| POST | /admin/settings/test-smtp | Test SMTP config |

**Update settings body:**
```json
{ "panel_name": "MyPanel", "smtp_host": "smtp.example.com" }
```

---

## Client Endpoints

> Require any authenticated user token (admin or client).
> Client users can only access their own VPS.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /client/vps | List user's VPS |
| GET | /client/vps/:id | Get VPS details |
| POST | /client/vps/:id/start | Start VPS |
| POST | /client/vps/:id/stop | Stop VPS |
| POST | /client/vps/:id/restart | Restart VPS |
| POST | /client/vps/:id/reinstall | Reinstall OS |
| GET | /client/vps/:id/console | Get console URL |
| GET | /client/vps/:id/stats | Get resource usage |
| GET | /client/vps/:id/backups | List backups |
| POST | /client/vps/:id/backup | Create backup |
| POST | /client/vps/:id/backups/:backupId/restore | Restore backup |
| GET | /client/profile | Get profile |
| PUT | /client/profile | Update profile |
| POST | /client/profile/change-password | Change password |
| POST | /client/profile/2fa/setup | Setup 2FA |
| POST | /client/profile/2fa/enable | Enable 2FA |
| POST | /client/profile/2fa/disable | Disable 2FA |
| GET | /client/profile/apikey | Get API key |
| POST | /client/profile/apikey | Regenerate API key |

---

## WHMCS Endpoints

> Require `X-WHMCS-Key: <key>` header (set in Zenith Settings → Security).

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /whmcs/provision | Create VPS from WHMCS |
| POST | /whmcs/:uuid/suspend | Suspend VPS |
| POST | /whmcs/:uuid/unsuspend | Unsuspend VPS |
| DELETE | /whmcs/:uuid | Terminate VPS |
| GET | /whmcs/:uuid/status | Get VPS status |

**Provision body:**
```json
{
  "plan_id": 2,
  "template_id": 1,
  "hostname": "customer01.vps.example.com",
  "root_password": "SecurePass123!",
  "user_email": "customer@example.com",
  "whmcs_service_id": "1234",
  "node_id": 1
}
```

**Provision response:**
```json
{
  "success": true,
  "message": "VPS creation queued",
  "data": {
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "vps_id": 42,
    "hostname": "customer01.vps.example.com",
    "root_password": "SecurePass123!"
  }
}
```

---

## Error Codes

| HTTP | Meaning |
|------|---------|
| 400 | Bad Request — missing or invalid parameters |
| 401 | Unauthorized — invalid or expired token |
| 403 | Forbidden — insufficient permissions |
| 404 | Not Found |
| 409 | Conflict — duplicate resource |
| 422 | Unprocessable — action cannot be performed |
| 429 | Too Many Requests — rate limited |
| 500 | Internal Server Error |
