/* Herramientas de línea de comandos:
     npm run db                                   crea o actualiza las tablas (database/schema.sql)
     npm run admin -- correo@x.com "Nombre" Clave123   crea el ÚNICO Administrador (--reemplazar para cambiarlo)
     npm run demo                                 carga refugios, animales y un adoptante de prueba
     npm run respaldo                             respaldo con pg_dump y rotación (RNF-06)
     npm run empaquetar                           zip de entrega SIN .env ni node_modules
     npm run verificar                            diagnóstico completo: Node, dependencias, .env, PostgreSQL, tablas y archivos */
const arranque = require('./arranque');

arranque.prepararEnv();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const bcrypt = require('bcryptjs');
const { ahora, hoy, sumarDias } = require('./util');
const { q, uno, pool } = require('./db');

async function esquema() {
  const problema = await arranque.prepararBD(); // crea o actualiza las tablas
  if (problema) throw new Error(problema);
  console.log('Base de datos lista.');
}

/* Solo existe un Administrador (índice único uq_un_admin). Con --reemplazar se cambian sus datos en lugar de crear otro. */
async function admin(args) {
  const reemplazar = args.includes('--reemplazar');
  const [correo, nombre, clave] = args.filter((a) => a !== '--reemplazar');
  if (!correo || !nombre || !clave) throw new Error('Uso: npm run admin -- correo@dominio.com "Nombre completo" Contrasena123   (agrega --reemplazar para cambiar al Administrador actual)');
  await esquema();
  const { V } = require('./util');
  const datos = [V.nombrePersona(nombre), V.correo(correo), await bcrypt.hash(V.contrasena(clave), 12)];
  const actual = await uno("SELECT id, correo FROM usuarios WHERE tipo = 'admin'");
  const t = ahora();
  if (actual && !reemplazar) throw new Error(`Ya existe el Administrador ${actual.correo}. Solo puede haber uno. Para cambiarlo: npm run admin -- ${correo} "${nombre}" ****** --reemplazar`);
  if (actual) {
    await q("UPDATE usuarios SET nombre = ?, correo = ?, hash = ?, estado = 'activa' WHERE id = ?", [...datos, actual.id]);
    await q('DELETE FROM sesiones WHERE usuario_id = ?', [actual.id]);
    console.log(`Administrador reemplazado: ahora es ${correo}.`);
  } else {
    await q(`INSERT INTO usuarios (tipo, nombre, correo, hash, estado, aviso_version, aviso_fecha, creado, mayor_edad_en)
             VALUES ('admin', ?, ?, ?, 'activa', 'v1.0', ?, ?, ?)`, [...datos, t, t, t]);
    console.log(`Administrador ${correo} creado.`);
  }
}

