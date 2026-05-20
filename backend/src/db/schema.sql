SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email        VARCHAR(255) NOT NULL UNIQUE,
  password     VARCHAR(255) NOT NULL,
  first_name   VARCHAR(100),
  last_name    VARCHAR(100),
  role         ENUM('admin','client') NOT NULL DEFAULT 'client',
  is_active    TINYINT(1) NOT NULL DEFAULT 1,
  totp_secret  VARCHAR(255),
  totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  api_key      VARCHAR(64) UNIQUE,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS nodes (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(100) NOT NULL,
  hostname         VARCHAR(255) NOT NULL,
  port             SMALLINT UNSIGNED NOT NULL DEFAULT 8006,
  api_token_id     VARCHAR(255) NOT NULL COMMENT 'e.g. root@pam!zenith',
  api_token_secret VARCHAR(255) NOT NULL COMMENT 'Proxmox API token secret UUID',
  proxmox_node     VARCHAR(100) NOT NULL DEFAULT 'pve' COMMENT 'PVE node name',
  storage          VARCHAR(100) NOT NULL DEFAULT 'local-lvm' COMMENT 'Primary VM storage',
  backup_storage   VARCHAR(100) DEFAULT 'local' COMMENT 'Backup storage',
  type             ENUM('kvm','lxc','both') NOT NULL DEFAULT 'both',
  location         VARCHAR(255),
  total_cpu        INT UNSIGNED NOT NULL DEFAULT 0,
  total_ram        INT UNSIGNED NOT NULL DEFAULT 0  COMMENT 'MB',
  total_disk       INT UNSIGNED NOT NULL DEFAULT 0  COMMENT 'GB',
  is_active        TINYINT(1) NOT NULL DEFAULT 1,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plans (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  cpu         INT UNSIGNED NOT NULL,
  ram         INT UNSIGNED NOT NULL  COMMENT 'MB',
  disk        INT UNSIGNED NOT NULL  COMMENT 'GB',
  bandwidth   INT UNSIGNED NOT NULL  COMMENT 'GB/month, 0=unlimited',
  price       DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  type        ENUM('kvm','lxc') NOT NULL DEFAULT 'kvm',
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS templates (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name                VARCHAR(255) NOT NULL,
  type                ENUM('kvm','lxc') NOT NULL DEFAULT 'kvm',
  proxmox_template_id VARCHAR(100) COMMENT 'For KVM: Proxmox VMID of template (e.g. 9000). For LXC: storage volid (e.g. local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst)',
  path                VARCHAR(500) COMMENT 'Alias for proxmox_template_id, used internally',
  os_family           VARCHAR(50),
  description         TEXT,
  is_active           TINYINT(1) NOT NULL DEFAULT 1,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ip_pools (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  gateway           VARCHAR(45),
  netmask           VARCHAR(45),
  node_id           INT UNSIGNED,
  leaseweb_api_key  VARCHAR(255) DEFAULT NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ip_addresses (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ip_address  VARCHAR(45) NOT NULL UNIQUE,
  mac_address VARCHAR(17) DEFAULT NULL,
  pool_id     INT UNSIGNED,
  vps_id      INT UNSIGNED,
  is_ipv6     TINYINT(1) NOT NULL DEFAULT 0,
  assigned_at DATETIME,
  FOREIGN KEY (pool_id) REFERENCES ip_pools(id) ON DELETE SET NULL,
  FOREIGN KEY (vps_id)  REFERENCES vps(id)      ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS vps (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  uuid           VARCHAR(36) NOT NULL UNIQUE,
  proxmox_vmid   INT UNSIGNED COMMENT 'Proxmox VM/CT ID assigned at creation',
  hostname       VARCHAR(255) NOT NULL,
  user_id        INT UNSIGNED NOT NULL,
  node_id        INT UNSIGNED NOT NULL,
  plan_id        INT UNSIGNED NOT NULL,
  template_id    INT UNSIGNED NOT NULL,
  type           ENUM('kvm','lxc') NOT NULL DEFAULT 'kvm',
  status         ENUM('creating','running','stopped','suspended','reinstalling','deleting','error') NOT NULL DEFAULT 'creating',
  whmcs_service_id VARCHAR(50),
  notes          TEXT,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  INDEX idx_node (node_id),
  INDEX idx_status (status),
  FOREIGN KEY (user_id)     REFERENCES users(id)     ON DELETE CASCADE,
  FOREIGN KEY (node_id)     REFERENCES nodes(id)     ON DELETE RESTRICT,
  FOREIGN KEY (plan_id)     REFERENCES plans(id)     ON DELETE RESTRICT,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS backups (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vps_id     INT UNSIGNED NOT NULL,
  name       VARCHAR(255) NOT NULL,
  file_path  VARCHAR(500) COMMENT 'Proxmox volid e.g. local:backup/vzdump-qemu-100-2024_01_01.vma.zst',
  size       BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (vps_id) REFERENCES vps(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tasks (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vps_id       INT UNSIGNED,
  user_id      INT UNSIGNED,
  type         VARCHAR(100) NOT NULL,
  status       ENUM('pending','running','completed','failed','cancelled') NOT NULL DEFAULT 'pending',
  output       TEXT,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  INDEX idx_status (status),
  FOREIGN KEY (vps_id)  REFERENCES vps(id)   ON DELETE SET NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       INT UNSIGNED,
  action        VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id   INT UNSIGNED,
  details       JSON,
  ip_address    VARCHAR(45),
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action (action),
  INDEX idx_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  `key`      VARCHAR(100) NOT NULL UNIQUE,
  value      TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
