import { Client } from 'ssh2';
import { logger } from '../utils/logger.js';

/**
 * Execute a command over SSH on a node.
 * node: { ip_address, ssh_port, ssh_user, ssh_private_key }
 */
export function execSSH(node, command) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = '';
    let stderr = '';

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) { conn.end(); return reject(err); }

        stream.on('close', (code) => {
          conn.end();
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), code });
        });

        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
      });
    });

    conn.on('error', (err) => reject(err));

    const connectConfig = {
      host: node.ip_address,
      port: node.ssh_port || 22,
      username: node.ssh_user || 'root',
      readyTimeout: 15000,
    };

    if (node.ssh_private_key) {
      connectConfig.privateKey = node.ssh_private_key;
    }

    conn.connect(connectConfig);
  });
}

export async function testConnection(node) {
  const result = await execSSH(node, 'echo ok');
  return result.stdout === 'ok';
}

export async function getNodeResources(node) {
  const [cpuRes, memRes, diskRes] = await Promise.all([
    execSSH(node, "nproc"),
    execSSH(node, "free -m | awk 'NR==2{print $2, $3}'"),
    execSSH(node, "df -BG / | awk 'NR==2{print $2, $3}'"),
  ]);

  const [totalMem, usedMem] = memRes.stdout.split(' ').map(Number);
  const totalDisk = parseInt(diskRes.stdout.split(' ')[0]);
  const usedDisk = parseInt(diskRes.stdout.split(' ')[1]);

  return {
    cpu: parseInt(cpuRes.stdout) || 0,
    totalMem: totalMem || 0,
    usedMem: usedMem || 0,
    totalDisk: totalDisk || 0,
    usedDisk: usedDisk || 0,
  };
}

function buildVMXML(vps, imagePath, vncPort, vncPassword) {
  return `<domain type='kvm'>
  <name>${vps.uuid}</name>
  <uuid>${vps.uuid}</uuid>
  <memory unit='MiB'>${vps.ram}</memory>
  <currentMemory unit='MiB'>${vps.ram}</currentMemory>
  <vcpu placement='static'>${vps.cpu}</vcpu>
  <os>
    <type arch='x86_64' machine='pc-i440fx-2.9'>hvm</type>
    <boot dev='hd'/>
  </os>
  <features><acpi/><apic/></features>
  <cpu mode='host-model' check='partial'/>
  <clock offset='utc'>
    <timer name='rtc' tickpolicy='catchup'/>
    <timer name='pit' tickpolicy='delay'/>
    <timer name='hpet' present='no'/>
  </clock>
  <devices>
    <emulator>/usr/bin/qemu-system-x86_64</emulator>
    <disk type='file' device='disk'>
      <driver name='qemu' type='qcow2' cache='none' io='native'/>
      <source file='${imagePath}'/>
      <target dev='vda' bus='virtio'/>
    </disk>
    <interface type='network'>
      <source network='default'/>
      <model type='virtio'/>
    </interface>
    <console type='pty'>
      <target type='serial' port='0'/>
    </console>
    <graphics type='vnc' port='${vncPort}' autoport='no' listen='127.0.0.1' passwd='${vncPassword}'>
      <listen type='address' address='127.0.0.1'/>
    </graphics>
    <video>
      <model type='cirrus' vram='16384' heads='1'/>
    </video>
    <memballoon model='virtio'/>
  </devices>
</domain>`;
}

