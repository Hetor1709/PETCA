/* Punto de entrada de "npm start".
   Antes de cargar el servidor revisa que Node sea compatible y que las dependencias estén instaladas;
   si faltan (por ejemplo, al descomprimir el proyecto en otra computadora), ejecuta npm install solo. */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const pkg = require('../package.json');

const [mayor] = process.versions.node.split('.').map(Number);
if (mayor < 18) {
  console.error(`\n[X] Dopta necesita Node.js 18 o más reciente (tienes ${process.versions.node}).`);
  console.error('    Descarga la versión LTS en https://nodejs.org e inténtalo de nuevo.\n');
  process.exit(1);
}

/* ¿Están todas las dependencias y coinciden con package-lock.json? */
function dependenciasListas() {
  for (const dep of Object.keys(pkg.dependencies || {})) {
    try { require.resolve(dep, { paths: [RAIZ] }); } catch { return false; }
  }
  // Si package-lock.json es más nuevo que la instalación, puede faltar alguna versión
  const lock = path.join(RAIZ, 'package-lock.json');
  const instalado = path.join(RAIZ, 'node_modules', '.package-lock.json');
  try {
    if (fs.existsSync(lock) && fs.existsSync(instalado) && fs.statSync(lock).mtimeMs > fs.statSync(instalado).mtimeMs + 1000) return false;
  } catch { /* sin información: se asume instalado */ }
  return true;
}

if (!dependenciasListas()) {
  console.log('\nInstalando dependencias (solo la primera vez, tarda un minuto)...\n');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: RAIZ, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error('\n[X] No se pudieron instalar las dependencias. Revisa tu conexión a internet y vuelve a ejecutar npm start.\n');
    process.exit(1);
  }
}

require('./index').iniciar();