async function demo() {
  await esquema();
  const id = async (cat, nombre) => (await uno('SELECT id FROM catalogo_valores WHERE catalogo = ? AND nombre = ?', [cat, nombre])).id;
  const t = ahora();
  const hash = await bcrypt.hash('Demo12345', 12);
  const usuario = async (tipo, nombre, correo, telefono = null) => {
    const ex = await uno("SELECT id FROM usuarios WHERE lower(correo) = ? AND estado NOT IN ('baja','eliminada')", [correo]);
    if (ex) return ex.id;
    const r = await q(
      `INSERT INTO usuarios (tipo, nombre, correo, telefono, hash, estado, aviso_version, aviso_fecha, creado, verificado_en, mayor_edad_en)
       VALUES (?, ?, ?, ?, ?, 'activa', 'v1.0', ?, ?, ?, ?) RETURNING id`, [tipo, nombre, correo, telefono, hash, t, t, t, t]);
    return r.insertId;
  };
  const refugios = [
    ['Patitas Felices', 'refugio1@dopta.demo', ['Av. Universidad', '1200', null, 'Xoco', '03330'], '5552781934', 'Benito Juárez'],
    ['Huellitas del Sur', 'refugio2@dopta.demo', ['Calz. de Tlalpan', '3400', null, 'Santa Úrsula Coapa', '04650'], '5556897412', 'Coyoacán'],
  ];
  const ids = [];
  for (const [n, m, [calle, ext, int, col, cp], tel, alc] of refugios) {
    const rid = await usuario('refugio', n, m);
    ids.push(rid);
    await q(`INSERT INTO refugios (usuario_id, institucion, direccion, calle, num_ext, num_int, colonia, cp, telefono, alcaldia_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (usuario_id) DO NOTHING`,
    [rid, `Asociación ${n} A.C.`, `${calle} ${ext}, Col. ${col}, C.P. ${cp}`, calle, ext, int, col, cp, tel, await id('alcaldia', alc)]);
    for (let dia = 0; dia < 7; dia++) {
      await q('INSERT INTO refugio_horarios (refugio_id, dia, cerrado, abre, cierra) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        [rid, dia, dia === 6 ? 1 : 0, dia === 6 ? null : '10:00', dia === 6 ? null : (dia === 5 ? '14:00' : '18:00')]);
    }
  }
  await usuario('adoptante', 'Ana López', 'adoptante@dopta.demo', '5598765432');
  // Peso y altura de ejemplo: el valor sugerido por las reglas de crecimiento (public/reglas.js)
  const { RAZAS_LISTA, Reglas, mesesDeEdad } = require('./util');
  const razas = Object.fromEntries(RAZAS_LISTA.map((r) => [r.id, r]));
  const dims = (raza, tam, edad) => { const s = Reglas.sugerido(Reglas.rango(raza, tam, razas), mesesDeEdad(edad)); return [s.peso, s.altura]; };
  const animales = [
    ['Luna', 'labrador', null, '2 años', 'Grande'],
    ['Pancho', 'chihuahua', null, '5 años', 'Pequeño'],
    ['Canela', 'mestizo', 'beagle', '1 año', 'Mediano'],
    ['Rocky', 'boxer', null, '3 años', 'Grande'],
    ['Mota', 'mestizo', 'dalmata', '8 meses', 'Mediano'],
    ['Kira', 'husky', null, '4 años', 'Grande'],
    ['Toby', 'pug', null, '6 años', 'Pequeño'],
    ['Nube', 'bichon-maltes', null, '2 años', 'Pequeño'],
    ['Brownie', 'mestizo', 'labrador', '7 años', 'Grande'],
    ['Simba', 'shiba', null, '3 años', 'Mediano'],
    ['Max', 'border-collie', null, '1 año', 'Mediano'],
    ['Chispa', 'mestizo', null, '4 meses', 'Pequeño'],
  ];
  const ya = await uno('SELECT COUNT(*) AS n FROM animales');
  if (!ya.n) {
    const texto = await id('tipo_requisito', 'Texto');
    const doc = await id('tipo_requisito', 'Documental');
    for (const [i, [n, raza, aprox, edad, tam]] of animales.entries()) {
      const r = await q(
        `INSERT INTO animales (refugio_id, nombre, raza, raza_aprox, edad_id, tamano_id, salud_general, tratamiento,
                               temp_general, temp_perros, temp_desconocidos, temp_comida, fecha_ingreso,
                               esterilizado, fecha_esterilizacion, desparasitado, peso_kg, altura_cm, publicado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?) RETURNING id`,
        [ids[i % 2], n, raza, aprox, await id('edad', edad), await id('tamano', tam),
          ['excelente', 'bueno', 'bueno', 'regular'][i % 4], ['no', 'no', 'dieta', 'no', 'medicamento'][i % 5],
          ['jugueton', 'tranquilo', 'activo', 'tranquilo', 'nervioso'][i % 5], ['sociable', 'selectivo', 'sociable', 'unico'][i % 4],
          ['amigable', 'timido', 'amigable', 'desconfiado'][i % 4], ['tranquilo', 'rapido', 'tranquilo', 'protege'][i % 4],
          sumarDias(hoy(), -(i * 3 + 2)), i % 3 ? 1 : 0, i % 3 ? sumarDias(hoy(), -(i * 3)) : null, ...dims(raza, tam, edad), t, t]);
      await q('INSERT INTO requisitos (animal_id, nombre, tipo_id, otro) VALUES (?, ?, ?, 0), (?, ?, ?, 0), (?, ?, ?, 1)',
        [r.insertId, 'Identificación oficial vigente (INE o pasaporte)', doc, r.insertId, 'Comprobante de domicilio reciente', doc,
          r.insertId, 'Nombre completo y teléfono', texto]);
      await q('INSERT INTO vacunas (animal_id, nombre, fecha) VALUES (?, ?, ?)', [r.insertId, 'Antirrábica', sumarDias(hoy(), -(i * 3 + 1))]);
    }
  }
  console.log('Datos de prueba listos. Contraseña de todas las cuentas: Demo12345');
  console.log('  Refugios: refugio1@dopta.demo, refugio2@dopta.demo · Adoptante: adoptante@dopta.demo');
}

/* RNF-06: respaldo con pg_dump (cliente de PostgreSQL), conserva los últimos RESPALDO_DIAS archivos.
   Supabase también hace respaldos diarios automáticos; este sirve para tener una copia propia. */
function respaldo() {
  const dir = path.resolve(process.env.RESPALDO_DIR || 'respaldos');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `dopta_${ahora().replace(/[: ]/g, '-')}.sql`);
  const c = require('./db').config();
  const args = c.connectionString
    ? ['--no-owner', '--no-privileges', '--dbname', c.connectionString]
    : ['--no-owner', '--no-privileges', '-h', c.host, '-p', String(c.port), '-U', c.user, c.database];
  return new Promise((ok, mal) => {
    const p = spawn(process.env.PG_DUMP || 'pg_dump', args, { env: { ...process.env, PGPASSWORD: c.password || '', PGSSLMODE: c.ssl ? 'require' : 'prefer' } });
    const out = fs.createWriteStream(archivo);
    p.stdout.pipe(out);
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('error', (e) => mal(e.code === 'ENOENT' ? new Error('No se encontró pg_dump. Instala el cliente de PostgreSQL o indica su ruta en PG_DUMP.') : e));
    p.on('close', (code) => {
      if (code !== 0) return mal(new Error(`pg_dump terminó con código ${code}`));
      const viejos = fs.readdirSync(dir).filter((f) => /^dopta_.*\.sql$/.test(f)).sort().reverse()
        .slice(Number(process.env.RESPALDO_DIAS || 30));
      viejos.forEach((f) => fs.unlinkSync(path.join(dir, f)));
      console.log(`Respaldo creado: ${archivo}`);
      ok();
    });
  });
}