export async function createVM(node, vps, templatePath) {
  const vmDir = `/var/lib/libvirt/images/${vps.uuid}`;
  const imagePath = `${vmDir}/disk.qcow2`;

  // Create VM directory and clone template
  await execSSH(node, `mkdir -p ${vmDir}`);
  await execSSH(node, `qemu-img create -f qcow2 -F qcow2 -b ${templatePath} ${imagePath} ${vps.disk}G`);

  // Cloud-init user data to set root password
  const userData = `#cloud-config
password: ${vps.root_password}
chpasswd: { expire: False }
ssh_pwauth: True
hostname: ${vps.hostname}
`;
  const metaData = `instance-id: ${vps.uuid}\nlocal-hostname: ${vps.hostname}\n`;

  await execSSH(node, `mkdir -p ${vmDir}/cloud-init`);
  await execSSH(node, `echo '${userData.replace(/'/g, "'\\''")}' > ${vmDir}/cloud-init/user-data`);
  await execSSH(node, `echo '${metaData}' > ${vmDir}/cloud-init/meta-data`);
  await execSSH(node, `genisoimage -output ${vmDir}/cloud-init.iso -volid cidata -joliet -rock ${vmDir}/cloud-init/user-data ${vmDir}/cloud-init/meta-data 2>/dev/null || cloud-localds ${vmDir}/cloud-init.iso ${vmDir}/cloud-init/user-data ${vmDir}/cloud-init/meta-data`);

  const xml = buildVMXML(vps, imagePath, vps.vnc_port, vps.vnc_password);
  await execSSH(node, `cat > /tmp/${vps.uuid}.xml << 'XMLEOF'\n${xml}\nXMLEOF`);
  await execSSH(node, `virsh define /tmp/${vps.uuid}.xml`);
  await execSSH(node, `virsh start ${vps.uuid}`);
  await execSSH(node, `rm -f /tmp/${vps.uuid}.xml`);

  logger.info({ uuid: vps.uuid, node: node.ip_address }, 'VM created');
}

export async function deleteVM(node, uuid) {
  await execSSH(node, `virsh destroy ${uuid} 2>/dev/null || true`);
  await execSSH(node, `virsh undefine ${uuid} --remove-all-storage 2>/dev/null || true`);
  await execSSH(node, `rm -rf /var/lib/libvirt/images/${uuid}`);
  logger.info({ uuid, node: node.ip_address }, 'VM deleted');
}

export async function startVM(node, uuid) {
  const result = await execSSH(node, `virsh start ${uuid}`);
  if (result.code !== 0) throw new Error(result.stderr || 'Failed to start VM');
}

export async function stopVM(node, uuid) {
  await execSSH(node, `virsh shutdown ${uuid}`);
}

export async function forceStopVM(node, uuid) {
  await execSSH(node, `virsh destroy ${uuid}`);
}

export async function restartVM(node, uuid) {
  await execSSH(node, `virsh reboot ${uuid}`);
}

export async function suspendVM(node, uuid) {
  await execSSH(node, `virsh suspend ${uuid}`);
}

export async function resumeVM(node, uuid) {
  await execSSH(node, `virsh resume ${uuid}`);
}

export async function getVMStatus(node, uuid) {
  const result = await execSSH(node, `virsh domstate ${uuid} 2>/dev/null`);
  const state = result.stdout.toLowerCase();
  if (state.includes('running')) return 'running';
  if (state.includes('shut off') || state.includes('shutoff')) return 'stopped';
  if (state.includes('paused')) return 'suspended';
  return 'error';
}

export async function getVMStats(node, uuid) {
  const result = await execSSH(node, `virsh domstats ${uuid} --cpu-total --balloon 2>/dev/null`);
  const stats = {};
  for (const line of result.stdout.split('\n')) {
    const [k, v] = line.trim().split('=');
    if (k && v) stats[k.trim()] = v.trim();
  }
  return {
    cpu_time: parseInt(stats['cpu.time'] || '0'),
    mem_current: parseInt(stats['balloon.current'] || '0'),
    mem_maximum: parseInt(stats['balloon.maximum'] || '0'),
  };
}

// LXC management
export async function createLXC(node, vps, templateName) {
  await execSSH(node, `lxc-create -n ${vps.uuid} -t download -- -d ${templateName} -r focal -a amd64`);
  const config = `lxc.cgroup.memory.limit_in_bytes = ${vps.ram}M\nlxc.cgroup.cpu.shares = ${vps.cpu * 1024}\n`;
  await execSSH(node, `echo '${config}' >> /var/lib/lxc/${vps.uuid}/config`);
  await execSSH(node, `lxc-start -n ${vps.uuid}`);
}

export async function deleteLXC(node, uuid) {
  await execSSH(node, `lxc-stop -n ${uuid} -k 2>/dev/null || true`);
  await execSSH(node, `lxc-destroy -n ${uuid}`);
}

export async function startLXC(node, uuid) {
  await execSSH(node, `lxc-start -n ${uuid}`);
}

export async function stopLXC(node, uuid) {
  await execSSH(node, `lxc-stop -n ${uuid}`);
}
