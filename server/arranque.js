/* Arranque con autodiagnóstico.
   Carga el .env, comprueba MySQL (y crea la base si falta), crea o actualiza las tablas (database/schema.sql es idempotente)
   y revisa que los archivos del proyecto sean los de esta versión. Si algo falla, explica cómo resolverlo. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..');
const ENV = path.join(RAIZ, '.env');
const MANIFIESTO = path.join(__dirname, 'manifiesto.json');
const VERSION = require('../package.json').version;

const verde = (t) => `\x1b[32m${t}\x1b[0m`;
const amarillo = (t) => `\x1b[33m${t}\x1b[0m`;
const rojo = (t) => `\x1b[31m${t}\x1b[0m`;

/* 1. Archivo .env: si no existe se crea a partir de .env.example */
function prepararEnv() {
  if (!fs.existsSync(ENV)) {
    const ejemplo = path.join(RAIZ, '.env.example');
    fs.writeFileSync(ENV, fs.existsSync(ejemplo) ? fs.readFileSync(ejemplo, 'utf8') : '');
    console.log(amarillo('[!] No había archivo .env: se creó uno a partir de .env.example.'));
    console.log(amarillo('    Si tu MySQL tiene contraseña, ponla en DB_PASSWORD y vuelve a ejecutar npm start.'));
  }
  require('dotenv').config({ path: ENV });
}

/* Mensaje claro para cada error típico de MySQL */
function explicarErrorBD(e) {
  const { descripcion, nombreBase } = require('./db');
  const donde = descripcion();
  switch (e.code) {
    case 'ECONNREFUSED': case 'ETIMEDOUT': case 'EHOSTUNREACH': case 'ENOTFOUND': case 'ECONNRESET': case 'EAI_AGAIN': case 'PROTOCOL_CONNECTION_LOST':
      return `No se pudo conectar con ${donde}. Comprueba que el servicio de MySQL esté iniciado y que DB_HOST y DB_PORT del archivo .env sean correctos.`;
    case 'ER_ACCESS_DENIED_ERROR': case 'ER_ACCESS_DENIED_NO_PASSWORD_ERROR':
      return `MySQL rechazó el usuario o la contraseña (${donde}). Revisa DB_USER y DB_PASSWORD en el archivo .env.`;
    case 'ER_BAD_DB_ERROR':
      return `La base de datos "${nombreBase()}" no existe y no se pudo crear. Créala desde MySQL con:  CREATE DATABASE ${nombreBase()} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`;
    case 'ER_DBACCESS_DENIED_ERROR': case 'ER_TABLEACCESS_DENIED_ERROR': case 'ER_SPECIFIC_ACCESS_DENIED_ERROR':
      return `El usuario de MySQL no tiene permisos sobre la base "${nombreBase()}" (crear tablas, consultar y modificar). Usa un usuario con todos los permisos sobre esa base, por ejemplo root.`;
    case 'ER_CON_COUNT_ERROR':
      return 'MySQL tiene demasiadas conexiones abiertas. Cierra otros programas que lo usen o reinicia el servicio.';
    default:
      return `Error de MySQL (${e.code || ''} ${e.message}).`;
  }
}

