import { query } from '../config/database.js';

export async function logAction(userId, action, resourceType, resourceId, details, ipAddress) {
  await query(
    'INSERT INTO audit_logs (user_id, action, resource_type, resource_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
    [userId, action, resourceType, resourceId, details ? JSON.stringify(details) : null, ipAddress]
  );
}
