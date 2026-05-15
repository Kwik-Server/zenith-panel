# Adding a New Proxmox Node to Zenith

## On the New Proxmox Server

### Step 1 — Create API Token

In the Proxmox web UI:
1. Go to **Datacenter → Permissions → API Tokens → Add**
   - User: `root@pam`
   - Token ID: `zenith`
   - Privilege Separation: **unchecked**
   - Copy the token secret immediately (shown only once)

2. Go to **Datacenter → Permissions → Add → API Token Permission**
   - Path: `/`
   - Token: `root@pam!zenith`
   - Role: `Administrator`
   - Propagate: ✓

### Step 2 — Enable Proxmox Firewall Safely

Add critical rules FIRST, then enable. This prevents lockout.

```bash
# Allow SSH access
pvesh create /cluster/firewall/rules --action ACCEPT --type in --proto tcp --dport 22 --comment "Allow SSH"

# Allow Proxmox web UI
pvesh create /cluster/firewall/rules --action ACCEPT --type in --proto tcp --dport 8006 --comment "Allow Proxmox UI"

# Set ACCEPT policy (all unmatched traffic passes through)
pvesh set /cluster/firewall/options --policy_in ACCEPT --policy_out ACCEPT

# Enable firewall
pve-firewall start
```

**Verify access is still working:**
```bash
curl -sk https://localhost:8006 | grep -o "Proxmox" | head -1
```

Should return `Proxmox`. Confirm SSH still works before continuing.

### Step 3 — Copy SSH-Enabled Templates from Existing Server

```bash
rsync -avz root@EXISTING_PROXMOX_IP:/var/lib/vz/template/cache/*-ssh-enabled.tar.zst /var/lib/vz/template/cache/
rsync -avz root@EXISTING_PROXMOX_IP:/var/lib/vz/template/cache/rescue-ubuntu.tar.zst /var/lib/vz/template/cache/
```

Replace `EXISTING_PROXMOX_IP` with `184.107.3.207`.

### Step 4 — Enable Snippets and Copy Rescue Script

```bash
pvesm set local --content rootdir,vztmpl,iso,backup,snippets
rsync -avz root@EXISTING_PROXMOX_IP:/var/lib/vz/snippets/ /var/lib/vz/snippets/
```

### Step 5 — Note Your Node Name

```bash
hostname
```

Save this — you'll need it when adding the node in Zenith.

---

## On the Zenith Panel

### Step 1 — Add the New Node

Go to **Admin → Nodes → Add Node**:

| Field | Value |
|-------|-------|
| Node Name | e.g. `Node 2` |
| Proxmox Hostname/IP | New server's IP |
| API Port | `8006` |
| API Token ID | `root@pam!zenith` |
| API Token Secret | Token from Proxmox Step 1 |
| PVE Node Name | Output of `hostname` from Proxmox Step 5 |
| VM Storage | `local` |
| Backup Storage | `local` |
| Location | e.g. `Germany` |
| Type | `KVM + LXC` |
| Total CPU/RAM/Disk | Your server specs |

Click **Test Connection** — should show success.

### Step 2 — Add IP Pool for New Node

Go to **Admin → IP Pools → New Pool**:
- Set **Node** to the new node
- Add the IP range assigned to this server
- Set gateway and netmask
- Add Leaseweb API key if rDNS management is needed for this location

### Step 3 — Templates

No action needed — existing Zenith template entries work across all nodes because the template path (`local:vztmpl/ubuntu-22.04-ssh-enabled.tar.zst`) refers to local storage on whichever node creates the VPS.

Templates were copied in Proxmox Step 3.

---

## Notes

- Each Proxmox node needs the SSH-enabled templates on its own local storage
- The Zenith panel server IP must be whitelisted in Leaseweb API settings for rDNS to work on each new node
- Container firewall (ACCEPT policy) is automatically enabled by Zenith when creating VPS instances
