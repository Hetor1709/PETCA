/* Arranque con autodiagnóstico.
   Prepara el .env, comprueba MySQL, crea la base y las tablas si no existen, aplica migraciones
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

/* 1. Archivo .env: si no existe se crea con los valores por defecto de XAMPP (root sin contraseña) */
function prepararEnv() {
  // En Vercel la configuración llega por variables de entorno del proyecto (no hay .env ni disco escribible)
  if (process.env.VERCEL) return;
  if (!fs.existsSync(ENV)) {
    const ejemplo = path.join(RAIZ, '.env.example');
    let texto = fs.existsSync(ejemplo) ? fs.readFileSync(ejemplo, 'utf8') : '';
    texto = texto.replace(/^DB_USER=.*$/m, 'DB_USER=root').replace(/^DB_PASSWORD=.*$/m, 'DB_PASSWORD=');
    if (!/^DB_USER=/m.test(texto)) texto += '\nDB_USER=root\nDB_PASSWORD=\n';
    fs.writeFileSync(ENV, texto);
    console.log(amarillo('[!] No había archivo .env: se creó uno con la configuración de XAMPP (usuario root, sin contraseña).'));
    console.log(amarillo('    Si tu MySQL usa otro usuario o contraseña, edita el archivo .env y vuelve a ejecutar npm start.'));
  }
  require('dotenv').config({ path: ENV });
}

/* Mensaje claro para cada error típico de MySQL */
function explicarErrorBD(e) {
  const { config, nombreBase } = require('./db');
  const cfg = config();
  const host = `${cfg.host}:${cfg.port}`;
  switch (e.code) {
    case 'ECONNREFUSED': case 'ETIMEDOUT': case 'EHOSTUNREACH': case 'ENOTFOUND': case 'PROTOCOL_CONNECTION_LOST':
      return process.env.VERCEL
        ? `La base de datos en ${host} no responde. Revisa en Vercel las variables DATABASE_URL o DB_HOST/DB_PORT y que el cluster esté activo.`
        : `MySQL no responde en ${host}. Abre XAMPP y presiona "Start" en MySQL.`;
    case 'ER_ACCESS_DENIED_ERROR': case 'ER_NOT_SUPPORTED_AUTH_MODE':
      return process.env.VERCEL
        ? `La base de datos rechazó el usuario "${cfg.user}". Revisa DB_USER y DB_PASSWORD (o DATABASE_URL) en las variables del proyecto en Vercel.`
        : `MySQL rechazó el usuario "${cfg.user}". Revisa DB_USER y DB_PASSWORD en el archivo .env `
          + '(con XAMPP recién instalado: DB_USER=root y DB_PASSWORD vacío).';
    case 'ER_DBACCESS_DENIED_ERROR':
      return `El usuario "${cfg.user}" no tiene permiso para crear la base "${nombreBase()}". `
        + 'Usa DB_USER=root en el .env o crea la base con: npm run db';
    case 'HANDSHAKE_SSL_ERROR': case 'ERR_TLS_CERT_ALTNAME_INVALID': case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE': case 'DEPTH_ZERO_SELF_SIGNED_CERT':
      return `No se pudo establecer la conexión segura (TLS) con ${host}. Revisa que DB_HOST sea el host público de tu proveedor.`;
    default:
      return `Error de MySQL (${e.code || e.message}).`;
  }
}

/* Crea la base de datos y las tablas (database/schema.sql). Es seguro repetirlo: todo usa IF NOT EXISTS. */
async function crearEsquema() {
  const mysql = require('mysql2/promise');
  const { config, nombreBase } = require('./db');
  const nombre = nombreBase();
  if (!/^[A-Za-z0-9_]+$/.test(nombre)) throw new Error('El nombre de la base solo puede tener letras, números y guion bajo.');
  // Ruta escrita completa para que Vercel incluya schema.sql al empaquetar la función
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8')
    .replace(/CREATE DATABASE IF NOT EXISTS \w+/, `CREATE DATABASE IF NOT EXISTS \`${nombre}\``)
    .replace(/^USE \w+;/m, `USE \`${nombre}\`;`);
  const c = await mysql.createConnection({ ...config({ conBase: false }), multipleStatements: true });
  try { await c.query(sql); } finally { await c.end(); }
}

