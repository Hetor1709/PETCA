/* Catálogo público y gestión de publicaciones del Refugio (RF-11 a RF-15, RF-35, RNF-01, RNF-02). */
const express = require('express');
const { q, uno, tx } = require('./db');
const {
  h, V, falla, limpiar, ahora, hoy, esFecha, periodo, notificar, RAZAS_LISTA, OPCIONES_ANIMAL, CAMPOS_ANIMAL, FECHA_MIN, tamanoDeRaza, nacimientoMinimo,
  CP_ALCALDIA, sinAcentos, DIMS_TAMANO, Filtro, tieneLetras, mesesDeEdad, sumarDias,
} = require('./util');
const { solicitarCambioRefugio } = require('./cambios');
const { requiere } = require('./seguridad');
const { validarRefugio } = require('./auth');

const r = express.Router();
const POR_PAGINA = 24;


const normalizar = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* Centro aproximado de cada alcaldía (para la distancia de refugios sin coordenadas exactas) */
const CENTRO_ALCALDIA = {
  'alvaro obregon': [19.3587, -99.2033], azcapotzalco: [19.4869, -99.1844], 'benito juarez': [19.3727, -99.1565],
  coyoacan: [19.3467, -99.1617], 'cuajimalpa de morelos': [19.3569, -99.2990], cuauhtemoc: [19.4326, -99.1490],
  'gustavo a. madero': [19.4825, -99.1131], iztacalco: [19.3953, -99.0977], iztapalapa: [19.3550, -99.0622],
  'la magdalena contreras': [19.3044, -99.2408], 'miguel hidalgo': [19.4280, -99.2050], 'milpa alta': [19.1925, -99.0230],
  tlahuac: [19.2869, -99.0040], tlalpan: [19.2900, -99.1700], 'venustiano carranza': [19.4300, -99.1000], xochimilco: [19.2570, -99.1030],
};

/* ---------- Catálogos para las listas de selección ---------- */
async function catalogos() {
  const filas = await q('SELECT id, catalogo, nombre, orden, activo FROM catalogo_valores ORDER BY catalogo, orden, id');
  const res = { tamano: [], edad: [], tipo_requisito: [], alcaldia: [], vacuna: [], documento: [] };
  filas.forEach((f) => res[f.catalogo].push({ id: f.id, nombre: f.nombre, orden: f.orden, activo: !!f.activo }));
  // Prefijo de C.P. de cada alcaldía: el formulario la elige sola al escribir el código postal
  const prefijo = Object.fromEntries(Object.entries(CP_ALCALDIA).map(([k, v]) => [sinAcentos(v), k]));
  res.alcaldia.forEach((a) => { a.cp = prefijo[sinAcentos(a.nombre)] || null; });
  return res;
}
// Dimensiones adultas típicas: el formulario sugiere peso y altura según la raza (o el tamaño en mestizos)
const DIMS = { razas: Object.fromEntries(RAZAS_LISTA.map((x) => [x.id, { nombre: x.nombre, peso: x.peso, altura: x.altura }])), tamano: DIMS_TAMANO };
r.get('/catalogos', h(async (req, res) => res.json({ ...(await catalogos()), animal: OPCIONES_ANIMAL, dims: DIMS })));

/* ---------- Catálogo público (RNF-01) ---------- */
const SELECT_TARJETA = `
  SELECT a.id, a.nombre, a.raza, a.raza_aprox, a.estado, e.nombre AS edad, t.nombre AS tamano,
         a.temperamento, a.temp_general, a.temp_perros, a.esterilizado, u.nombre AS refugio, a.refugio_id, al.nombre AS alcaldia
    FROM animales a
    JOIN usuarios u ON u.id = a.refugio_id
    JOIN refugios rf ON rf.usuario_id = a.refugio_id
    JOIN catalogo_valores e ON e.id = a.edad_id
    JOIN catalogo_valores t ON t.id = a.tamano_id
    LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id`;

