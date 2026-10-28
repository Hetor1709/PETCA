/* Herramientas de línea de comandos:
     npm run db                                   crea la base y las tablas (database/schema.sql)
     npm run admin -- correo@x.com "Nombre" Clave123   crea el primer Administrador
     npm run demo                                 carga refugios, animales y un adoptante de prueba
     npm run respaldo                             respaldo diario con rotación (RNF-06)
     npm run empaquetar                           zip de entrega SIN .env, node_modules, uploads ni archivos antiguos
     npm run verificar                            diagnóstico completo: Node, dependencias, .env, MySQL, tablas y archivos */
const arranque = require('./arranque');

arranque.prepararEnv();
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { ahora, hoy, sumarDias } = require('./util');

const cfg = () => require('./db').config({ conBase: false }); // incluye TLS y DATABASE_URL para bases en la nube

async function esquema() {
  await arranque.crearEsquema();
  const problema = await arranque.prepararBD(); // aplica también las migraciones
  if (problema) throw new Error(problema);
  console.log('Base de datos lista.');
}

async function admin([correo, nombre, clave]) {
  if (!correo || !nombre || !clave) throw new Error('Uso: npm run admin -- correo@dominio.com "Nombre completo" Contrasena123');
  const { V } = require('./util');
  const c = await mysql.createConnection(require('./db').config());
  const t = ahora();
  await c.execute(
    `INSERT INTO usuarios (tipo, nombre, correo, hash, estado, aviso_version, aviso_fecha, creado)
     VALUES ('admin', ?, ?, ?, 'activa', 'v1.0', ?, ?)`,
    [V.nombrePersona(nombre), V.correo(correo), await bcrypt.hash(V.contrasena(clave), 12), t, t]);
  await c.end();
  console.log(`Administrador ${correo} creado.`);
}