/* Migraciones: agregan columnas o catálogos nuevos a bases creadas con versiones anteriores */
async function migrar(q) {
  const columnas = async (tabla) => new Set((await q(
    'SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [tabla])).map((x) => x.c));
  const cambios = [];

  const colsR = await columnas('refugios');
  for (const [c, tipo] of [['lat', 'DECIMAL(9,6) NULL'], ['lng', 'DECIMAL(9,6) NULL'], ['place_id', 'VARCHAR(300) NULL']]) {
    if (!colsR.has(c)) { await q(`ALTER TABLE refugios ADD COLUMN ${c} ${tipo}`); cambios.push(`refugios.${c}`); }
  }
  const tipoCat = await q("SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'catalogo_valores' AND COLUMN_NAME = 'catalogo'");
  if (tipoCat[0] && !String(tipoCat[0].t).includes("'vacuna'")) {
    await q("ALTER TABLE catalogo_valores MODIFY catalogo ENUM('tamano','edad','tipo_requisito','alcaldia','vacuna') NOT NULL");
    cambios.push('catálogo de vacunas');
  }
  if (!(await q("SELECT id FROM catalogo_valores WHERE catalogo = 'vacuna' LIMIT 1")).length) {
    const iniciales = ['Antirrábica', 'Parvovirus', 'Moquillo', 'Hepatitis canina', 'Leptospirosis', 'Parainfluenza', 'Bordetella (tos de las perreras)', 'Coronavirus canino', 'Múltiple (quíntuple o séxtuple)'];
    for (const [i, v] of iniciales.entries()) await q("INSERT IGNORE INTO catalogo_valores (catalogo, nombre, orden) VALUES ('vacuna', ?, ?)", [v, i + 1]);
  }
  const tablaFotos = await q("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'fotos'");
  if (!Number(tablaFotos[0].n)) {
    await q('CREATE TABLE fotos (nombre CHAR(37) PRIMARY KEY, tipo VARCHAR(20) NOT NULL, datos MEDIUMBLOB NOT NULL, creada_en DATETIME NOT NULL) ENGINE=InnoDB');
    cambios.push('tabla fotos');
  }
  const colsA = await columnas('animales');
  for (const c of ['salud_general', 'tratamiento', 'temp_general', 'temp_perros', 'temp_desconocidos', 'temp_comida']) {
    if (!colsA.has(c)) { await q(`ALTER TABLE animales ADD COLUMN ${c} VARCHAR(20) NULL`); cambios.push(`animales.${c}`); }
  }
  if (cambios.length) console.log(verde(`[✓] Base de datos actualizada: ${cambios.join(', ')}`));
}

/* 2. Base de datos: conecta, crea lo que falte y migra. Devuelve null si todo está bien o el mensaje del problema. */
async function prepararBD() {
  const { q } = require('./db');
  try {
    await q('SELECT 1');
  } catch (e) {
    if (e.code !== 'ER_BAD_DB_ERROR') return explicarErrorBD(e);
    console.log(amarillo(`[!] La base "${require('./db').nombreBase()}" no existe: creándola...`));
    try { await crearEsquema(); } catch (e2) { return explicarErrorBD(e2); }
  }
  try {
    const tablas = await q("SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'usuarios'");
    if (!Number(tablas[0].n)) {
      console.log(amarillo('[!] Faltan las tablas: creándolas...'));
      await crearEsquema();
    }
    await migrar(q);
    const admins = await q("SELECT COUNT(*) AS n FROM usuarios WHERE tipo = 'admin' AND estado = 'activa'");
    if (!Number(admins[0].n)) {
      console.log(amarillo('[!] Aún no hay administrador. Créalo con:  npm run admin -- correo@ejemplo.com "Tu Nombre" Clave123'));
    }
    return null;
  } catch (e) {
    return explicarErrorBD(e);
  }
}

/* 3. Archivos: compara cada archivo con la huella guardada al empaquetar (detecta copias viejas o a medias) */
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
const huella = (rel) => crypto.createHash('sha256').update(fs.readFileSync(path.join(RAIZ, rel))).digest('hex').slice(0, 16);

function generarManifiesto() {
  const archivos = Object.fromEntries(ARCHIVOS().map((f) => [f, huella(f)]));
  fs.writeFileSync(MANIFIESTO, `${JSON.stringify({ version: VERSION, archivos }, null, 1)}\n`);
  return Object.keys(archivos).length;
}

function revisarArchivos() {
  if (process.env.VERCEL || !fs.existsSync(MANIFIESTO)) return { faltan: [], distintos: [], sinManifiesto: true };
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
  VERSION, prepararEnv, prepararBD, crearEsquema, migrar, explicarErrorBD,
  generarManifiesto, revisarArchivos, direcciones, verde, amarillo, rojo,
};