r.get('/animales', h(async (req, res) => {
  const pagina = V.pagina(req.query.pagina);
  const where = ["a.eliminado = 0", "a.estado = 'disponible'", "u.estado = 'activa'"];
  const params = [];
  const texto = limpiar(req.query.q).slice(0, 60);
  if (texto) {
    const n = normalizar(texto);
    const razas = RAZAS_LISTA.filter((x) => normalizar(x.nombre).includes(n)).map((x) => x.id);
    if ('mestizo'.includes(n)) razas.push('mestizo');
    const cond = ['sin_acentos(a.nombre) LIKE ?', 'sin_acentos(u.nombre) LIKE ?'];
    const patron = `%${n.replace(/[%_\\]/g, '\\$&')}%`;
    params.push(patron, patron);
    if (razas.length) {
      cond.push(`a.raza IN (${razas.map(() => '?').join(',')})`, `a.raza_aprox IN (${razas.map(() => '?').join(',')})`);
      params.push(...razas, ...razas);
    }
    where.push(`(${cond.join(' OR ')})`);
  }
  // ---- Filtros de búsqueda ----
  const f = req.query;
  if (f.tamano) { where.push('a.tamano_id = ?'); params.push(V.id(f.tamano)); }
  if (f.raza) { where.push('(a.raza = ? OR a.raza_aprox = ?)'); params.push(limpiar(f.raza), limpiar(f.raza)); }
  if (f.alcaldia) { where.push('rf.alcaldia_id = ?'); params.push(V.id(f.alcaldia)); }
  if (f.refugio) { where.push('a.refugio_id = ?'); params.push(V.id(f.refugio)); }
  if (GRUPOS_EDAD[f.edad]) {
    const ids = (await catalogos()).edad.filter((e) => { const m = mesesDeEdad(e.nombre); return m != null && GRUPOS_EDAD[f.edad](m); }).map((e) => e.id);
    where.push(ids.length ? `a.edad_id IN (${ids.map(() => '?').join(',')})` : 'FALSE');
    params.push(...ids);
  }
  if (f.esterilizado === '1') where.push('a.esterilizado = 1');
  if (f.vacunado === '1') where.push('EXISTS (SELECT 1 FROM vacunas v WHERE v.animal_id = a.id)');
  if (f.perros === '1') where.push("a.temp_perros = 'sociable'");
  if (f.desconocidos === '1') where.push("a.temp_desconocidos = 'amigable'");
  if (f.sin_tratamiento === '1') where.push("a.tratamiento = 'no'");
  if (f.energia && OPCIONES_ANIMAL.temp_general.opciones[f.energia]) { where.push('a.temp_general = ?'); params.push(f.energia); }
  const ORDEN = {
    recientes: 'a.publicado_en DESC, a.id DESC',
    esperando: 'a.fecha_ingreso ASC, a.id', // más tiempo en el refugio primero
    nombre: 'a.nombre ASC, a.id',
  };
  const orden = ORDEN[f.orden] || ORDEN.recientes;

  const total = await uno(`SELECT COUNT(*) AS n FROM animales a JOIN usuarios u ON u.id = a.refugio_id JOIN refugios rf ON rf.usuario_id = a.refugio_id WHERE ${where.join(' AND ')}`, params);
  const lista = await q(
    `${SELECT_TARJETA} WHERE ${where.join(' AND ')} ORDER BY ${orden} LIMIT ${POR_PAGINA} OFFSET ${(pagina - 1) * POR_PAGINA}`, params);
  res.json({ total: Number(total.n), pagina, porPagina: POR_PAGINA, animales: lista });
}));

/* Grupos de edad del filtro (meses) */
const GRUPOS_EDAD = { cachorro: (m) => m < 12, joven: (m) => m >= 12 && m < 36, adulto: (m) => m >= 36 && m < 96, senior: (m) => m >= 96 };

async function horario(refugioId, conn) {
  return q('SELECT dia, cerrado, abre, cierra FROM refugio_horarios WHERE refugio_id = ? ORDER BY dia', [refugioId], conn);
}

/* ---------- Refugios públicos: búsqueda y perfil (sin correos, RNF-03) ---------- */
const SELECT_REFUGIO = `
  SELECT u.id, u.nombre, rf.institucion, al.nombre AS alcaldia, rf.lat, rf.lng,
         (SELECT COUNT(*) FROM animales a WHERE a.refugio_id = u.id AND a.eliminado = 0 AND a.estado = 'disponible') AS disponibles,
         (SELECT COUNT(*) FROM animales a WHERE a.refugio_id = u.id AND a.eliminado = 0 AND a.estado = 'adoptado') AS adoptados
    FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id
   WHERE u.tipo = 'refugio' AND u.estado = 'activa'`;

r.get('/refugios', h(async (req, res) => {
  const texto = limpiar(req.query.q).slice(0, 60);
  const params = [];
  let filtro = '';
  if (texto) {
    const t = `%${normalizar(texto).replace(/[%_\\]/g, '\\$&')}%`;
    filtro = ' AND (sin_acentos(u.nombre) LIKE ? OR sin_acentos(rf.institucion) LIKE ? OR sin_acentos(al.nombre) LIKE ?)';
    params.push(t, t, t);
  }
  const lista = await q(`${SELECT_REFUGIO}${filtro} ORDER BY disponibles DESC, u.nombre LIMIT 60`, params);
  // Para ordenar por cercanía: coordenadas exactas o, si el refugio no las tiene, el centro aproximado de su alcaldía
  res.json(lista.map((x) => {
    const c = x.lat == null && x.alcaldia ? CENTRO_ALCALDIA[sinAcentos(x.alcaldia)] : null;
    return {
      ...x, disponibles: Number(x.disponibles), adoptados: Number(x.adoptados),
      lat: c ? c[0] : x.lat == null ? null : Number(x.lat), lng: c ? c[1] : x.lng == null ? null : Number(x.lng), aprox: !!c,
    };
  }));
}));

