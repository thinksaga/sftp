const { spawn, execSync } = require('child_process');
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
    console.log('--- SFTP Server Launcher ---');

    // 1. Check and install dependencies
    if (!fs.existsSync(path.join(__dirname, 'node_modules'))) {
        console.log('Installing dependencies...');
        try {
            execSync('npm install', { stdio: 'inherit' });
        } catch (e) {
            console.error('Failed to install dependencies.');
            process.exit(1);
        }
    }

    // 2. Check and generate host key
    if (!fs.existsSync(path.join(__dirname, 'host_rsa_key'))) {
        console.log('Generating host key...');
        try {
            // We can run the existing script or just do it here if we import it.
            // Let's run the script to keep it modular.
            execSync('node generate_key.js', { stdio: 'inherit' });
        } catch (e) {
            console.error('Failed to generate host key.');
            process.exit(1);
        }
    }

    // 3. Ask for credentials
    const username = await askQuestion('Enter SFTP Username: ');
    const password = await askQuestion('Enter SFTP Password: ');

    console.log('\nStarting server...');

    const serverProcess = spawn('node', ['server.js'], {
        stdio: 'inherit',
        env: { ...process.env, SFTP_USER: username, SFTP_PASS: password }
    });

    console.log('\nServer is running.');
    console.log('Press "q" and Enter to stop the server and exit.');

    rl.on('line', (input) => {
        if (input.trim().toLowerCase() === 'q') {
            console.log('Stopping server...');
            serverProcess.kill();
            process.exit(0);
        }
    });

    serverProcess.on('close', (code) => {
        console.log(`Server process exited with code ${code}`);
        process.exit(code);
    });
}

main();
