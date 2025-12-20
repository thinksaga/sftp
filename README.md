# Node.js Secure SFTP Server

A secure, standalone SFTP server implementation using Node.js and `ssh2`. Designed to run on Windows Server (or any Node.js supported OS) to allow safe file transfers.

## Features
- **Secure Transport:** Uses SSH2 protocol for encrypted transfers.
- **Directory Restriction (Chroot):** Users are strictly confined to the `sftp_root` directory.
- **Improved Windows Support:** Handles Windows path resolving and provides proper directory listings (`ls -l`).
- **Interactive Launcher:** Simple CLI tool to configure and start the server.

## Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/thinksaga/sftp.git
   cd sftp
   ```
2. Install dependencies (handled automatically by launcher):
   ```bash
   npm install
   ```

## Usage

### Method 1: Interactive Launcher (Recommended)
This script helps you set credentials, port, and generates keys if missing.
```bash
npm start
```

### Method 2: Manual Start
1. Generate a host key:
   ```bash
   node scripts/generate_key.js
   ```
2. Start the server (using Environment Variables):
   ```powershell
   # Windows (PowerShell)
   $env:SFTP_USER="myuser"; $env:SFTP_PASS="mypass"; $env:SFTP_PORT="2222"; node src/index.js
   ```

## Windows Server Tips
- **Firewall:** Ensure the configured port (default 2222) is open in the Windows Defender Firewall.
- **Permissions:** Make sure the user running the Node.js process has read/write permissions to the `sftp_root` folder.
- **Port Conflict:** Windows Server might have OpenSSH Server enabled on port 22. This script uses 2222 by default to avoid conflict.

## Project Structure
- `scripts/start.js`: Interactive launcher.
- `src/index.js`: Core SFTP server logic.
- `scripts/generate_key.js`: Host key generator.
- `sftp_root/`: Root directory for users (chroot).
- `keys/`: Storage for RSA host keys.

## License
MIT

## Author
**Rajat Gupta**  
Founder, [Thinksaga LLP](https://thinksaga.in)  
Email: [ceo@thinksaga.in](mailto:ceo@thinksaga.in)