r.get('/refugios/:id', h(async (req, res) => {
  const id = V.id(req.params.id);
  const p = await uno(
    `SELECT u.id, u.nombre, LEFT(u.verificado_en, 10) AS verificado, rf.institucion, rf.direccion, rf.telefono, rf.lat, rf.lng, rf.place_id,
            al.nombre AS alcaldia
       FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id
      WHERE u.id = ? AND u.tipo = 'refugio' AND u.estado = 'activa'`, [id]);
  if (!p) falla('El refugio no existe o ya no está activo.', 404);
  p.horario = await horario(id);
  p.animales = await q(`${SELECT_TARJETA} WHERE a.refugio_id = ? AND a.eliminado = 0 AND a.estado = 'disponible' ORDER BY a.publicado_en DESC`, [id]);
  const ado = await uno("SELECT COUNT(*) AS n FROM animales WHERE refugio_id = ? AND eliminado = 0 AND estado = 'adoptado'", [id]);
  p.adoptados = Number(ado.n);
  res.json(p);
}));

/* Ficha de detalle del animal (RNF-01): sin correos de nadie (RNF-03) */
r.get('/animales/:id', h(async (req, res) => {
  const id = V.id(req.params.id);
  const a = await uno(
    `SELECT a.id, a.refugio_id, a.nombre, a.raza, a.raza_aprox, a.estado, a.eliminado, a.salud, a.temperamento,
            a.salud_general, a.tratamiento, a.temp_general, a.temp_perros, a.temp_desconocidos, a.temp_comida,
            a.fecha_ingreso, a.esterilizado, a.fecha_esterilizacion, a.publicado_en, a.adoptado_en, a.peso_kg, a.altura_cm,
            e.nombre AS edad, t.nombre AS tamano, u.nombre AS refugio, u.estado AS refugio_estado,
            rf.institucion, rf.direccion, rf.telefono, rf.lat, rf.lng, rf.place_id, al.nombre AS alcaldia
       FROM animales a
       JOIN usuarios u ON u.id = a.refugio_id
       JOIN refugios rf ON rf.usuario_id = a.refugio_id
       JOIN catalogo_valores e ON e.id = a.edad_id
       JOIN catalogo_valores t ON t.id = a.tamano_id
       LEFT JOIN catalogo_valores al ON al.id = rf.alcaldia_id
      WHERE a.id = ?`, [id]);
  // Un animal adoptado se muestra como historial (estado Adoptado); uno eliminado ya no existe para el público
  if (!a || a.eliminado || a.refugio_estado !== 'activa') falla('La publicación ya no existe.', 404);
  delete a.eliminado; delete a.refugio_estado;
  a.requisitos = await q(
    `SELECT r.nombre, c.nombre AS tipo FROM requisitos r JOIN catalogo_valores c ON c.id = r.tipo_id WHERE r.animal_id = ? ORDER BY r.id`, [id]);
  a.vacunas = await q('SELECT nombre, fecha FROM vacunas WHERE animal_id = ? ORDER BY fecha', [id]);
  a.horario = await horario(a.refugio_id);
  const adopta = req.usuario && (req.usuario.tipo === 'adoptante' || (req.usuario.tipo === 'refugio' && req.usuario.id !== a.refugio_id));
  if (adopta) {
    a.miSolicitud = await uno(
      "SELECT id, estado FROM solicitudes WHERE animal_id = ? AND adoptante_id = ? AND estado IN ('pendiente','aprobada')", [id, req.usuario.id]);
  }
  // Adoptan las personas y también los refugios (no de su propio refugio); los administradores solo administran
  a.puedeSolicitar = !req.usuario || !!adopta;
  a.esMio = !!(req.usuario && req.usuario.id === a.refugio_id);
  res.json(a);
}));

/* ====================== Refugio ====================== */
const soloRefugio = requiere('refugio');

