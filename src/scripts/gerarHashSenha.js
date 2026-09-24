/**
 * Uso: node src/scripts/gerarHashSenha.js "minhaSenhaForte"
 * Gera o hash bcrypt para colocar em SERVICE_CLIENT_SECRET no .env
 */
const bcrypt = require('bcryptjs');

const senha = process.argv[2];

if (!senha) {
  console.error('Uso: node src/scripts/gerarHashSenha.js "minhaSenhaForte"');
  process.exit(1);
}

bcrypt.hash(senha, 12).then((hash) => {
  console.log('\nAdicione esta linha ao seu .env:\n');
  console.log(`SERVICE_CLIENT_SECRET=${hash}\n`);
});
