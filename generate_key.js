const { generateKeyPairSync } = require('crypto');
const fs = require('fs');

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem'
  },
  privateKeyEncoding: {
    type: 'pkcs1',
    format: 'pem'
  }
});

fs.writeFileSync('host_rsa_key', privateKey);
console.log('Host key generated.');