/* Valida todos los campos de RF-12. "actual" permite conservar valores de catálogo ya desactivados (RF-31). */
async function validarAnimal(d, actual = {}, refugioId = null, animalId = null) {
  const cat = await catalogos();
  const usable = (lista, id, actualId) => lista.some((x) => x.id === id && (x.activo || x.id === actualId));
  const t = hoy();
  const fechaPasada = (f) => { if (!esFecha(f) || f > t) falla('La fecha debe ser igual o anterior a la fecha de hoy.'); return f; };

  const nombre = V.nombrePerro(d.nombre);
  const raza = V.raza(d.raza);
  const razaAprox = raza === 'mestizo' ? V.razaAprox(d.raza_aprox) : null;
  const edadId = Number(d.edad_id);
  if (!usable(cat.edad, edadId, actual.edad_id)) falla('Seleccione la edad del animal.');
  // Raza pura: el tamaño se asigna solo según la raza. Mestizo: lo elige el refugio.
  const tamanoId = tamanoDeRaza(raza, cat.tamano) || Number(d.tamano_id);
  if (!usable(cat.tamano, tamanoId, actual.tamano_id)) falla('Seleccione el tamaño del animal.');
  // Salud y temperamento: solo se aceptan las opciones cerradas definidas en util.js
  const cerrados = {};
  for (const c of CAMPOS_ANIMAL) {
    const v = typeof d[c] === 'string' ? d[c] : '';
    if (!Object.prototype.hasOwnProperty.call(OPCIONES_ANIMAL[c].opciones, v)) falla(`Seleccione una opción en “${OPCIONES_ANIMAL[c].titulo}”.`);
    cerrados[c] = v;
  }
  const fechaIngreso = fechaPasada(d.fecha_ingreso);
  const dims = V.dimensiones(d, raza, (cat.tamano.find((x) => x.id === tamanoId) || {}).nombre, (cat.edad.find((x) => x.id === edadId) || {}).nombre);

  // Coherencia de fechas: ninguna antes del año 2000 ni antes del nacimiento estimado por la edad
  const edadNombre = (cat.edad.find((x) => x.id === edadId) || {}).nombre;
  const nacimiento = nacimientoMinimo(edadNombre, t);
  const coherente = (f, que) => {
    if (f < FECHA_MIN) falla(`La fecha de ${que} no puede ser anterior al año 2000.`);
    if (nacimiento && f < nacimiento) falla(`La fecha de ${que} (${f}) es anterior al nacimiento estimado por su edad (${edadNombre}). Revise la fecha o la edad.`);
  };
  coherente(fechaIngreso, 'ingreso');

  const reqs = Array.isArray(d.requisitos) ? d.requisitos : [];
  const vacs = Array.isArray(d.vacunas) ? d.vacunas : [];
  if (reqs.length > 10 || vacs.length > 10) falla('Solo se permiten hasta 10 requisitos o hasta 10 vacunas.');
  /* Requisitos: documentos de la lista cerrada (catálogo "documento") y hasta 3 "Otro" escritos por el refugio */
  const tiposActuales = actual.tipos || [];
  const docsPermitidos = new Set([...cat.documento.filter((x) => x.activo).map((x) => x.nombre), ...(actual.documentos || [])]);
  const tipoDoc = (cat.tipo_requisito.find((x) => sinAcentos(x.nombre) === 'documental') || {}).id;
  let otros = 0;
  const requisitos = reqs.map((x) => {
    const n = limpiar(x && x.nombre).replace(/\s+/g, ' ');
    if (!(x && x.otro)) {
      if (!docsPermitidos.has(n)) falla('Seleccione los documentos de la lista o use "Otro requisito".');
      return { nombre: n, tipo_id: tipoDoc, otro: 0 };
    }
    otros += 1;
    if (otros > 3) falla('Puede agregar hasta 3 requisitos en "Otro".');
    const tipo = Number(x.tipo_id);
    if ([...n].length < 3 || [...n].length > 100 || !tieneLetras(n, 3) || !usable(cat.tipo_requisito, tipo, tiposActuales.includes(tipo) ? tipo : -1)) {
      falla('Cada requisito "Otro" debe tener de 3 a 100 caracteres, con letras, y un tipo Texto o Documental.');
    }
    if (Filtro.groseria(n)) falla('Un requisito contiene palabras no permitidas.');
    if (Filtro.sinSentido(n)) falla(`El requisito "${n}" parece no tener sentido. Escríbelo con palabras reales.`);
    return { nombre: n, tipo_id: tipo, otro: 1 };
  });
  const nombresReq = requisitos.map((x) => x.nombre.toLowerCase());
  if (new Set(nombresReq).size !== nombresReq.length) falla('Hay requisitos repetidos. Cada requisito debe aparecer una sola vez.');
  // Vacunas: solo valores del catálogo (o las que ya tenía la publicación aunque se hayan desactivado)
  const permitidas = new Set([...cat.vacuna.filter((x) => x.activo).map((x) => x.nombre), ...(actual.vacunas || [])]);
  const vistas = new Set();
  const vacunas = vacs.map((x) => {
    const n = limpiar(x && x.nombre);
    if (!permitidas.has(n)) falla('Seleccione las vacunas de la lista.');
    if (!x.fecha) falla('Cada vacuna seleccionada necesita su fecha de aplicación.');
    if (vistas.has(n)) falla('Cada vacuna solo puede registrarse una vez.');
    vistas.add(n);
    const f = fechaPasada(x.fecha);
    coherente(f, `la vacuna ${n}`);
    return { nombre: n, fecha: f };
  });
  const esterilizado = d.esterilizado === true || d.esterilizado === 'si' ? 1 : 0;
  const desparasitado = d.desparasitado === true || d.desparasitado === 'si' ? 1 : 0;
  let fechaEst = null;
  if (esterilizado) {
    if (!d.fecha_esterilizacion) falla('Ingrese la fecha de esterilización.');
    fechaEst = fechaPasada(d.fecha_esterilizacion);
    coherente(fechaEst, 'esterilización');
  }
  // El mismo refugio no puede tener dos perros disponibles con el mismo nombre y raza (evita publicaciones duplicadas)
  if (refugioId) {
    const dup = await uno(
      `SELECT id FROM animales WHERE refugio_id = ? AND eliminado = 0 AND estado = 'disponible'
          AND LOWER(nombre) = LOWER(?) AND raza = ? AND id <> ?`, [refugioId, nombre, raza, animalId || 0]);
    if (dup) falla(`Ya tienes publicado a un perro disponible llamado ${nombre} con la misma raza. Edita esa publicación en lugar de crear otra.`, 409);
  }
  return {
    nombre, raza, razaAprox, edadId, tamanoId, cerrados, fechaIngreso, requisitos, vacunas, esterilizado, fechaEst, desparasitado, dims,
  };
}

