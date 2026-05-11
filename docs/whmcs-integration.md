# WHMCS Integration Guide

Zenith includes a native WHMCS server module that enables automatic VPS provisioning, suspension, and termination triggered by WHMCS billing events.

---

## Prerequisites

- WHMCS 8.x installed and running
- Zenith panel installed and accessible
- PHP 8.0+ with cURL enabled on WHMCS server
- WHMCS API key from Zenith (see Settings → Security)

---

## Step 1: Install the WHMCS Module

1. Upload the `whmcs-module/modules/servers/zenith/` directory to your WHMCS installation:

```
your-whmcs/
└── modules/
    └── servers/
        └── zenith/           ← upload this folder
            ├── zenith.php
            ├── clientarea.tpl
            └── lib/
                └── ZenithAPI.php
```

Via SCP:
```bash
scp -r whmcs-module/modules/servers/zenith/ \
    root@WHMCS_SERVER:/path/to/whmcs/modules/servers/
```

---

## Step 2: Add Zenith Server in WHMCS

1. Go to **WHMCS Admin → System Settings → Servers**
2. Click **Add New Server**
3. Fill in:
   - **Name:** Zenith
   - **Hostname:** `panel.yourdomain.com` (your Zenith URL without https://)
   - **Secure:** ✓ (check if using HTTPS)
   - **Type:** Zenith
   - **Password:** paste your WHMCS API Key from Zenith Settings
4. Click **Test Connection** — should show "Connection Successful"
5. Save

---

## Step 3: Create a Server Group

1. Go to **System Settings → Server Groups → Create Server Group**
2. Name it (e.g., "Zenith VPS")
3. Add your Zenith server to the group
4. Save

---

## Step 4: Create a Product/Plan

1. Go to **System Settings → Products/Services → Create a New Product**
2. **Product Type:** Server/VPS
3. **Module:** Zenith
4. Fill in product details (name, pricing, description)
5. Go to the **Module Settings** tab:
   - **Server Group:** Zenith VPS
   - **Plan ID:** (numeric ID from Zenith Admin → Plans)
   - **Template ID:** (numeric ID from Zenith Admin → Templates)
   - **Node ID:** (leave blank for auto-select, or enter specific node ID)
6. Save

---

## Step 5: Create Custom Field (VPS UUID)

This field stores the VPS UUID so WHMCS can reference it for future actions.

1. Go to your product → **Custom Fields** tab
2. Click **Add New Custom Field**:
   - **Field Name:** `vps_uuid`
   - **Field Type:** Text Box
   - **Admin Only:** ✓ (check — clients shouldn't see this)
   - **Show on Order Form:** ✗ (uncheck)
3. Save

---

## Step 6: Configure Automation

Ensure WHMCS cron is running (should already be set up):

```bash
# Verify cron is running
crontab -l | grep whmcs
# Should show: */5 * * * * php /path/to/whmcs/cron/cron.php
```

Enable automation in WHMCS:
- **System Settings → Automation Settings**
- Enable: Auto Provisioning, Auto Suspension, Auto Termination

---

## How It Works

| WHMCS Event | Zenith Action |
|-------------|-----------------|
| Order paid / manually activated | VPS created with selected plan + template |
| Invoice overdue (auto-suspend) | VPS suspended (powered off, inaccessible) |
| Invoice paid (auto-unsuspend) | VPS unsuspended (powered back on) |
| Service cancelled / terminated | VPS permanently deleted |

---

## Testing the Integration

### Test Provisioning
1. Place a test order using your Zenith product
2. Mark payment as received
3. Check WHMCS → Services — service should show "Active"
4. Check Zenith Admin → Virtual Servers — VPS should appear

### Test Suspension
1. In WHMCS Admin → Services → select service
2. Click **Suspend** (or set invoice to overdue)
3. Verify VPS shows "suspended" in Zenith

### Test Termination
1. In WHMCS Admin → Services → select service
2. Click **Terminate**
3. Verify VPS is deleted in Zenith

---

## Troubleshooting

### "Connection Refused" on Test Connection
- Verify Zenith is running: `pm2 list`
- Check firewall: port 443 must be open
- Confirm WHMCS API key matches Zenith Settings

### VPS Not Created
- Check WHMCS Module Log: **Utilities → Logs → Module Log**
- Verify Plan ID and Template ID are correct
- Check Zenith Task Queue for errors

### UUID Not Saved
- Ensure `vps_uuid` custom field exists on the product
- Check Module Log for save errors

### Enable Module Logging
In WHMCS: **Utilities → Logs → Module Log → Enable**
After testing, disable logging to avoid performance impact.

---

## Client Area

After installation, clients will see a **"Manage VPS in Zenith"** button in their WHMCS client area for the service. This links directly to the Zenith client portal where they can:
- Start/stop/restart their VPS
- Access the web console
- Create backups
- Reinstall the OS

---

## API Reference

Zenith exposes a REST API that WHMCS uses:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/whmcs/provision` | Create VPS |
| POST | `/api/v1/whmcs/:uuid/suspend` | Suspend VPS |
| POST | `/api/v1/whmcs/:uuid/unsuspend` | Unsuspend VPS |
| DELETE | `/api/v1/whmcs/:uuid` | Terminate VPS |
| GET | `/api/v1/whmcs/:uuid/status` | Get VPS status |
| GET | `/health` | Panel health check |

All requests require the header: `X-WHMCS-Key: your-api-key`