/* Zip de entrega con lista blanca: solo entra lo necesario para instalar el proyecto.
   Nunca incluye .env (contraseñas), node_modules, respaldos ni la versión antigua. */
const ENTREGA = ['public', 'server', 'database', 'package.json', 'package-lock.json', '.env.example', '.gitignore', '.gitattributes', 'README.md', 'render.yaml'];
function empaquetar() {
  const n = arranque.generarManifiesto(); // huella de cada archivo para detectar copias desactualizadas
  console.log(`Manifiesto actualizado (${n} archivos, versión ${arranque.VERSION}).`);
  const raiz = path.join(__dirname, '..');
  const dir = path.join(raiz, 'entrega');
  fs.mkdirSync(dir, { recursive: true });
  const nombre = `dopta-web_${hoy()}.zip`;
  const destino = path.join(dir, nombre);
  if (fs.existsSync(destino)) fs.unlinkSync(destino);
  const items = ENTREGA.filter((x) => fs.existsSync(path.join(raiz, x)));
  // Windows 10+ trae tar (bsdtar), que crea .zip con -a; en Linux/macOS se usa zip
  const [prog, argsZip] = process.platform === 'win32' ? ['tar', ['-a', '-c', '-f', destino, ...items]] : ['zip', ['-q', '-r', destino, ...items]];
  return new Promise((ok, mal) => {
    const p = spawn(prog, argsZip, { cwd: raiz, stdio: 'inherit' });
    p.on('error', mal);
    p.on('close', (code) => {
      if (code !== 0) return mal(new Error(`${prog} terminó con código ${code}`));
      console.log(`Entrega lista: entrega${path.sep}${nombre}`);
      console.log(`Incluye: ${items.join(', ')}`);
      console.log('No incluye: .env, node_modules, respaldos ni los HTML/CSS/JS antiguos de la raíz.');
      ok();
    });
  });
}

/* Diagnóstico completo del entorno */
async function verificar() {
  const { verde, amarillo, rojo } = arranque;
  let ok = true;
  const bien = (t) => console.log(verde(`[✓] ${t}`));
  const aviso = (t) => console.log(amarillo(`[!] ${t}`));
  const mal = (t) => { ok = false; console.log(rojo(`[X] ${t}`)); };
  console.log(`\nDiagnóstico de Dopta ${arranque.VERSION}\n`);
  const [mayor] = process.versions.node.split('.').map(Number);
  if (mayor >= 18) bien(`Node.js ${process.versions.node}`); else mal(`Node.js ${process.versions.node}: se necesita 18 o más reciente`);
  const pkg = require('../package.json');
  const faltan = Object.keys(pkg.dependencies).filter((d) => { try { require.resolve(d); return false; } catch { return true; } });
  if (faltan.length) mal(`Faltan dependencias: ${faltan.join(', ')}. Ejecuta npm install`); else bien('Dependencias instaladas');
  bien(`Configuración (PostgreSQL: ${require('./db').descripcion()})`);
  const problema = await arranque.prepararBD();
  if (problema) mal(problema); else bien('PostgreSQL conectado y tablas al día');
  const rev = arranque.revisarArchivos();
  if (rev.sinManifiesto) aviso('Sin manifiesto de archivos (se genera con npm run empaquetar)');
  else if (rev.faltan.length || rev.distintos.length) {
    if (rev.faltan.length) mal(`Faltan archivos: ${rev.faltan.join(', ')}`);
    if (rev.distintos.length) aviso(`Archivos distintos a la versión ${rev.version}: ${rev.distintos.join(', ')}`);
  } else bien(`Archivos íntegros (versión ${rev.version})`);
  if (process.env.GOOGLE_MAPS_API_KEY) bien('Autocompletado de direcciones activado'); else aviso('Sin GOOGLE_MAPS_API_KEY: la dirección se escribe a mano (opcional)');
  console.log(ok ? verde('\nTodo listo. Ejecuta npm start.\n') : rojo('\nCorrige los puntos marcados con [X] y vuelve a intentar.\n'));
  if (!ok) process.exitCode = 1;
}

const [, , cmd, ...args] = process.argv;
const tareas = { esquema, admin: () => admin(args), demo, respaldo, empaquetar, verificar, manifiesto: async () => console.log(`Manifiesto: ${arranque.generarManifiesto()} archivos`) };
if (!tareas[cmd]) {
  console.log('Comandos: esquema | admin | demo | respaldo | empaquetar | verificar');
  process.exit(1);
}
tareas[cmd]().then(() => pool.end()).then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e.message); process.exit(1); });
