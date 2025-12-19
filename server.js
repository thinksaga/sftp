const fs = require('fs');
const { Server } = require('ssh2');
const path = require('path');

const HOST_KEY_PATH = 'host_rsa_key';
const REMOTE_FOLDER = path.join(__dirname, 'remote_folder');

// Ensure remote_folder exists
if (!fs.existsSync(REMOTE_FOLDER)) {
    fs.mkdirSync(REMOTE_FOLDER);
}

if (!fs.existsSync(HOST_KEY_PATH)) {
    console.error('Host key not found. Please generate it first.');
    process.exit(1);
}

function toLocalPath(sftpPath) {
    let normalized = path.normalize(sftpPath);
    if (normalized.startsWith('/') || normalized.startsWith('\\')) {
        normalized = normalized.substring(1);
    }
    const resolved = path.resolve(REMOTE_FOLDER, normalized);
    if (!resolved.startsWith(REMOTE_FOLDER)) {
        return null;
    }
    return resolved;
}

const server = new Server({
    hostKeys: [fs.readFileSync(HOST_KEY_PATH)]
}, (client) => {
    console.log('Client connected!');

    client.on('authentication', (ctx) => {
        const allowedUser = process.env.SFTP_USER || 'user';
        const allowedPass = process.env.SFTP_PASS || 'password';

        if (ctx.method === 'password' && ctx.username === allowedUser && ctx.password === allowedPass) {
            ctx.accept();
        } else {
            ctx.reject();
        }
    });

    client.on('ready', () => {
        console.log('Client authenticated!');

        client.on('session', (accept, reject) => {
            const session = accept();
            session.on('sftp', (accept, reject) => {
                console.log('Client requested SFTP');
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
                        if (err.code === 'ENOENT') code = 2;
                        if (err.code === 'EACCES') code = 3;
                    }
                    sftp.status(reqId, code);
                }

                sftp.on('OPEN', (reqId, filename, flags, attrs) => {
                    const localPath = toLocalPath(filename);
                    if (!localPath) return sftp.status(reqId, 3);

                    // Map string flags if needed, but ssh2 usually handles it.
                    // However, flags might be a number.
                    // fs.open accepts string or number.
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
                    fs.read(fd, buffer, 0, length, offset, (err, bytesRead, buffer) => {
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

                sftp.on('REALPATH', (reqId, path) => {
                    let name = path;
                    if (path === '.') name = '/';
                    // We always return absolute paths relative to our root
                    // For simplicity, just echo back what they asked for as "root"
                    sftp.name(reqId, [{ filename: name, longname: name }]);
                });

                sftp.on('OPENDIR', (reqId, path) => {
                    const localPath = toLocalPath(path);
                    if (!localPath) return sftp.status(reqId, 3);

                    fs.readdir(localPath, (err, files) => {
                        if (err) return sendStatus(reqId, err);
                        const handle = getHandle();
                        openDirs.set(handle.readUInt32BE(0), files);
                        sftp.handle(reqId, handle);
                    });
                });

                sftp.on('READDIR', (reqId, handle) => {
                    const id = handle.readUInt32BE(0);
                    const files = openDirs.get(id);
                    if (!files) return sftp.status(reqId, 4);

                    if (files.length === 0) {
                        return sftp.status(reqId, 1); // EOF
                    }

                    // Send all files (or a chunk)
                    // For simplicity, send all and clear the list
                    const list = files.map(f => {
                        const stats = fs.statSync(path.join(REMOTE_FOLDER, f)); // Simplified: should use full path
                        // We need to construct attributes.
                        // ssh2 doesn't export a helper for this easily?
                        // We can just send filename and longname.
                        return {
                            filename: f,
                            longname: f, // Ideally `ls -l` format
                            attrs: {
                                mode: stats.mode,
                                uid: stats.uid,
                                gid: stats.gid,
                                size: stats.size,
                                atime: stats.atimeMs / 1000,
                                mtime: stats.mtimeMs / 1000
                            }
                        };
                    });

                    openDirs.set(id, []); // Clear so next call returns EOF
                    sftp.name(reqId, list);
                });

                sftp.on('STAT', (reqId, path) => {
                    const localPath = toLocalPath(path);
                    if (!localPath) return sftp.status(reqId, 3);

                    fs.stat(localPath, (err, stats) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.attrs(reqId, {
                            mode: stats.mode,
                            uid: stats.uid,
                            gid: stats.gid,
                            size: stats.size,
                            atime: stats.atimeMs / 1000,
                            mtime: stats.mtimeMs / 1000
                        });
                    });
                });

                sftp.on('LSTAT', (reqId, path) => {
                    const localPath = toLocalPath(path);
                    if (!localPath) return sftp.status(reqId, 3);

                    fs.lstat(localPath, (err, stats) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.attrs(reqId, {
                            mode: stats.mode,
                            uid: stats.uid,
                            gid: stats.gid,
                            size: stats.size,
                            atime: stats.atimeMs / 1000,
                            mtime: stats.mtimeMs / 1000
                        });
                    });
                });

                sftp.on('MKDIR', (reqId, path, attrs) => {
                    const localPath = toLocalPath(path);
                    if (!localPath) return sftp.status(reqId, 3);
                    fs.mkdir(localPath, (err) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.status(reqId, 0);
                    });
                });

                sftp.on('RMDIR', (reqId, path) => {
                    const localPath = toLocalPath(path);
                    if (!localPath) return sftp.status(reqId, 3);
                    fs.rmdir(localPath, (err) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.status(reqId, 0);
                    });
                });

                sftp.on('REMOVE', (reqId, path) => {
                    const localPath = toLocalPath(path);
                    if (!localPath) return sftp.status(reqId, 3);
                    fs.unlink(localPath, (err) => {
                        if (err) return sendStatus(reqId, err);
                        sftp.status(reqId, 0);
                    });
                });

            });
        });
    });

    client.on('end', () => {
        console.log('Client disconnected');
    });
});

server.listen(2222, '0.0.0.0', () => {
    console.log('SFTP Server listening on port 2222');
});
