/* Conexión a MySQL con consultas parametrizadas (nunca se concatenan valores del usuario en SQL). */
const mysql = require('mysql2/promise');

const EN_VERCEL = !!process.env.VERCEL;

/* Configuración de conexión. Acepta DATABASE_URL (mysql://usuario:clave@host:puerto/base) o las variables DB_*.
   En la nube (TiDB Cloud, Aiven…) la conexión va cifrada con TLS 1.2+ y verificando el certificado. */
function config({ conBase = true } = {}) {
  let c;
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    c = {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: decodeURIComponent(u.pathname.slice(1)) || process.env.DB_NAME || 'dopta',
    };
  } else {
    c = {
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'dopta',
    };
  }
  const ssl = process.env.DB_SSL === 'true' || /ssl/i.test(process.env.DATABASE_URL || '') || /tidbcloud\.com$|aivencloud\.com$/.test(c.host);
  if (ssl) c.ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  if (!conBase) delete c.database;
  return { ...c, charset: 'utf8mb4' };
}
const nombreBase = () => config().database;

const pool = mysql.createPool({
  ...config(),
  dateStrings: true,          // las fechas llegan como texto AAAA-MM-DD HH:MM:SS (hora CDMX)
  connectionLimit: EN_VERCEL ? 3 : 10, // en Vercel cada instancia usa pocas conexiones
  enableKeepAlive: true,
  idleTimeout: 60000,
  multipleStatements: false,  // impide inyecciones con varias sentencias
});

const q = async (sql, params = [], conn = pool) => (await conn.execute(sql, params))[0];
const uno = async (sql, params = [], conn = pool) => (await q(sql, params, conn))[0] || null;

/* Ejecuta fn dentro de una transacción; hace rollback si algo falla */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { pool, q, uno, tx, config, nombreBase, EN_VERCEL };
