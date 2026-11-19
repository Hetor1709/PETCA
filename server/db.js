/* Conexión a MySQL local con consultas parametrizadas: nunca se concatenan valores del usuario en SQL.
   Las consultas del proyecto usan "?" como marcador y se ejecutan como sentencias preparadas. */
const mysql = require('mysql2/promise');

/* Configuración: variables DB_* del archivo .env (por defecto, MySQL en esta misma computadora) */
function config({ conBase = true } = {}) {
  const c = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'dopta',
    charset: 'utf8mb4_unicode_ci', // la misma collation del esquema: búsquedas sin distinguir mayúsculas ni acentos
  };
  if (!conBase) delete c.database;
  return c;
}
const nombreBase = () => config().database;

const pool = mysql.createPool({
  ...config(),
  dateStrings: true,            // fechas como texto 'AAAA-MM-DD' y 'AAAA-MM-DD HH:MM:SS' (hora de la CDMX que calcula el servidor)
  connectionLimit: 10,
  enableKeepAlive: true,
  idleTimeout: 60000,
  multipleStatements: false,    // impide inyecciones con varias sentencias
});

/* Un valor de tipo arreglo se expande a una lista: "WHERE id IN (?)" con [1, 2, 3] → "IN (?,?,?)" (con [] → "IN (NULL)").
   Los signos "?" dentro de cadenas entre comillas simples no son marcadores. */
function preparar(sql, params) {
  const valores = params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
  if (!valores.some(Array.isArray)) return [sql, valores];
  let i = 0;
  let enCadena = false;
  let out = '';
  const planos = [];
  for (const ch of sql) {
    if (ch === "'") enCadena = !enCadena;
    if (!enCadena && ch === '?') {
      const v = valores[i++];
      if (Array.isArray(v)) { out += v.length ? v.map(() => '?').join(',') : 'NULL'; planos.push(...v); } else { out += '?'; planos.push(v); }
    } else out += ch;
  }
  return [out, planos];
}

/* Ejecuta la consulta. SELECT → arreglo de filas. INSERT/UPDATE/DELETE → objeto con insertId (id insertado) y affectedRows */
async function q(sql, params = [], conn = pool) {
  const [texto, valores] = preparar(sql, params);
  return (await conn.execute(texto, valores))[0];
}
const uno = async (sql, params = [], conn = pool) => (await q(sql, params, conn))[0] || null;

/* Ejecuta fn dentro de una transacción; hace rollback si algo falla.
   READ COMMITTED: cada consulta ve lo ya confirmado por otras transacciones (el nivel por defecto de PostgreSQL, que
   es el que asumía el código al combinar lecturas con FOR UPDATE). */
async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const r = await fn(conn);
    await conn.commit();
    return r;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

const descripcion = () => {
  const c = config();
  return `MySQL ${c.host}:${c.port}/${c.database}`;
};

module.exports = { pool, q, uno, tx, config, nombreBase, descripcion };
