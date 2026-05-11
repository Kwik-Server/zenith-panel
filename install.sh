#!/bin/bash
# Zenith Installation Script v1.0.0
# Supports: Ubuntu 20.04, 22.04 | Debian 11, 12
# Run as root on the PANEL server (not on Proxmox nodes)
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

PANEL_DIR="/opt/zenith"
LOG_FILE="/var/log/zenith-install.log"
STEP=0; TOTAL_STEPS=11

log()     { echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE" 2>&1; }
info()    { echo -e "${BLUE}[INFO]${NC} $1"; log "INFO: $1"; }
success() { echo -e "${GREEN}[✓]${NC} $1"; log "OK: $1"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; log "WARN: $1"; }
error()   { echo -e "${RED}[✗] ERROR: $1${NC}"; log "ERROR: $1"; exit 1; }
step()    { STEP=$((STEP+1)); echo -e "\n${BOLD}${CYAN}[${STEP}/${TOTAL_STEPS}] $1${NC}"; log "STEP ${STEP}: $1"; }
divider() { echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"; }

banner() {
cat << 'BANNER'

  ██╗  ██╗██╗    ██╗██╗██╗  ██╗██████╗  █████╗ ███╗   ██╗███████╗██╗
  ██║ ██╔╝██║    ██║██║██║ ██╔╝██╔══██╗██╔══██╗████╗  ██║██╔════╝██║
  █████╔╝ ██║ █╗ ██║██║█████╔╝ ██████╔╝███████║██╔██╗ ██║█████╗  ██║
  ██╔═██╗ ██║███╗██║██║██╔═██╗ ██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║
  ██║  ██╗╚███╔███╔╝██║██║  ██╗██║     ██║  ██║██║ ╚████║███████╗███████╗
                    VPS Management Panel v1.0.0 (Proxmox Edition)
BANNER
echo ""
}

randpass() { tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 || true; }
randstr()  { tr -dc 'a-z0-9' </dev/urandom | head -c 48 || true; }

# Parse arguments
GITHUB_TOKEN=""
for i in "$@"; do
  case $i in
    --github-token=*) GITHUB_TOKEN="${i#*=}" ;;
    --github-token)   shift; GITHUB_TOKEN="${1}" ;;
  esac
done

[[ $EUID -ne 0 ]] && error "Run as root: sudo bash install.sh"
mkdir -p "$(dirname "$LOG_FILE")" && touch "$LOG_FILE"
banner; divider

step "Detecting operating system"
[[ -f /etc/os-release ]] && . /etc/os-release || error "Cannot detect OS"
case "$ID" in
    ubuntu) [[ "$VERSION_ID" =~ ^(20|22) ]] || warn "Ubuntu $VERSION_ID not officially tested" ;;
    debian) [[ "$VERSION_ID" =~ ^(11|12) ]] || warn "Debian $VERSION_ID not officially tested" ;;
    *) error "Unsupported OS: $ID. Supported: Ubuntu 20/22, Debian 11/12" ;;
esac
success "OS: $PRETTY_NAME"

