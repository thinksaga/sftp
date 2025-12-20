const fs = require('fs');
const { Server } = require('ssh2');
const path = require('path');

// Configurations
const PORT = process.env.SFTP_PORT || 22;
const HOST_KEY_PATH = path.resolve(__dirname, '../keys/host_rsa_key');
const REMOTE_FOLDER = path.resolve(__dirname, '../sftp_root');

// Ensure remote_folder exists
if (!fs.existsSync(REMOTE_FOLDER)) {
    console.log(`Creating SFTP root directory: ${REMOTE_FOLDER}`);
    fs.mkdirSync(REMOTE_FOLDER, { recursive: true });
}

if (!fs.existsSync(HOST_KEY_PATH)) {
    console.error('Host key not found! Run "node scripts/generate_key.js" first.');
    process.exit(1);
}

/**
 * Normalizes an SFTP path and resolves it to a local filesystem path.
 * Ensures the path stays within the REMOTE_FOLDER.
 */
function toLocalPath(sftpPath) {
    // SFTP paths are always / based. Normalize them.
    let normalized = sftpPath.replace(/\\/g, '/');
    while (normalized.startsWith('/')) {
        normalized = normalized.substring(1);
    }

    const resolved = path.resolve(REMOTE_FOLDER, normalized);

    // Security check: Ensure the resolved path is inside the REMOTE_FOLDER
    const relative = path.relative(REMOTE_FOLDER, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return null; // Potential directory traversal
    }
    return resolved;
}

/**
 * Converts fs.Stats to SFTP Attributes
 */
function statsToAttrs(stats) {
    return {
        mode: stats.mode,
        uid: stats.uid || 0,
        gid: stats.gid || 0,
        size: stats.size,
        atime: Math.floor(stats.atimeMs / 1000),
        mtime: Math.floor(stats.mtimeMs / 1000)
    };
}

/**
 * Formats a directory entry for SFTP 'name' response (ls -l style)
 */
function formatLongname(filename, stats) {
    const isDir = stats.isDirectory();
    const mode = stats.mode;

    // Simplified ls -l output
    const type = isDir ? 'd' : '-';
    const perms = [
        (mode & 0o400) ? 'r' : '-', (mode & 0o200) ? 'w' : '-', (mode & 0o100) ? 'x' : '-',
        (mode & 0o040) ? 'r' : '-', (mode & 0o020) ? 'w' : '-', (mode & 0o010) ? 'x' : '-',
        (mode & 0o004) ? 'r' : '-', (mode & 0o002) ? 'w' : '-', (mode & 0o001) ? 'x' : '-'
    ].join('');

    const size = stats.size.toString().padStart(10);
    const mtime = stats.mtime.toDateString().split(' ').slice(1, 4).join(' '); // e.g. "Dec 20 2025"

    return `${type}${perms} 1 user group ${size} ${mtime} ${filename}`;
}