const leerDatos = (req) => (req.body && typeof req.body === 'object' ? req.body : falla('Solicitud inválida.'));

async function guardarDetalle(c, id, v) {
  await q('DELETE FROM requisitos WHERE animal_id = ?', [id], c);
  await q('DELETE FROM vacunas WHERE animal_id = ?', [id], c);
  for (const x of v.requisitos) await q('INSERT INTO requisitos (animal_id, nombre, tipo_id, otro) VALUES (?, ?, ?, ?)', [id, x.nombre, x.tipo_id, x.otro], c);
  for (const x of v.vacunas) await q('INSERT INTO vacunas (animal_id, nombre, fecha) VALUES (?, ?, ?)', [id, x.nombre, x.fecha], c);
}

async function propio(req, id, conn, bloquear = false) {
  const a = await uno(`SELECT * FROM animales WHERE id = ? AND eliminado = 0${bloquear ? ' FOR UPDATE' : ''}`, [id], conn);
  if (!a) falla('La publicación no existe.', 404);
  if (a.refugio_id !== req.usuario.id) falla('No tiene permiso para editar la publicación.', 403);
  return a;
}

r.get('/refugio/animales', soloRefugio, h(async (req, res) => {
  const lista = await q(
    `${SELECT_TARJETA.replace('a.temperamento,', "a.temperamento, a.publicado_en, a.adoptado_en, (SELECT COUNT(*) FROM solicitudes s WHERE s.animal_id = a.id AND s.estado IN ('pendiente','aprobada')) AS activas,")}
     WHERE a.refugio_id = ? AND a.eliminado = 0 ORDER BY a.estado = 'adoptado', a.publicado_en DESC`, [req.usuario.id]);
  res.json(lista);
}));

r.get('/refugio/animales/:id', soloRefugio, h(async (req, res) => {
  const a = await propio(req, V.id(req.params.id));
  if (req.query.editar === '1' && a.estado === 'adoptado') falla('Una publicación adoptada no es editable.', 409);
  a.requisitos = await q('SELECT nombre, tipo_id, otro FROM requisitos WHERE animal_id = ? ORDER BY id', [a.id]);
  a.vacunas = await q('SELECT nombre, fecha FROM vacunas WHERE animal_id = ? ORDER BY id', [a.id]);
  res.json(a);
}));