step "Collecting configuration"
divider; echo ""
read -rp "  Panel Domain (e.g. panel.example.com): " PANEL_DOMAIN
[[ -z "$PANEL_DOMAIN" ]] && error "Domain cannot be empty"
read -rp "  Admin Email: " ADMIN_EMAIL
[[ -z "$ADMIN_EMAIL" ]] && error "Admin email required"
while true; do
    read -rsp "  Admin Password (min 8 chars): " ADMIN_PASSWORD; echo
    read -rsp "  Confirm Password: " ADMIN_PASS2; echo
    [[ "$ADMIN_PASSWORD" == "$ADMIN_PASS2" && ${#ADMIN_PASSWORD} -ge 8 ]] && break
    echo "  Passwords don't match or too short."
done

DB_PASS=$(randpass); REDIS_PASS=$(randpass)
JWT_SECRET=$(randstr)$(randstr); JWT_REFRESH=$(randstr)$(randstr)
WHMCS_API_KEY=$(randstr)

echo ""; echo -e "  ${GREEN}Configuration:${NC}"
echo -e "  Domain: ${BOLD}$PANEL_DOMAIN${NC}  Admin: ${BOLD}$ADMIN_EMAIL${NC}"
echo ""

step "Updating system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >> "$LOG_FILE" 2>&1
apt-get upgrade -y -qq >> "$LOG_FILE" 2>&1
apt-get install -y -qq curl wget git unzip gnupg2 ca-certificates lsb-release build-essential >> "$LOG_FILE" 2>&1
success "System updated"

step "Installing Node.js 20 LTS"
if ! command -v node &>/dev/null || [[ $(node --version | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >> "$LOG_FILE" 2>&1
    apt-get install -y -qq nodejs >> "$LOG_FILE" 2>&1
fi
npm install -g pm2 >> "$LOG_FILE" 2>&1
success "Node.js $(node --version) + PM2 installed"

step "Installing MySQL 8"
if ! command -v mysql &>/dev/null; then
    apt-get install -y -qq mysql-server >> "$LOG_FILE" 2>&1
    systemctl enable mysql >> "$LOG_FILE" 2>&1
    systemctl start mysql >> "$LOG_FILE" 2>&1
fi
mysql -u root -e "
    CREATE DATABASE IF NOT EXISTS zenith CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS 'zenith'@'localhost' IDENTIFIED BY '${DB_PASS}';
    GRANT ALL PRIVILEGES ON zenith.* TO 'zenith'@'localhost';
    FLUSH PRIVILEGES;
" >> "$LOG_FILE" 2>&1
success "MySQL configured"

step "Installing Redis"
if ! command -v redis-server &>/dev/null; then
    apt-get install -y -qq redis-server >> "$LOG_FILE" 2>&1
fi
sed -i "s/^# requirepass .*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf
sed -i "s/^requirepass .*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf
echo "requirepass ${REDIS_PASS}" >> /etc/redis/redis.conf
systemctl enable redis-server >> "$LOG_FILE" 2>&1
systemctl restart redis-server >> "$LOG_FILE" 2>&1
success "Redis configured"

step "Installing Nginx + Certbot"
apt-get install -y -qq nginx certbot python3-certbot-nginx >> "$LOG_FILE" 2>&1
systemctl enable nginx >> "$LOG_FILE" 2>&1
success "Nginx + Certbot installed"

step "Installing Zenith files"
REPO_BASE="github.com/Kwik-Server/zenith-panel.git"
mkdir -p "$PANEL_DIR" /var/log/zenith
if [ -d "/tmp/zenith-src" ]; then rm -rf /tmp/zenith-src; fi

# Prompt for token if not provided
if [[ -z "$GITHUB_TOKEN" ]]; then
  echo ""
  echo -e "  ${BOLD}GitHub Personal Access Token${NC} (required for private repo)"
  echo -e "  Generate at: GitHub → Settings → Developer Settings → Tokens (classic)"
  read -rp "  Token: " GITHUB_TOKEN
  [[ -z "$GITHUB_TOKEN" ]] && error "GitHub token is required"
fi

CLONE_URL="https://${GITHUB_TOKEN}@${REPO_BASE}"
git clone --depth=1 "$CLONE_URL" /tmp/zenith-src >> "$LOG_FILE" 2>&1 || error "Failed to clone repository. Check your GitHub token."
cp -r /tmp/zenith-src/backend  "$PANEL_DIR/"
cp -r /tmp/zenith-src/frontend "$PANEL_DIR/"
cp -r /tmp/zenith-src/config   "$PANEL_DIR/"
rm -rf /tmp/zenith-src

cat > "$PANEL_DIR/backend/.env" << ENVEOF
NODE_ENV=production
PORT=3001
HOST=0.0.0.0
DB_HOST=localhost
DB_PORT=3306
DB_USER=zenith
DB_PASS=${DB_PASS}
DB_NAME=zenith
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASS=${REDIS_PASS}
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH}
JWT_EXPIRES_IN=1h
JWT_REFRESH_EXPIRES_IN=7d
PANEL_URL=https://${PANEL_DOMAIN}
PANEL_NAME=Zenith
FRONTEND_URL=https://${PANEL_DOMAIN}
WHMCS_API_KEY=${WHMCS_API_KEY}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ENVEOF
success "Panel files installed"

step "Installing dependencies & running migrations"
cd "$PANEL_DIR/backend"
npm install --production >> "$LOG_FILE" 2>&1
node src/db/migrate.js >> "$LOG_FILE" 2>&1
success "Dependencies installed, database migrated"

step "Building frontend"
cd "$PANEL_DIR/frontend"
npm install >> "$LOG_FILE" 2>&1
cat > .env << ENVEOF
VITE_API_URL=https://${PANEL_DOMAIN}
VITE_PANEL_NAME=Zenith
ENVEOF
npm run build >> "$LOG_FILE" 2>&1
success "Frontend built"

step "Configuring Nginx + SSL"
cp "$PANEL_DIR/config/nginx.conf" /etc/nginx/sites-available/zenith
sed -i "s/YOUR_DOMAIN/${PANEL_DOMAIN}/g" /etc/nginx/sites-available/zenith
ln -sf /etc/nginx/sites-available/zenith /etc/nginx/sites-enabled/zenith
rm -f /etc/nginx/sites-enabled/default
nginx -t >> "$LOG_FILE" 2>&1 && systemctl reload nginx >> "$LOG_FILE" 2>&1
certbot --nginx -d "$PANEL_DOMAIN" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect >> "$LOG_FILE" 2>&1 || \
    warn "SSL failed. Run: certbot --nginx -d ${PANEL_DOMAIN}"
success "Nginx configured"

step "Starting services with PM2"
cp "$PANEL_DIR/config/ecosystem.config.cjs" "$PANEL_DIR/"
cd "$PANEL_DIR"
pm2 start ecosystem.config.cjs >> "$LOG_FILE" 2>&1
pm2 save >> "$LOG_FILE" 2>&1
pm2 startup >> "$LOG_FILE" 2>&1 | tail -1 | bash >> "$LOG_FILE" 2>&1 || true

# Firewall
if command -v ufw &>/dev/null; then
    ufw allow 22/tcp >> "$LOG_FILE" 2>&1
    ufw allow 80/tcp >> "$LOG_FILE" 2>&1
    ufw allow 443/tcp >> "$LOG_FILE" 2>&1
    ufw --force enable >> "$LOG_FILE" 2>&1
fi
success "Services started"

# Save credentials
cat > /root/zenith-credentials.txt << CREDEOF
Zenith Credentials — $(date)
=====================================
Panel URL:       https://${PANEL_DOMAIN}
Admin Email:     ${ADMIN_EMAIL}
Admin Password:  ${ADMIN_PASSWORD}
DB Password:     ${DB_PASS}
Redis Password:  ${REDIS_PASS}
WHMCS API Key:   ${WHMCS_API_KEY}
=====================================
Keep this file secure!
CREDEOF
chmod 600 /root/zenith-credentials.txt

divider
echo ""
echo -e "${BOLD}${GREEN}  ✓ Zenith Installation Complete!${NC}"
echo ""
divider
echo -e "  ${BOLD}Panel URL:${NC}      https://${PANEL_DOMAIN}"
echo -e "  ${BOLD}Admin Email:${NC}    ${ADMIN_EMAIL}"
echo -e "  ${BOLD}Admin Password:${NC} ${ADMIN_PASSWORD}"
echo ""
echo -e "  ${BOLD}WHMCS API Key:${NC}  ${WHMCS_API_KEY}"
echo -e "  (Set as Server Password in WHMCS when adding Zenith server)"
echo ""
divider
echo ""
echo -e "  ${CYAN}Next steps:${NC}"
echo -e "  1. Login to the admin panel"
echo -e "  2. Add your Proxmox nodes: Admin → Nodes → Add Node"
echo -e "  3. Add templates: Admin → Templates"
echo -e "  4. Upload whmcs-module/ to your WHMCS installation"
echo ""
echo -e "  ${YELLOW}Credentials saved to: /root/zenith-credentials.txt${NC}"
divider
