const { spawn, execSync } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const path = require('path');
const os = require('os');

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
    const username = (await askQuestion('  Username (default: user): ')) || 'user';
    const password = (await askQuestion('  Password (default: password): ')) || 'password';
    const port = (await askQuestion('  Port (default: 2222): ')) || '2222';

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
    console.log('\nPress "q" and Enter to stop the server.');
    console.log('----------------------------\n');

    rl.on('line', (input) => {
        if (input.trim().toLowerCase() === 'q') {
            console.log('Stopping server...');
            serverProcess.kill();
            process.exit(0);
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
