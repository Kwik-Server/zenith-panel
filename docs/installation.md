# Zenith Installation Guide

## System Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| OS | Ubuntu 20.04 LTS | Ubuntu 22.04 LTS |
| CPU | 4 cores (KVM-capable) | 8+ cores |
| RAM | 8 GB | 16 GB |
| Disk | 50 GB | 200 GB+ |
| Network | Static IP | Static IP + IPv6 |

> **CPU Requirement:** Your server CPU must support hardware virtualization (Intel VT-x or AMD-V). Verify with: `egrep -c '(vmx|svm)' /proc/cpuinfo` — must return > 0.

---

## Quick Installation

```bash
# 1. Upload Zenith to your server
scp zenith-v1.0.0.zip root@YOUR_SERVER_IP:/root/

# 2. SSH into your server
ssh root@YOUR_SERVER_IP

# 3. Extract and install
cd /root
unzip zenith-v1.0.0.zip
cd zenith
bash install.sh
```

The installer will:
- Ask for your domain and admin credentials
- Install all dependencies automatically
- Configure the database and Redis
- Build the frontend
- Configure Nginx and SSL
- Start all services with PM2

---

## Post-Installation

### Verify Services

```bash
pm2 list          # Check API and worker status
pm2 logs          # View live logs
systemctl status nginx
systemctl status mysql
systemctl status redis-server
```

### First Login

1. Open `https://your-panel-domain.com`
2. Login with your admin email and password
3. Add your first hypervisor node: **Admin → Nodes → Add Node**

---

## Manual Installation

If you prefer to install manually:

### 1. Install Dependencies

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# MySQL 8
apt-get install -y mysql-server
systemctl start mysql

# Redis
apt-get install -y redis-server

# Nginx + Certbot
apt-get install -y nginx certbot python3-certbot-nginx

# KVM + libvirt
apt-get install -y qemu-kvm libvirt-daemon-system libvirt-clients \
  bridge-utils virtinst libguestfs-tools genisoimage cloud-image-utils ovmf

# LXC
apt-get install -y lxc lxc-utils

# noVNC
git clone https://github.com/novnc/noVNC.git /opt/novnc

# PM2
npm install -g pm2
```

### 2. Create Database

```bash
mysql -u root << EOF
CREATE DATABASE zenith CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'zenith'@'localhost' IDENTIFIED BY 'YOUR_DB_PASSWORD';
GRANT ALL PRIVILEGES ON zenith.* TO 'zenith'@'localhost';
FLUSH PRIVILEGES;
EOF
```

### 3. Configure Panel

```bash
cp -r zenith /opt/zenith
cd /opt/zenith/backend
cp .env.example .env
nano .env   # Fill in your values
```

### 4. Install & Migrate

```bash
cd /opt/zenith/backend
npm install --production
node src/db/migrate.js
```

### 5. Build Frontend

```bash
cd /opt/zenith/frontend
npm install
echo "VITE_API_URL=https://your-domain.com" > .env
npm run build
```

### 6. Nginx

```bash
cp /opt/zenith/config/nginx.conf /etc/nginx/sites-available/zenith
# Edit the file and replace YOUR_DOMAIN
sed -i 's/YOUR_DOMAIN/your-domain.com/g' /etc/nginx/sites-available/zenith
ln -s /etc/nginx/sites-available/zenith /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d your-domain.com
```

### 7. Start Services

```bash
cp /opt/zenith/config/ecosystem.config.cjs /opt/zenith/
cd /opt/zenith
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## Adding Hypervisor Nodes

1. Login as admin → **Nodes → Add Node**
2. Fill in: Node Name, IP address, SSH credentials
3. Upload SSH private key (recommended over password)
4. Click **Test Connection** to verify
5. Set total CPU/RAM/Disk for resource tracking

### SSH Key Setup (on node server)

```bash
# On your panel server, generate key:
ssh-keygen -t ed25519 -f /root/.ssh/zenith -N ""

# Copy public key to node:
ssh-copy-id -i /root/.ssh/zenith.pub root@NODE_IP

# Paste contents of /root/.ssh/zenith (private key) into the panel
cat /root/.ssh/zenith
```

---

## Troubleshooting

### Panel not loading
```bash
pm2 logs zenith-api --lines 50
systemctl status nginx
```

### Database connection error
```bash
mysql -u zenith -p zenith  # Test connection
# Check .env DB_PASS matches MySQL user password
```

### VPS not creating
```bash
pm2 logs zenith-worker --lines 100
# Check that libvirt is running on the node
ssh root@NODE_IP "systemctl status libvirtd"
```

### Reinstall panel (keep data)
```bash
cd /opt/zenith/backend
npm install --production
node src/db/migrate.js
pm2 restart all
```

---

## Log Locations

| Log | Path |
|-----|------|
| API server | `/var/log/zenith/api-out.log` |
| API errors | `/var/log/zenith/api-error.log` |
| Worker | `/var/log/zenith/worker-out.log` |
| Nginx | `/var/log/nginx/zenith.access.log` |
| Install | `/var/log/zenith-install.log` |
| Audit | In MySQL `audit_logs` table |

---

## Upgrading

```bash
# Stop services
pm2 stop all

# Backup database
mysqldump -u zenith -p zenith > /root/zenith-backup-$(date +%Y%m%d).sql

# Upload and extract new version
unzip zenith-vX.X.X.zip -d /tmp/zenith-new

# Update files (keep .env)
cp /opt/zenith/backend/.env /tmp/.env.backup
rsync -av --exclude='.env' /tmp/zenith-new/backend/ /opt/zenith/backend/
rsync -av /tmp/zenith-new/frontend/ /opt/zenith/frontend/
cp /tmp/.env.backup /opt/zenith/backend/.env

# Install new dependencies
cd /opt/zenith/backend && npm install --production

# Run migrations
node src/db/migrate.js

# Rebuild frontend
cd /opt/zenith/frontend && npm install && npm run build

# Restart
pm2 restart all
```
