import crypto from 'crypto';
import { Worker } from 'bullmq';
import { query, queryOne } from '../../config/database.js';
import * as proxmox from '../proxmox.js';
import { sendVpsCreatedEmail, sendVpsSuspendedEmail } from '../email.js';

const connection = {
  host:     process.env.REDIS_HOST || 'localhost',
  port:     parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASS || undefined,
};

async function getNode(nodeId) {
  return queryOne('SELECT * FROM nodes WHERE id = ?', [nodeId]);
}

async function setTaskStatus(taskId, status, output = null) {
  await query('UPDATE tasks SET status = ?, output = ?, completed_at = ? WHERE id = ?',
    [status, output, status !== 'running' ? new Date() : null, taskId]);
}

async function setVpsStatus(vpsId, status) {
  await query('UPDATE vps SET status = ? WHERE id = ?', [status, vpsId]);
}

async function processJob(job) {
  const { taskId, vpsId } = job.data;

  await setTaskStatus(taskId, 'running');

  const vps  = await queryOne('SELECT v.*, p.cpu, p.ram, p.disk, p.bandwidth, n.*, v.type as type FROM vps v JOIN plans p ON v.plan_id = p.id JOIN nodes n ON v.node_id = n.id WHERE v.id = ?', [vpsId]);
  if (!vps) throw new Error(`VPS ${vpsId} not found`);

  const node = await getNode(vps.node_id);
  const type = vps.type || 'kvm';

  switch (job.name) {

    case 'create_vps': {
      await setVpsStatus(vpsId, 'creating');

      const vmid = await proxmox.getNextVmid(node);
      await query('UPDATE vps SET proxmox_vmid = ? WHERE id = ?', [vmid, vpsId]);

      // Guarantee a usable root password (covers both KVM and LXC below). If the create
      // request didn't supply one (e.g. an older create path or version skew), generate a
      // strong fallback — otherwise proxmox flattenBody() drops the undefined password field
      // (cipassword for KVM cloud-init, the root password for LXC), leaving root locked and
      // the VPS unreachable by SSH *and* console.
      const rootPassword = (job.data.root_password && String(job.data.root_password).length >= 8)
        ? job.data.root_password
        : crypto.randomBytes(12).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 16);
      if (rootPassword !== job.data.root_password) {
        console.warn(`create_vps: no root_password supplied for VPS ${vpsId}; generated a fallback (sent via welcome email)`);
      }

      // VM name: use the provided hostname, else fall back to the assigned IP (mirrors the
      // LXC path, which names the container after its IP). Avoids the VM inheriting some
      // unrelated value (e.g. the node's own IP) as its name.
      const vmName = (vps.hostname && String(vps.hostname).trim()) || job.data.ip || `vps-${vpsId}`;

      if (type === 'kvm') {
        const tpl = await queryOne('SELECT * FROM templates WHERE id = ?', [vps.template_id]);
        await proxmox.createKvmVm(node, {
          vmid,
          templateVmid: parseInt(tpl.proxmox_template_id),
          hostname:     vmName,
          cpus:         vps.cpu,
          ram:          vps.ram,
          diskSize:     vps.disk,
          ipConfig:     job.data.ipConfig || 'ip=dhcp',
          password:     rootPassword,
          macAddress:   job.data.mac || null,
        });
      } else {
        const tpl = await queryOne('SELECT * FROM templates WHERE id = ?', [vps.template_id]);
        const additionalIpConfigs = (job.data.additional_ip_configs || []).map(ip => ({ ipConfig: `ip=${ip.ipAddress}/${ip.cidr}`, mac: ip.mac || null }));
        await proxmox.createLxcContainer(node, {
          vmid,
          templatePath:       tpl.path,
          hostname:           vps.hostname,
          cpus:               vps.cpu,
          ram:                vps.ram,
          diskSize:           vps.disk,
          password:           rootPassword,
          storage:            node.storage,
          ipConfig:           job.data.ipConfig,
          macAddress:         job.data.mac || null,
          additionalIpConfigs,
        });
      }

      // Set hostname to assigned IP and start container
      if (type !== 'kvm') {
        if (job.data.ip) {
          await proxmox.updateLxcConfig(node, vmid, { hostname: job.data.ip });
        }
        await proxmox.startLxcContainer(node, vmid);
        await new Promise(r => setTimeout(r, 2000));
        await proxmox.enableContainerFirewall(node, vmid);
      }

      await setVpsStatus(vpsId, 'running');

      // Assign primary IP
      if (job.data.ip_address_id) {
        await query('UPDATE ip_addresses SET vps_id = ?, assigned_at = NOW() WHERE id = ?',
          [vpsId, job.data.ip_address_id]);
      }
      // Assign additional IPs
      if (Array.isArray(job.data.additional_ip_configs)) {
        for (const ipConf of job.data.additional_ip_configs) {
          await query('UPDATE ip_addresses SET vps_id = ?, assigned_at = NOW() WHERE id = ?', [vpsId, ipConf.id]);
        }
      }

      // For Windows KVM VMs, wait for cloudbase-init to finish then clear PasswordExpired flag
      if (type === 'kvm') {
        const tpl = await queryOne('SELECT * FROM templates WHERE id = ?', [vps.template_id]);
        if (tpl?.os_family === 'windows') {
          // Wait for cloudbase-init to finish, clear the PasswordExpired flag, then
          // force-set the Administrator password via the guest agent — belt and braces
          // so the client's password works regardless of cloudbase-init quirks.
          proxmox.waitForGuestAgent(node, vmid)
            .then(() => proxmox.runGuestExec(node, vmid, ['powershell', '-c',
              '$s=Get-Service "cloudbase-init" -ErrorAction SilentlyContinue; if($s){while($s.Status -ne "Stopped"){Start-Sleep 5;$s.Refresh()}}; $u=[ADSI]"WinNT://./Administrator,user"; $u.PasswordExpired=0; $u.SetInfo()'
            ]))
            .then(() => proxmox.setGuestUserPassword(node, vmid, 'Administrator', rootPassword))
            .catch(() => {});
        }
      }

      // Send welcome email
      const user = await queryOne('SELECT * FROM users WHERE id = ?', [vps.user_id]);
      if (user) {
        await sendVpsCreatedEmail(user.email, {
          hostname: vps.hostname,
          ip: job.data.ip || 'See panel for IP',
          password: rootPassword,
        }).catch(() => {});
      }
      break;
    }

    case 'delete_vps': {
      await setVpsStatus(vpsId, 'deleting');
      const vmid = vps.proxmox_vmid;
      if (vmid) {
        try {
          if (type === 'kvm') await proxmox.deleteKvmVm(node, vmid);
          else                await proxmox.deleteLxcContainer(node, vmid);
        } catch (err) {
          // If container doesn't exist on Proxmox, proceed with DB cleanup anyway
          console.warn(`Proxmox delete warning for VMID ${vmid}:`, err.message);
        }
      }
      await query('UPDATE ip_addresses SET vps_id = NULL, assigned_at = NULL WHERE vps_id = ?', [vpsId]);
      await query('DELETE FROM tasks WHERE vps_id = ?', [vpsId]);
      await query('DELETE FROM vps WHERE id = ?', [vpsId]);
      break;
    }

    case 'start_vps': {
      const vmid = vps.proxmox_vmid;
      if (type === 'kvm') await proxmox.startKvmVm(node, vmid);
      else                await proxmox.startLxcContainer(node, vmid);
      await setVpsStatus(vpsId, 'running');
      break;
    }

    case 'stop_vps': {
      const vmid = vps.proxmox_vmid;
      if (type === 'kvm') await proxmox.stopKvmVm(node, vmid);
      else                await proxmox.stopLxcContainer(node, vmid);
      await setVpsStatus(vpsId, 'stopped');
      break;
    }

    case 'force_stop_vps': {
      const vmid = vps.proxmox_vmid;
      if (type === 'kvm') await proxmox.forceStopKvmVm(node, vmid);
      else                await proxmox.forceStopLxcContainer(node, vmid);
      await setVpsStatus(vpsId, 'stopped');
      break;
    }

    case 'restart_vps': {
      const vmid = vps.proxmox_vmid;
      if (type === 'kvm') await proxmox.restartKvmVm(node, vmid);
      else                await proxmox.restartLxcContainer(node, vmid);
      await setVpsStatus(vpsId, 'running');
      break;
    }

    case 'suspend_vps': {
      const vmid = vps.proxmox_vmid;
      if (type === 'kvm') await proxmox.suspendKvmVm(node, vmid);
      else                await proxmox.stopLxcContainer(node, vmid);
      await setVpsStatus(vpsId, 'suspended');
      const user = await queryOne('SELECT * FROM users WHERE id = ?', [vps.user_id]);
      if (user) await sendVpsSuspendedEmail(user.email, { hostname: vps.hostname }).catch(() => {});
      break;
    }

    case 'unsuspend_vps': {
      const vmid = vps.proxmox_vmid;
      if (type === 'kvm') await proxmox.unsuspendKvmVm(node, vmid);
      else                await proxmox.startLxcContainer(node, vmid);
      await setVpsStatus(vpsId, 'running');
      break;
    }

    case 'reinstall_vps': {
      await setVpsStatus(vpsId, 'reinstalling');
      const tplId = job.data.template_id || vps.template_id;
      const tpl   = await queryOne('SELECT * FROM templates WHERE id = ?', [tplId]);
      if (!tpl) throw new Error('Template not found');
      const vmid = vps.proxmox_vmid;
      const ref  = type === 'kvm' ? parseInt(tpl.proxmox_template_id) : tpl.path;

      // Rebuild ipConfig from assigned IPs
      const netmaskToCidr = (nm) => nm ? nm.split('.').reduce((acc, o) => acc + (parseInt(o) >>> 0).toString(2).split('').filter(b => b === '1').length, 0) : 24;
      const ips = await query('SELECT a.*, p.netmask, p.gateway FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id WHERE a.vps_id = ? ORDER BY a.assigned_at', [vpsId]);
      const primaryIp = ips[0] || null;
      const cidr = netmaskToCidr(primaryIp?.netmask);
      const gw = primaryIp?.gateway || '';
      const ipConfig = primaryIp ? `ip=${primaryIp.ip_address}/${cidr}${gw ? ',gw=' + gw : ''}` : 'ip=dhcp';
      const additionalIpConfigs = ips.slice(1).map(ip => ({ ipConfig: `ip=${ip.ip_address}/${netmaskToCidr(ip.netmask)}`, mac: ip.mac_address || null }));

      await proxmox.reinstallVm(node, vmid, type, ref, vps.hostname, job.data.root_password, vps.cpu, vps.ram, vps.disk, ipConfig, additionalIpConfigs, primaryIp?.mac_address || null);

      if (job.data.template_id && job.data.template_id != vps.template_id) {
        await query('UPDATE vps SET template_id = ? WHERE id = ?', [job.data.template_id, vpsId]);
      }
      await setVpsStatus(vpsId, 'running');
      break;
    }

    case 'enable_rescue': {
      // KVM rescue: reboot the VM itself from a SystemRescue ISO (console access,
      // original disk stays attached as /dev/sda). No rescue container/password.
      if (type === 'kvm') {
        const iso = job.data.rescue_iso || 'local:iso/systemrescue.iso';
        await proxmox.enableKvmRescue(node, vps.proxmox_vmid, iso);
        await query('UPDATE vps SET rescue_mode=1, rescue_vmid=NULL, rescue_password=NULL WHERE id=?', [vpsId]);
        await setVpsStatus(vpsId, 'running');
        break;
      }

      await setVpsStatus(vpsId, 'stopped');

      // Get current container config to find original disk path
      const config = await proxmox.getContainerConfig(node, vps.proxmox_vmid);
      const rootfsParts = (config.rootfs || '').split(',');
      const originalDiskPath = rootfsParts[0] || null;

      // Stop original container
      try { await proxmox.stopLxcContainer(node, vps.proxmox_vmid); } catch {}
      await new Promise(r => setTimeout(r, 3000));

      // Get IPs
      const ips = await query('SELECT a.*, p.netmask, p.gateway FROM ip_addresses a JOIN ip_pools p ON a.pool_id = p.id WHERE a.vps_id = ? ORDER BY a.assigned_at', [vpsId]);
      const netmaskToCidr = (nm) => nm ? nm.split('.').reduce((acc, o) => acc + (parseInt(o) >>> 0).toString(2).split('').filter(b => b === '1').length, 0) : 24;
      const primaryIp = ips[0] || null;
      const cidr = netmaskToCidr(primaryIp?.netmask);
      const gw = primaryIp?.gateway || '';
      const ipConfig = primaryIp ? `ip=${primaryIp.ip_address}/${cidr}${gw ? ',gw=' + gw : ''}` : 'ip=dhcp';
      const additionalIpConfigs = ips.slice(1).map(ip => ({ ipConfig: `ip=${ip.ip_address}/${netmaskToCidr(ip.netmask)}`, mac: ip.mac_address || null }));

      // Create rescue container
      const rescueVmid = await proxmox.getNextVmid(node);
      const rescuePassword = job.data.rescue_password;
      const rescueTemplate = job.data.rescue_template || 'local:vztmpl/rescue-ubuntu.tar.zst';

      await proxmox.createRescueContainer(node, {
        rescueVmid, rescueTemplate,
        hostname: vps.hostname,
        ipConfig, macAddress: primaryIp?.mac_address || null, additionalIpConfigs,
        password: rescuePassword,
        originalDiskPath,
        storage: node.storage,
      });

      // Update hostname to IP like normal VPS
      if (primaryIp?.ip_address) {
        await proxmox.updateLxcConfig(node, rescueVmid, { hostname: primaryIp.ip_address });
      }

      await proxmox.startLxcContainer(node, rescueVmid);
      await new Promise(r => setTimeout(r, 3000));
      await proxmox.enableContainerFirewall(node, rescueVmid);

      await query('UPDATE vps SET rescue_mode=1, rescue_vmid=?, rescue_password=? WHERE id=?',
        [rescueVmid, rescuePassword, vpsId]);
      break;
    }

    case 'disable_rescue': {
      // KVM rescue: detach the rescue ISO and boot back from the original disk
      if (type === 'kvm') {
        await proxmox.disableKvmRescue(node, vps.proxmox_vmid);
        await query('UPDATE vps SET rescue_mode=0, rescue_vmid=NULL, rescue_password=NULL WHERE id=?', [vpsId]);
        await setVpsStatus(vpsId, 'running');
        break;
      }

      const rescueVmid = vps.rescue_vmid;

      // Stop and delete rescue container
      if (rescueVmid) {
        try { await proxmox.stopLxcContainer(node, rescueVmid); } catch {}
        await new Promise(r => setTimeout(r, 2000));
        try { await proxmox.deleteLxcContainer(node, rescueVmid); } catch {}
      }

      // Start original container
      await proxmox.startLxcContainer(node, vps.proxmox_vmid);

      await query('UPDATE vps SET rescue_mode=0, rescue_vmid=NULL, rescue_password=NULL WHERE id=?', [vpsId]);
      await setVpsStatus(vpsId, 'running');
      break;
    }

    default:
      throw new Error(`Unknown job type: ${job.name}`);
  }

  await setTaskStatus(taskId, 'completed').catch(() => {});
}

export function startWorkers() {
  const worker = new Worker('vps', processJob, { connection, concurrency: 5 });

  worker.on('failed', async (job, err) => {
    console.error(`VPS job ${job?.name} failed:`, err.message);
    if (job?.data?.taskId) {
      await query('UPDATE tasks SET status = ?, output = ?, completed_at = NOW() WHERE id = ?',
        ['failed', err.message, job.data.taskId]).catch(() => {});
    }
    if (job?.data?.vpsId) {
      const vpsRow = await query('SELECT rescue_mode FROM vps WHERE id = ?', [job.data.vpsId]).catch(() => []);
      if (!vpsRow[0]?.rescue_mode) {
        await query('UPDATE vps SET status = ? WHERE id = ?', ['error', job.data.vpsId]).catch(() => {});
      }
    }
  });

  console.log('VPS worker started');
  return worker;
}