/* RF-12: publicar */
r.post('/refugio/animales', soloRefugio, h(async (req, res) => {
  const v = await validarAnimal(leerDatos(req), {}, req.usuario.id);
  const t = ahora();
  const id = await tx(async (c) => {
      const ins = await q(
        `INSERT INTO animales (refugio_id, nombre, raza, raza_aprox, edad_id, tamano_id,
                               salud_general, tratamiento, temp_general, temp_perros, temp_desconocidos, temp_comida, fecha_ingreso,
                               esterilizado, fecha_esterilizacion, desparasitado, peso_kg, altura_cm, publicado_en, actualizado_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        [req.usuario.id, v.nombre, v.raza, v.razaAprox, v.edadId, v.tamanoId, ...CAMPOS_ANIMAL.map((c) => v.cerrados[c]), v.fechaIngreso,
          v.esterilizado, v.fechaEst, v.desparasitado, v.dims.peso, v.dims.altura, t, t], c);
      await guardarDetalle(c, ins.insertId, v);
      return ins.insertId;
  });
  res.status(201).json({ id, mensaje: 'Publicación creada con estado Disponible.' });
}));

/* RF-13: editar */
r.put('/refugio/animales/:id', soloRefugio, h(async (req, res) => {
  const id = V.id(req.params.id);
  const actual = await propio(req, id);
  if (actual.estado === 'adoptado') falla('Una publicación adoptada no es editable.', 409);
  const reqActuales = await q('SELECT nombre, tipo_id, otro FROM requisitos WHERE animal_id = ?', [id]);
  const tipos = reqActuales.map((x) => x.tipo_id);
  const documentos = reqActuales.filter((x) => !x.otro).map((x) => x.nombre); // documentos ya elegidos aunque se hayan desactivado
  const vacunasActuales = (await q('SELECT nombre FROM vacunas WHERE animal_id = ?', [id])).map((x) => x.nombre);
  const datos = leerDatos(req);
  const v = await validarAnimal(datos, { edad_id: actual.edad_id, tamano_id: actual.tamano_id, tipos, documentos, vacunas: vacunasActuales }, req.usuario.id, id);
  // Cambios de fondo (identidad del perro): si hay solicitudes activas, esas personas pidieron OTRO perro.
  // Se avisa al refugio; si confirma, las solicitudes se cancelan y cada adoptante recibe una notificación.
  const fuertes = [['nombre', v.nombre, 'nombre'], ['raza', v.raza, 'raza'], ['raza_aprox', v.razaAprox, 'raza parecida'],
    ['edad_id', v.edadId, 'edad'], ['tamano_id', v.tamanoId, 'tamaño']].filter(([k, nuevo]) => String(actual[k] ?? '') !== String(nuevo ?? ''));
  const reiniciadas = await tx(async (c) => {
      const a = await propio(req, id, c, true);
      if (a.estado === 'adoptado') falla('Una publicación adoptada no es editable.', 409);
      const activas = fuertes.length ? await q(
        "SELECT id, adoptante_id FROM solicitudes WHERE animal_id = ? AND estado IN ('pendiente','aprobada') AND concretada_en IS NULL FOR UPDATE", [id], c) : [];
      if (activas.length && datos.confirmar_reinicio !== true) {
        falla(`Cambiaste ${fuertes.map((x) => x[2]).join(', ')} y ${a.nombre} tiene ${activas.length} solicitud(es) activa(s). Si guardas, esas solicitudes se cancelarán y se avisará a cada adoptante.`,
          409, { codigo: 'REINICIO', solicitudes: activas.length, campos: fuertes.map((x) => x[2]) });
      }
      await q(
        `UPDATE animales SET nombre = ?, raza = ?, raza_aprox = ?, edad_id = ?, tamano_id = ?,
                salud_general = ?, tratamiento = ?, temp_general = ?, temp_perros = ?, temp_desconocidos = ?, temp_comida = ?,
                fecha_ingreso = ?, esterilizado = ?, fecha_esterilizacion = ?, desparasitado = ?, peso_kg = ?, altura_cm = ?, actualizado_en = ? WHERE id = ?`,
        [v.nombre, v.raza, v.razaAprox, v.edadId, v.tamanoId, ...CAMPOS_ANIMAL.map((c) => v.cerrados[c]), v.fechaIngreso, v.esterilizado, v.fechaEst,
          v.desparasitado, v.dims.peso, v.dims.altura, ahora(), id], c);
      await guardarDetalle(c, id, v);
      for (const s of activas) {
        await q("UPDATE solicitudes SET estado = 'cancelada', motivo_rechazo = ?, rechazada_en = ? WHERE id = ?",
          [`El refugio cambió datos importantes de la publicación (${fuertes.map((x) => x[2]).join(', ')}).`, ahora(), s.id], c);
        await q('DELETE FROM citas WHERE solicitud_id = ?', [s.id], c);
        await notificar(s.adoptante_id, `Tu solicitud para ${a.nombre} se canceló porque el refugio cambió datos importantes del perro (${fuertes.map((x) => x[2]).join(', ')}). Revisa la ficha y, si te sigue interesando, vuelve a solicitar.`, c, `#/animal/${id}`);
      }
      return activas.length;
  });
  res.json({ mensaje: reiniciadas ? `Cambios guardados. Se cancelaron ${reiniciadas} solicitud(es) y se avisó a cada adoptante.` : 'Cambios guardados.' });
}));

/* RF-14: eliminar (se conserva el registro para estadísticas) */
r.delete('/refugio/animales/:id', soloRefugio, h(async (req, res) => {
  const id = V.id(req.params.id);
  await tx(async (c) => {
    await propio(req, id, c, true);
    const n = await uno("SELECT COUNT(*) AS n FROM solicitudes WHERE animal_id = ? AND estado IN ('pendiente','aprobada')", [id], c);
    if (Number(n.n) > 0) falla('La publicación tiene solicitudes activas. Rechácelas antes de eliminarla.', 409);
    await q("UPDATE animales SET eliminado = 1, eliminado_por = 'refugio', eliminado_en = ? WHERE id = ?", [ahora(), id], c);
  });
  res.json({ mensaje: 'Publicación eliminada.' });
}));

/* RF-23: rechaza las solicitudes activas de un animal adoptado y avisa a cada adoptante.
   Cierra las pendientes y también cualquier otra aprobada que no sea la que concretó la adopción. */
