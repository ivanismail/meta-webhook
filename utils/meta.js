
const crypto = require('crypto');

function generateAppSecretProof() {
  return crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(process.env.META_SYSTEM_USER_TOKEN)
    .digest('hex');
}

module.exports = {
  generateAppSecretProof
};
