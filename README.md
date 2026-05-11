# Zenith — VPS Management Platform (Proxmox Edition)

```
  ██╗  ██╗██╗    ██╗██╗██╗  ██╗██████╗  █████╗ ███╗   ██╗███████╗██╗
  ██║ ██╔╝██║    ██║██║██║ ██╔╝██╔══██╗██╔══██╗████╗  ██║██╔════╝██║
  █████╔╝ ██║ █╗ ██║██║█████╔╝ ██████╔╝███████║██╔██╗ ██║█████╗  ██║
  ██╔═██╗ ██║███╗██║██║██╔═██╗ ██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║
  ██║  ██╗╚███╔███╔╝██║██║  ██╗██║     ██║  ██║██║ ╚████║███████╗███████╗
                         Version 1.0.0 — Proxmox Edition
```

Professional VPS management panel built on top of Proxmox VE, with WHMCS integration.

---

## Architecture

```
  [ WHMCS ]  ←→  [ Zenith Panel Server ]  ←→  [ Proxmox Node 1 ]
                   Node.js API + React UI          [ Proxmox Node 2 ]
                   MySQL + Redis                   [ Proxmox Node N ]
```

Zenith sits on top of Proxmox VE — it manages your existing Proxmox servers via the Proxmox REST API. No agents on nodes. No changes to Proxmox configuration.

---

## Features

| Feature | Details |
|---------|---------|
| Hypervisors | KVM/QEMU + LXC (via Proxmox API) |
| Multi-node | Manage multiple Proxmox servers |
| VPS lifecycle | Create, start, stop, restart, suspend, delete |
| Console | Proxmox noVNC (built-in, battle-tested) |
| Backups | Proxmox vzdump (snapshot mode, zstd compressed) |
| Templates | LXC: browse Proxmox library. KVM: clone from Proxmox VM template |
| WHMCS | Full auto-provision, suspend, unsuspend, terminate |
| Client portal | Power controls, console, backups, OS reinstall |
| 2FA | TOTP (Google Authenticator) |
| API | Full REST API with Bearer + API Key auth |

---

## Requirements

**Panel server** (where Zenith runs):
- Ubuntu 22.04 LTS or Debian 12
- 2 GB RAM minimum
- Does NOT need KVM capability

**Hypervisor nodes** (your existing servers):
- Proxmox VE 7.x or 8.x (community edition is fine)
- An API token created for Zenith

---

## Quick Start

```bash
bash install.sh
```

After installation:
1. Login to the admin panel
2. Add your Proxmox nodes (**Admin → Nodes → Add Node**)
3. Add OS templates (**Admin → Templates**)
4. Create plans (**Admin → Plans**)
5. Add IP pools if you have static IPs (**Admin → IP Pools**)

---

## Technology Stack

| Component | Technology |
|-----------|-----------|
| Backend API | Node.js 20 + Fastify 4 |
| Frontend | React 18 + Tailwind CSS |
| Database | MySQL 8 |
| Queue | BullMQ + Redis |
| Hypervisor | Proxmox VE REST API |
| Console | Proxmox built-in noVNC |
| Process | PM2 |
| Web Server | Nginx |

---

## License

Copyright © 2024 Zenith. All rights reserved. Proprietary and confidential.