async function cerrarPendientes(c, animal) {
  const pend = await q(
    `SELECT id, adoptante_id FROM solicitudes
      WHERE animal_id = ? AND (estado = 'pendiente' OR (estado = 'aprobada' AND concretada_en IS NULL)) FOR UPDATE`, [animal.id], c);
  const t = ahora();
  for (const s of pend) {
    await q("UPDATE solicitudes SET estado = 'rechazada', motivo_rechazo = 'El animal ya fue adoptado', rechazada_en = ? WHERE id = ?", [t, s.id], c);
    await q('DELETE FROM citas WHERE solicitud_id = ?', [s.id], c);
    await notificar(s.adoptante_id, `Su solicitud para ${animal.nombre} fue rechazada: el animal ya fue adoptado.`, c, `#/solicitudes?id=${s.id}`);
  }
  return pend.length;
}

/* Lista de entrega (protocolo CDMX, Ley de Protección y Bienestar de los Animales, art. 32):
   el perro se entrega esterilizado (o con compromiso si es cachorro), desparasitado y con su cartilla de vacunación;
   el adoptante firma la carta compromiso y el perro se registra en el RUAC (Registro Único de Animales de Compañía). */
function validarEntrega(e, animal) {
  const d = e && typeof e === 'object' ? e : {};
  const si = (k) => d[k] === true;
  if (!si('carta_firmada')) falla('Para entregar al perro, el adoptante debe firmar la carta compromiso de adopción.');
  if (!si('desparasitado')) falla('El perro debe entregarse desparasitado.');
  if (!si('cartilla')) falla('Entrega la cartilla de vacunación (o el registro de vacunas) al adoptante.');
  const meses = mesesDeEdad(animal.edad);
  const esterilizado = Number(animal.esterilizado) === 1 || si('esterilizado');
  let compromiso = null;
  if (!esterilizado) {
    if (meses == null || meses >= 6) falla('El perro debe entregarse esterilizado (Ley de Protección a los Animales de la CDMX, art. 32).');
    if (!esFecha(d.esterilizar_antes) || d.esterilizar_antes <= hoy() || d.esterilizar_antes > sumarDias(hoy(), 240)) {
      falla('Cachorro sin esterilizar: indique la fecha comprometida para esterilizarlo (en los próximos 8 meses).');
    }
    compromiso = d.esterilizar_antes;
  }
  const ruac = limpiar(d.ruac).toUpperCase().slice(0, 30);
  if (ruac && !/^[A-Z0-9-]{4,30}$/.test(ruac)) falla('El folio del RUAC solo puede tener letras, números y guiones.');
  return { carta_firmada: true, desparasitado: true, cartilla: true, esterilizado, esterilizar_antes: compromiso, ruac: ruac || null };
}

/* RF-22: concreta la adopción a partir de la solicitud aprobada. Lo usan RF-22 y RF-15 (mismo flujo). */
async function marcarAdopcion(c, s, fecha, entrega) {
  if (s.estado !== 'aprobada' || s.concretada_en) falla('No hay una solicitud aprobada para el animal.', 409);
  if (s.animal_estado === 'adoptado' || s.eliminado) falla('El animal ya no está disponible para adopción.', 409);
  if (!s.visita) falla('Antes de entregar, registra la visita domiciliaria (realizada o no requerida) en la solicitud.', 409);
  if (!esFecha(fecha) || fecha > hoy() || fecha < String(s.aprobada_en).slice(0, 10)) {
    falla('La fecha de concreción debe estar entre la fecha de aprobación y hoy.');
  }
  const animal = await uno('SELECT a.esterilizado, e.nombre AS edad FROM animales a JOIN catalogo_valores e ON e.id = a.edad_id WHERE a.id = ?', [s.animal_id], c);
  const lista = validarEntrega(entrega, animal);
  await q("UPDATE animales SET estado = 'adoptado', adoptado_en = ?, actualizado_en = ?, esterilizado = ?, desparasitado = 1 WHERE id = ?",
    [fecha, ahora(), lista.esterilizado ? 1 : 0, s.animal_id], c);
  await q('UPDATE solicitudes SET concretada_en = ?, entrega = ? WHERE id = ?', [fecha, JSON.stringify(lista), s.id], c);
  // Seguimiento posterior: 1 semana, 1 mes y 3 meses después de la entrega
  for (const [etapa, dias] of [['1_semana', 7], ['1_mes', 30], ['3_meses', 90]]) {
    await q('INSERT INTO seguimientos (solicitud_id, etapa, programado) VALUES (?, ?, ?) ON CONFLICT (solicitud_id, etapa) DO NOTHING', [s.id, etapa, sumarDias(fecha, dias)], c);
  }
  await notificar(s.adoptante_id, `¡Felicidades! La adopción de ${s.animal} quedó concretada el ${fecha}. El refugio te contactará para el seguimiento.`, c, `#/solicitudes?id=${s.id}`);
  return cerrarPendientes(c, { id: s.animal_id, nombre: s.animal });
}