const server = new Server({
    hostKeys: [fs.readFileSync(HOST_KEY_PATH)]
}, (client) => {
    console.log(`[${new Date().toISOString()}] Client connected!`);

    client.on('authentication', (ctx) => {
        const allowedUser = process.env.SFTP_USER || 'admin';
        const allowedPass = process.env.SFTP_PASS || 'admin';

        if (ctx.method === 'password' && ctx.username === allowedUser && ctx.password === allowedPass) {
            console.log(`[${new Date().toISOString()}] Authentication successful for user: ${ctx.username}`);
            ctx.accept();
        } else {
            console.log(`[${new Date().toISOString()}] Authentication failed for user: ${ctx.username}`);
            ctx.reject();
        }
    });

    client.on('ready', () => {
        console.log('Client authenticated and ready.');

        client.on('session', (accept, reject) => {
            const session = accept();

            session.on('sftp', (accept, reject) => {
                console.log('SFTP session started.');
                const sftp = accept();

                const openFiles = new Map();
                const openDirs = new Map();
                let handleCount = 0;

                function getHandle() {
                    const buf = Buffer.alloc(4);
                    buf.writeUInt32BE(handleCount++, 0);
                    return buf;
                }

                function sendStatus(reqId, err) {
                    let code = 0; // SSH_FX_OK
                    if (err) {
                        code = 4; // SSH_FX_FAILURE
                        if (err.code === 'ENOENT') code = 2; // SSH_FX_NO_SUCH_FILE
                        if (err.code === 'EACCES') code = 3; // SSH_FX_PERMISSION_DENIED
                        console.error(`SFTP Error: ${err.message}`);
                    }
                    sftp.status(reqId, code);
                }

                sftp.on('OPEN', (reqId, filename, flags, attrs) => {
                    const localPath = toLocalPath(filename);
                    if (!localPath) return sftp.status(reqId, 3);

                    fs.open(localPath, flags, (err, fd) => {
                        if (err) return sendStatus(reqId, err);
                        const handle = getHandle();
                        openFiles.set(handle.readUInt32BE(0), fd);
                        sftp.handle(reqId, handle);
                    });
                });

                sftp.on('READ', (reqId, handle, offset, length) => {
                    const fd = openFiles.get(handle.readUInt32BE(0));
                    if (fd === undefined) return sftp.status(reqId, 4);

                    const buffer = Buffer.alloc(length);
                    fs.read(fd, buffer, 0, length, offset, (err, bytesRead) => {
                        if (err) return sendStatus(reqId, err);
                        if (bytesRead === 0) return sftp.status(reqId, 1); // SSH_FX_EOF
                        sftp.data(reqId, buffer.slice(0, bytesRead));
                    });
                });

                sftp.on('WRITE', (reqId, handle, offset, data) => {
                    const fd = openFiles.get(handle.readUInt32BE(0));
                    if (fd === undefined) return sftp.status(reqId, 4);

                    fs.write(fd, data, 0, data.length, offset, (err) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.status(reqId, 0);
                    });
                });

                sftp.on('CLOSE', (reqId, handle) => {
                    const id = handle.readUInt32BE(0);
                    if (openFiles.has(id)) {
                        fs.close(openFiles.get(id), (err) => {
                            openFiles.delete(id);
                            if (err) return sendStatus(reqId, err);
                            sftp.status(reqId, 0);
                        });
                    } else if (openDirs.has(id)) {
                        openDirs.delete(id);
                        sftp.status(reqId, 0);
                    } else {
                        sftp.status(reqId, 4);
                    }
                });

                sftp.on('REALPATH', (reqId, sftpPath) => {
                    let name = sftpPath;
                    if (sftpPath === '.' || sftpPath === '') name = '/';

                    // Always normalize to forward slashes for the client
                    name = name.replace(/\\/g, '/');
                    if (!name.startsWith('/')) name = '/' + name;

                    sftp.name(reqId, [{ filename: name, longname: name }]);
                });

                sftp.on('OPENDIR', (reqId, sftpPath) => {
                    const localPath = toLocalPath(sftpPath);
                    if (!localPath) return sftp.status(reqId, 3);

                    fs.readdir(localPath, (err, files) => {
                        if (err) return sendStatus(reqId, err);
                        const handle = getHandle();
                        // Store both the files and the base path for stat processing
                        openDirs.set(handle.readUInt32BE(0), {
                            files,
                            localPath
                        });
                        sftp.handle(reqId, handle);
                    });
                });

                sftp.on('READDIR', (reqId, handle) => {
                    const id = handle.readUInt32BE(0);
                    const dirData = openDirs.get(id);
                    if (!dirData) return sftp.status(reqId, 4);

                    const { files, localPath } = dirData;

                    if (files.length === 0) {
                        return sftp.status(reqId, 1); // EOF
                    }

                    // Process directory entries
                    const list = [];
                    // We can send a batch of files. Let's send up to 100 at a time.
                    const batchSize = Math.min(files.length, 100);
                    const batch = files.splice(0, batchSize);

                    for (const f of batch) {
                        try {
                            const fullPath = path.join(localPath, f);
                            const stats = fs.statSync(fullPath);
                            list.push({
                                filename: f,
                                longname: formatLongname(f, stats),
                                attrs: statsToAttrs(stats)
                            });
                        } catch (e) {
                            console.warn(`Could not stat file: ${f}`, e.message);
                            // Fallback for files we can't stat
                            list.push({
                                filename: f,
                                longname: f,
                                attrs: { mode: 0, uid: 0, gid: 0, size: 0, atime: 0, mtime: 0 }
                            });
                        }
                    }

                    sftp.name(reqId, list);
                });

                sftp.on('STAT', (reqId, sftpPath) => {
                    const localPath = toLocalPath(sftpPath);
                    if (!localPath) return sftp.status(reqId, 3);

                    fs.stat(localPath, (err, stats) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.attrs(reqId, statsToAttrs(stats));
                    });
                });

                sftp.on('LSTAT', (reqId, sftpPath) => {
                    const localPath = toLocalPath(sftpPath);
                    if (!localPath) return sftp.status(reqId, 3);

                    fs.lstat(localPath, (err, stats) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.attrs(reqId, statsToAttrs(stats));
                    });
                });

                sftp.on('MKDIR', (reqId, sftpPath, attrs) => {
                    const localPath = toLocalPath(sftpPath);
                    if (!localPath) return sftp.status(reqId, 3);
                    fs.mkdir(localPath, (err) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.status(reqId, 0);
                    });
                });

                sftp.on('RMDIR', (reqId, sftpPath) => {
                    const localPath = toLocalPath(sftpPath);
                    if (!localPath) return sftp.status(reqId, 3);
                    fs.rmdir(localPath, (err) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.status(reqId, 0);
                    });
                });

                sftp.on('REMOVE', (reqId, sftpPath) => {
                    const localPath = toLocalPath(sftpPath);
                    if (!localPath) return sftp.status(reqId, 3);
                    fs.unlink(localPath, (err) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.status(reqId, 0);
                    });
                });

                sftp.on('RENAME', (reqId, oldPath, newPath) => {
                    const localOldPath = toLocalPath(oldPath);
                    const localNewPath = toLocalPath(newPath);
                    if (!localOldPath || !localNewPath) return sftp.status(reqId, 3);

                    fs.rename(localOldPath, localNewPath, (err) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.status(reqId, 0);
                    });
                });

                sftp.on('SETSTAT', (reqId, sftpPath, attrs) => {
                    // Setting attributes is often limited on Windows
                    // We'll just acknowledge it for compatibility
                    sftp.status(reqId, 0);
                });
            });
        });
    });

    client.on('end', () => {
        console.log('Client disconnected');
    });

    client.on('error', (err) => {
        console.error('Client error:', err.message);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`SFTP Server listening on port ${PORT}`);
    console.log(`Root directory: ${REMOTE_FOLDER}`);
});
