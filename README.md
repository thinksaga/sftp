# Node.js Secure SFTP Server

A secure, standalone SFTP server implementation using Node.js and `ssh2`. designed to run on Windows (or any Node.js supported OS) and allow file transfers via local or public network.

## Features
- **Secure Transport:** Uses SSH2 protocol.
- **Directory Restriction:** Users are confined to the `remote_folder` directory for security.
- **Interactive Launcher:** Easy-to-use startup script (`start.js`) for configuration.
- **Cross-Platform:** Runs on Windows, Linux, and macOS.

## Prerequisites
- Node.js (v14 or higher recommended)
- TCP Port 2222 available

## Installation
1. Clone the repository.
   ```bash
   git clone https://github.com/thinksaga/sftp.git
   cd sftp
   ```
2. Install dependencies (handled automatically by launcher, or manually):
   ```bash
   npm install
   ```

## Usage

### Method 1: Interactive Launcher (Recommended)
Run the starter script to generate keys (if missing) and set temporary credentials:
```bash
node start.js
```
Follow the prompts to enter a username and password.

### Method 2: Manual Start
1. Generate a host key (if first time):
   ```bash
   node generate_key.js
   ```
2. Start the server (uses Environment Variables for credentials):
   ```bash
   # Linux/Mac
   export SFTP_USER=myuser
   export SFTP_PASS=mypass
   node server.js
   
   # Windows (PowerShell)
   $env:SFTP_USER="myuser"; $env:SFTP_PASS="mypass"; node server.js
   ```
   *Defaults if unset: `user` / `password`*

## Connecting to the Server
**Host:** Your IP Address (e.g., `192.168.1.x` or `localhost`)
**Port:** `2222`

### Command Line
```bash
sftp -P 2222 USERNAME@HOST_IP
```

## Public Access (Port Forwarding)
To access from the internet:
1. Log into your router.
2. Forward external port `2222` to your machine's local IP on port `2222`.
3. Connect using your **Public IP**.

## Project Structure
- `start.js`: Interactive launcher script.
- `server.js`: Main server logic and SFTP request handling.
- `generate_key.js`: Utility to generate RSA host keys.
- `remote_folder/`: The root directory for SFTP users.

## License
MIT

## Author

**Rajat Gupta**
Founder, [Thinksaga LLP](https://thinksaga.in)
Email: [ceo@thinksaga.in](mailto:ceo@thinksaga.in)
