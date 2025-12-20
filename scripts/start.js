const { spawn, execSync, exec } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');
const http = require('http');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
                return alias.address;
            }
        }
    }
    return '0.0.0.0';
}

function getPublicIP() {
    return new Promise((resolve) => {
        http.get({ host: 'api64.ipify.org', port: 80, path: '/' }, (resp) => {
            let data = '';
            resp.on('data', (chunk) => data += chunk);
            resp.on('end', () => resolve(data));
        }).on('error', () => resolve(null));
    });
}

function checkFirewall(port) {
    if (process.platform !== 'win32') return true;
    try {
        const cmd = `netsh advfirewall firewall show rule name=all | findstr "${port}"`;
        const output = execSync(cmd, { stdio: 'pipe' }).toString();
        return output.includes(port.toString());
    } catch (e) {
        return false;
    }
}

function checkPortUsage(port) {
    try {
        const cmd = `netstat -ano | findstr ":${port}" | findstr "LISTENING"`;
        const output = execSync(cmd, { stdio: 'pipe' }).toString();
        if (output.trim()) {
            const pid = output.trim().split(/\s+/).pop();
            return pid;
        }
        return false;
    } catch (e) {
        return false;
    }
}

async function main() {
    console.clear();
    console.log('====================================');
    console.log('     SFTP Server Launcher (Windows) ');
    console.log('====================================\n');

    // 1. Check and install dependencies
    if (!fs.existsSync(path.join(__dirname, '../node_modules'))) {
        console.log('Installing dependencies...');
        try {
            execSync('npm install', { stdio: 'inherit' });
        } catch (e) {
            console.error('Failed to install dependencies.');
            process.exit(1);
        }
    }

    // 2. Check and generate host key
    if (!fs.existsSync(path.join(__dirname, '../keys/host_rsa_key'))) {
        console.log('Generating host key...');
        try {
            execSync('node ' + path.join(__dirname, 'generate_key.js'), { stdio: 'inherit' });
        } catch (e) {
            console.error('Failed to generate host key.');
            process.exit(1);
        }
    }

    // 3. Ask for credentials
    console.log('Configure SFTP Access:');
    const username = (await askQuestion('  Username (default: admin): ')) || 'admin';
    const password = (await askQuestion('  Password (default: admin): ')) || 'admin';
    const port = (await askQuestion('  Port (default: 22): ')) || '22';

    const firewallOpen = checkFirewall(port);
    const portUsagePid = checkPortUsage(port);
    const publicIP = await getPublicIP();

    console.log('\n--- Status Check ---');
    if (portUsagePid) {
        console.log(`⚠️  PORT CONFLICT: Port ${port} is already in use by PID: ${portUsagePid}.`);
        console.log(`   Tip: Stop the existing service or choose a different port.`);
    }

    if (firewallOpen) {
        console.log(`✅ Windows Firewall: Port ${port} is OPEN.`);
    } else {
        console.log(`❌ Windows Firewall: Port ${port} is BLOCKED.`);
        console.log(`   Tip: Run the firewall command from README.md as Administrator.`);
    }

    if (publicIP) {
        console.log(`ℹ️  Public IP detected: ${publicIP}`);
        console.log(`   Router Tip: Ensure Port ${port} is forwarded to ${getLocalIP()} in your router settings.`);
    }

    console.log('\n--- Starting SFTP Server ---');

    const serverProcess = spawn('node', ['src/index.js'], {
        stdio: 'inherit',
        env: { ...process.env, SFTP_USER: username, SFTP_PASS: password, SFTP_PORT: port }
    });

    const localIP = getLocalIP();
    console.log('\nSUCCESS: Server is running!');
    console.log(`Local Address: sftp://${localIP}:${port}`);
    console.log(`Username     : ${username}`);
    console.log(`Password     : ${password}`);
    console.log('\nCommands:');
    console.log('  "q" + Enter to stop the server.');
    console.log('  "c" + Enter to check public connectivity.');
    console.log('----------------------------\n');

    rl.on('line', async (input) => {
        const cmd = input.trim().toLowerCase();
        if (cmd === 'q') {
            console.log('Stopping server...');
            serverProcess.kill();
            process.exit(0);
        } else if (cmd === 'c') {
            if (!publicIP) {
                console.log('❌ Could not determine public IP.');
                return;
            }
            console.log(`🔍 Checking if port ${port} is reachable on ${publicIP}...`);
            // Using a simple timeout-based check isn't possible from inside the network 
            // due to NAT loopback. We suggest a manual check or use a helper.
            console.log(`Navigate to: https://portchecker.co/check?ip=${publicIP}&port=${port}`);
            console.log(`Or: https://canyouseeme.org/ (Enter port ${port})`);
        }
    });

    serverProcess.on('close', (code) => {
        if (code !== 0 && code !== null) {
            console.log(`Server process exited with code ${code}`);
        }
        process.exit(code || 0);
    });
}

main();