/* La base se crea sola la primera vez (solo si no existe). El nombre viene de .env: se valida antes de usarlo en SQL. */
async function crearBase() {
  const mysql = require('mysql2/promise');
  const { config, nombreBase } = require('./db');
  const nombre = nombreBase();
  if (!/^[A-Za-z0-9_$]{1,64}$/.test(nombre)) throw new Error(`DB_NAME "${nombre}" no es válido: usa solo letras, números y guion bajo.`);
  const c = await mysql.createConnection(config({ conBase: false }));
  try {
    await c.query(`CREATE DATABASE IF NOT EXISTS \`${nombre}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await c.end().catch(() => {});
  }
}

/* Crea o actualiza las tablas. Es seguro repetirlo: todo usa IF NOT EXISTS / INSERT IGNORE. */
async function crearEsquema() {
  const mysql = require('mysql2/promise');
  const { config } = require('./db');
  // Ruta escrita completa para que los empaquetadores incluyan schema.sql
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  // Conexión aparte con varias sentencias permitidas (el esquema es un archivo propio, sin datos del usuario)
  const c = await mysql.createConnection({ ...config(), multipleStatements: true });
  try {
    const [[bloqueo]] = await c.query("SELECT GET_LOCK('dopta_esquema', 30) AS ok"); // si arrancan dos procesos, uno espera al otro
    if (!bloqueo.ok) throw new Error('No se pudo obtener el bloqueo para crear las tablas.');
    await c.query(sql);
  } finally {
    await c.query("DO RELEASE_LOCK('dopta_esquema')").catch(() => {});
    await c.end().catch(() => {});
  }
}

/* Dopta usa FOR UPDATE OF, columnas generadas y CHECK: pide MySQL 8.0.16 o más reciente (MariaDB no es compatible) */
function versionCompatible(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v));
  if (!m || /mariadb/i.test(String(v))) return false;
  const [mayor, menor, parche] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mayor > 8 || (mayor === 8 && (menor > 0 || parche >= 16));
}

/* 2. Base de datos: conecta (creándola si falta) y crea/actualiza las tablas. Devuelve null si todo está bien o el mensaje del problema. */
async function prepararBD() {
  const { q } = require('./db');
  try {
    try { await q('SELECT 1'); } catch (e) {
      if (e.code !== 'ER_BAD_DB_ERROR') throw e;
      await crearBase();
    }
    const [{ v }] = await q('SELECT VERSION() AS v');
    if (!versionCompatible(v)) return `Dopta necesita MySQL 8.0.16 o más reciente y esta computadora tiene ${v}. Descarga MySQL Community Server en https://dev.mysql.com/downloads/mysql/ (MariaDB no es compatible).`;
    await crearEsquema();
    const admins = await q("SELECT COUNT(*) AS n FROM usuarios WHERE tipo = 'admin' AND estado = 'activa'");
    if (!Number(admins[0].n)) {
      console.log(amarillo('[!] Aún no hay administrador. Créalo con:  npm run admin -- correo@ejemplo.com "Tu Nombre" Clave123'));
    }
    return null;
  } catch (e) {
    return explicarErrorBD(e);
  }
}

/* 3. Archivos: compara cada archivo con la huella guardada al empaquetar (detecta copias viejas o a medias).
   Se ignoran los saltos de línea (Windows/Git los cambian a CRLF) para no dar falsas alarmas. */
const ARCHIVOS = () => {
  const lista = [];
  const recorrer = (dir) => {
    for (const f of fs.readdirSync(path.join(RAIZ, dir))) {
      const rel = `${dir}/${f}`;
      const abs = path.join(RAIZ, rel);
      if (fs.statSync(abs).isDirectory()) recorrer(rel);
      else if (/\.(js|css|html|json|sql|svg)$/.test(f) && f !== 'manifiesto.json') lista.push(rel);
    }
  };
  ['public', 'server', 'database'].forEach((d) => fs.existsSync(path.join(RAIZ, d)) && recorrer(d));
  return lista.sort();
};
const huella = (rel) => crypto.createHash('sha256')
  .update(fs.readFileSync(path.join(RAIZ, rel), 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);

function generarManifiesto() {
  const archivos = Object.fromEntries(ARCHIVOS().map((f) => [f, huella(f)]));
  fs.writeFileSync(MANIFIESTO, `${JSON.stringify({ version: VERSION, archivos }, null, 1)}\n`);
  return Object.keys(archivos).length;
}

function revisarArchivos() {
  if (!fs.existsSync(MANIFIESTO)) return { faltan: [], distintos: [], sinManifiesto: true };
  const m = JSON.parse(fs.readFileSync(MANIFIESTO, 'utf8'));
  const faltan = [];
  const distintos = [];
  for (const [f, h] of Object.entries(m.archivos)) {
    if (!fs.existsSync(path.join(RAIZ, f))) faltan.push(f);
    else if (huella(f) !== h) distintos.push(f);
  }
  // app.js declara su versión: si no coincide con package.json, el navegador recibiría una app de otra versión
  try {
    const app = fs.readFileSync(path.join(RAIZ, 'public', 'app.js'), 'utf8');
    if (!app.includes(`VERSION_APP = '${VERSION}'`) && !distintos.includes('public/app.js')) distintos.push('public/app.js');
  } catch { /* ya se reporta como faltante */ }
  return { faltan, distintos, version: m.version };
}

/* Direcciones para abrir Dopta desde esta computadora y desde otros dispositivos de la misma red */
function direcciones(puerto) {
  const red = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${puerto}`);
  return { local: `http://localhost:${puerto}`, red };
}

module.exports = {
  VERSION, prepararEnv, prepararBD, crearBase, crearEsquema, versionCompatible, explicarErrorBD,
  generarManifiesto, revisarArchivos, direcciones, verde, amarillo, rojo,
};