/* RF-15: cambiar estado Disponible / Adoptado */
r.post('/refugio/animales/:id/estado', soloRefugio, h(async (req, res) => {
  const id = V.id(req.params.id);
  const estado = req.body && req.body.estado;
  if (!['disponible', 'adoptado'].includes(estado)) falla('Seleccione un estado válido.');
  const cerradas = await tx(async (c) => {
    const a = await propio(req, id, c, true);
    if (a.estado === estado) falla('La publicación ya tiene el estado seleccionado.', 409);
    if (estado === 'adoptado') {
      // Mismo flujo que RF-22: exige la solicitud aprobada y la fecha de concreción
      const s = await uno(
        `SELECT s.*, ?::text AS animal, ?::text AS animal_estado, 0 AS eliminado FROM solicitudes s
          WHERE s.animal_id = ? AND s.estado = 'aprobada' AND s.concretada_en IS NULL FOR UPDATE`, [a.nombre, a.estado, id], c);
      if (!s) falla('No hay una solicitud aprobada para el animal.', 409);
      return marcarAdopcion(c, s, req.body.fecha, req.body.entrega);
    }
    // Volver a Disponible: la adopción se revierte y la solicitud vuelve a quedar aprobada sin concretar
    await q("UPDATE animales SET estado = 'disponible', adoptado_en = NULL, actualizado_en = ? WHERE id = ?", [ahora(), id], c);
    const conc = await q('SELECT id, adoptante_id FROM solicitudes WHERE animal_id = ? AND concretada_en IS NOT NULL', [id], c);
    for (const s of conc) {
      await q('UPDATE solicitudes SET concretada_en = NULL WHERE id = ?', [s.id], c);
      await q('DELETE FROM seguimientos WHERE solicitud_id = ? AND realizado_en IS NULL', [s.id], c);
      await notificar(s.adoptante_id, `La adopción de ${a.nombre} se revirtió; el refugio se pondrá en contacto contigo.`, c, `#/solicitudes?id=${s.id}`);
    }
    return 0;
  });
  res.json({ mensaje: estado === 'adoptado' ? `Estado actualizado a Adoptado. Solicitudes pendientes cerradas: ${cerradas}.` : 'Estado actualizado a Disponible.' });
}));

/* ---------- RF-11: perfil del Refugio ---------- */
r.get('/refugio/perfil', soloRefugio, h(async (req, res) => {
  const p = await uno(
    `SELECT u.nombre, u.correo, rf.institucion, rf.direccion, rf.calle, rf.num_ext, rf.num_int, rf.colonia, rf.cp,
            rf.telefono, rf.alcaldia_id, rf.lat, rf.lng, rf.place_id
       FROM usuarios u JOIN refugios rf ON rf.usuario_id = u.id WHERE u.id = ?`, [req.usuario.id]);
  p.horario = await horario(req.usuario.id);
  // Cambio esperando aprobación del Administrador (se muestra al refugio)
  p.cambio_pendiente = await uno("SELECT id, datos, LEFT(creado_en, 16) AS creado_en FROM refugio_cambios WHERE refugio_id = ? AND estado = 'pendiente'", [req.usuario.id]);
  p.ultimo_rechazo = await uno("SELECT motivo, LEFT(revisado_en, 16) AS revisado_en FROM refugio_cambios WHERE refugio_id = ? AND estado = 'rechazado' ORDER BY id DESC LIMIT 1", [req.usuario.id]);
  res.json(p);
}));

/* Institución, dirección, teléfono y horario: el cambio queda pendiente hasta que el Administrador lo aprueba */
r.put('/refugio/perfil', soloRefugio, h(async (req, res) => {
  const b = req.body || {};
  const actual = await uno('SELECT institucion FROM refugios WHERE usuario_id = ?', [req.usuario.id]);
  const d = await validarRefugio({ ...b, institucion: b.institucion === undefined ? actual.institucion : b.institucion }, req.usuario.id);
  res.json(await solicitarCambioRefugio(req.usuario, d));
}));

/* ---------- RF-35: estadísticas propias ---------- */
r.get('/refugio/estadisticas', soloRefugio, h(async (req, res) => {
  const p = periodo(req.query);
  const ing = await uno('SELECT COUNT(*) AS n FROM animales WHERE refugio_id = ? AND fecha_ingreso BETWEEN ? AND ?', [req.usuario.id, p.inicio, p.fin]);
  const ado = await uno("SELECT COUNT(*) AS n FROM animales WHERE refugio_id = ? AND estado = 'adoptado' AND adoptado_en BETWEEN ? AND ?", [req.usuario.id, p.inicio, p.fin]);
  res.json({ ...p, ingresos: Number(ing.n), adopciones: Number(ado.n) });
}));

module.exports = { router: r, cerrarPendientes, marcarAdopcion, horario };
