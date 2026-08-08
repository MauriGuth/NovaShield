// Config de ESLint del template de Expo, versionada para que `expo lint` sea
// reproducible en cualquier máquina (sin que el CLI la genere/instale al vuelo).
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
]);