async function demo() {
  const c = await mysql.createConnection(require('./db').config());
  const id = async (cat, nombre) => (await c.execute('SELECT id FROM catalogo_valores WHERE catalogo = ? AND nombre = ?', [cat, nombre]))[0][0].id;
  const t = ahora();
  const hash = await bcrypt.hash('Demo12345', 12);
  const usuario = async (tipo, nombre, correo) => {
    const [ex] = await c.execute('SELECT id FROM usuarios WHERE correo = ?', [correo]);
    if (ex.length) return ex[0].id;
    const [r] = await c.execute(
      `INSERT INTO usuarios (tipo, nombre, correo, hash, estado, aviso_version, aviso_fecha, creado, verificado_en)
       VALUES (?, ?, ?, ?, 'activa', 'v1.0', ?, ?, ?)`, [tipo, nombre, correo, hash, t, t, t]);
    return r.insertId;
  };
  const refugios = [
    ['Patitas Felices', 'refugio1@dopta.demo', 'Av. Universidad 1200, Col. Xoco', '5512345678', 'Benito Juárez'],
    ['Huellitas del Sur', 'refugio2@dopta.demo', 'Calz. de Tlalpan 3400, Col. Santa Úrsula', '5587654321', 'Coyoacán'],
  ];
  const ids = [];
  for (const [n, m, d, tel, alc] of refugios) {
    const rid = await usuario('refugio', n, m);
    ids.push(rid);
    await c.execute('INSERT IGNORE INTO refugios (usuario_id, institucion, direccion, telefono, alcaldia_id) VALUES (?, ?, ?, ?, ?)',
      [rid, `Asociación ${n} A.C.`, d, tel, await id('alcaldia', alc)]);
    for (let dia = 0; dia < 7; dia++) {
      await c.execute('INSERT IGNORE INTO refugio_horarios (refugio_id, dia, cerrado, abre, cierra) VALUES (?, ?, ?, ?, ?)',
        [rid, dia, dia === 6 ? 1 : 0, dia === 6 ? null : '10:00', dia === 6 ? null : (dia === 5 ? '14:00' : '18:00')]);
    }
  }
  await usuario('adoptante', 'Ana López', 'adoptante@dopta.demo');
  const animales = [
    ['Luna', 'labrador', null, '2 años', 'Grande', 'Juguetona y muy cariñosa con niños.'],
    ['Pancho', 'chihuahua', null, '5 años', 'Pequeño', 'Tranquilo, ideal para departamento.'],
    ['Canela', 'mestizo', 'beagle', '1 año', 'Mediano', 'Curiosa, le encanta olfatear todo en los paseos.'],
    ['Rocky', 'boxer', null, '3 años', 'Grande', 'Energético, necesita paseos largos.'],
    ['Mota', 'mestizo', 'dalmata', '8 meses', 'Mediano', 'Cachorro sociable con otros perros.'],
    ['Kira', 'husky', null, '4 años', 'Grande', 'Activa e independiente; requiere experiencia.'],
    ['Toby', 'pug', null, '6 años', 'Pequeño', 'Dormilón y muy apegado a las personas.'],
    ['Nube', 'bichon-maltes', null, '2 años', 'Pequeño', 'Dulce y tranquila.'],
    ['Brownie', 'mestizo', 'labrador', '7 años', 'Grande', 'Noble, ya sabe pasear con correa.'],
    ['Simba', 'shiba', null, '3 años', 'Mediano', 'Limpio y reservado al principio.'],
    ['Max', 'border-collie', null, '1 año', 'Mediano', 'Inteligente; aprende trucos rápido.'],
    ['Chispa', 'mestizo', null, '4 meses', 'Pequeño', 'Cachorrita llena de energía.'],
  ];
  const [ya] = await c.execute('SELECT COUNT(*) AS n FROM animales');
  if (!ya[0].n) {
    const texto = await id('tipo_requisito', 'Texto');
    const doc = await id('tipo_requisito', 'Documental');
    for (const [i, [n, raza, aprox, edad, tam]] of animales.entries()) {
      const [r] = await c.execute(
        `INSERT INTO animales (refugio_id, nombre, raza, raza_aprox, edad_id, tamano_id, salud_general, tratamiento,
                               temp_general, temp_perros, temp_desconocidos, temp_comida, fecha_ingreso,
                               esterilizado, fecha_esterilizacion, publicado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ids[i % 2], n, raza, aprox, await id('edad', edad), await id('tamano', tam),
          ['excelente', 'bueno', 'bueno', 'regular'][i % 4], ['no', 'no', 'dieta', 'no', 'medicamento'][i % 5],
          ['jugueton', 'tranquilo', 'activo', 'tranquilo', 'nervioso'][i % 5], ['sociable', 'selectivo', 'sociable', 'unico'][i % 4],
          ['amigable', 'timido', 'amigable', 'desconfiado'][i % 4], ['tranquilo', 'rapido', 'tranquilo', 'protege'][i % 4],
          sumarDias(hoy(), -(i * 3 + 2)), i % 3 ? 1 : 0, i % 3 ? sumarDias(hoy(), -(i * 3)) : null, t, t]);
      await c.execute('INSERT INTO requisitos (animal_id, nombre, tipo_id) VALUES (?, ?, ?), (?, ?, ?)',
        [r.insertId, 'Nombre completo y teléfono', texto, r.insertId, 'Copia de identificación oficial', doc]);
      await c.execute('INSERT INTO vacunas (animal_id, nombre, fecha) VALUES (?, ?, ?)', [r.insertId, 'Antirrábica', sumarDias(hoy(), -(i * 3 + 1))]);
    }
  }
  await c.end();
  console.log('Datos de prueba listos. Contraseña de todas las cuentas: Demo12345');
  console.log('  Refugios: refugio1@dopta.demo, refugio2@dopta.demo · Adoptante: adoptante@dopta.demo');
}

/* RNF-06: respaldo con mysqldump, conserva los últimos RESPALDO_DIAS archivos.
   Programarlo una vez al día (Programador de tareas de Windows o cron). */
function respaldo() {
  const dir = path.resolve(process.env.RESPALDO_DIR || 'respaldos');
  fs.mkdirSync(dir, { recursive: true });
  const archivo = path.join(dir, `dopta_${ahora().replace(/[: ]/g, '-')}.sql`);
  const c = cfg();
  return new Promise((ok, mal) => {
    const p = spawn(process.env.MYSQLDUMP || 'mysqldump', [
      `-h${c.host}`, `-P${c.port}`, `-u${c.user}`, '--single-transaction', '--routines', '--default-character-set=utf8mb4',
      ...(c.ssl ? ['--ssl'] : []), require('./db').nombreBase()], { env: { ...process.env, MYSQL_PWD: c.password } });
    const out = fs.createWriteStream(archivo);
    p.stdout.pipe(out);
    p.stderr.on('data', (d) => process.stderr.write(d));
    p.on('error', mal);
    p.on('close', (code) => {
      if (code !== 0) return mal(new Error(`mysqldump terminó con código ${code}`));
      const viejos = fs.readdirSync(dir).filter((f) => /^dopta_.*\.sql$/.test(f)).sort().reverse()
        .slice(Number(process.env.RESPALDO_DIAS || 30));
      viejos.forEach((f) => fs.unlinkSync(path.join(dir, f)));
      console.log(`Respaldo creado: ${archivo}`);
      ok();
    });
  });
}

/* Zip de entrega con lista blanca: solo entra lo necesario para instalar el proyecto.
   Nunca incluye .env (contraseñas), node_modules, uploads (fotos de usuarios), respaldos ni la versión antigua. */
const ENTREGA = ['public', 'server', 'database', 'package.json', 'package-lock.json', '.env.example', '.gitignore', 'README.md', 'iniciar.bat', 'iniciar.sh', 'server.js', 'vercel.json', 'DEPLOY.md'];
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
      console.log('No incluye: .env, node_modules, uploads, respaldos ni los HTML/CSS/JS antiguos de la raíz.');
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
  const cfgBD = require('./db').config();
  bien(`Configuración (servidor MySQL: ${cfgBD.host}:${cfgBD.port}, usuario: ${cfgBD.user}, base: ${cfgBD.database}${cfgBD.ssl ? ', con TLS' : ''})`);
  const problema = await arranque.prepararBD();
  if (problema) mal(problema); else bien('MySQL conectado, tablas y migraciones al día');
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
tareas[cmd]().then(() => process.exit(process.exitCode || 0)).catch((e) => { console.error(e.message); process.exit(1); });
