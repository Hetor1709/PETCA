/* Protocolo de adopción (RF-16 a RF-23) basado en el proceso de la CDMX:
   1. Formato de adopción (cuestionario) + carta compromiso + mayoría de edad.
   2. Revisión del refugio y conversación corta con la persona adoptante.
   3. Aprobación → cita para conocer al perro y entregar documentos.
   4. Visita domiciliaria (o se registra que no fue necesaria).
   5. Entrega: perro esterilizado, desparasitado, con cartilla; carta firmada y registro RUAC
      (Ley de Protección y Bienestar de los Animales de la CDMX, art. 32).
   6. Seguimiento a la semana, al mes y a los 3 meses.
   También: reportes de adoptantes (fichas y refugios) y de refugios (adoptantes), RF-33. */
const express = require('express');
const { q, uno, tx } = require('./db');
const {
  h, V, falla, limpiar, ahora, hoy, sumarDias, diaSemana, esFecha, notificar, haceMin,
} = require('./util');
const { requiere } = require('./seguridad');
const { cerrarPendientes, marcarAdopcion } = require('./animales');

const r = express.Router();
// Adoptan las personas adoptantes y también los refugios (nunca un perro de su propio refugio)
const soloAdoptante = requiere('adoptante', 'refugio');
const soloRefugio = requiere('refugio');

/* ---------- Formato de adopción ---------- */
const OPCIONES = {
  vivienda: { casa: 'Casa', departamento: 'Departamento', otro: 'Otro' },
  tenencia: { propia: 'Propia', rentada: 'Rentada', familiar: 'De un familiar' },
  espacio: { patio: 'Patio o jardín', interior: 'Solo interior', azotea: 'Azotea o balcón' },
  ninos: { no: 'No', si: 'Sí' },
  mascotas: { no: 'No', perros: 'Perros', gatos: 'Gatos', otras: 'Otras' },
  experiencia: { primera: 'Será mi primer perro', antes: 'He tenido perros', actual: 'Tengo perros ahora' },
};
const COMPROMISOS = {
  veterinario: 'Darle atención veterinaria, vacunas y desparasitación cuando lo necesite.',
  esterilizar: 'Mantenerlo esterilizado (o esterilizarlo en la fecha acordada si es cachorro).',
  no_abandonar: 'No abandonarlo, venderlo ni regalarlo; si no puedo cuidarlo, avisar primero al refugio.',
  ruac: 'Registrarlo en el RUAC (Registro Único de Animales de Compañía de la CDMX).',
  seguimiento: 'Aceptar la visita domiciliaria y el seguimiento posterior del refugio.',
  trato_digno: 'Darle trato digno: espacio adecuado, alimento, agua, paseos y nunca dejarlo en la azotea de forma permanente.',
};

function validarCuestionario(b) {
  const c = b && typeof b === 'object' ? b : falla('Completa el formato de adopción.');
  const opcion = (k, titulo) => (Object.prototype.hasOwnProperty.call(OPCIONES[k], c[k]) ? c[k] : falla(`Responde: ${titulo}.`));
  const vivienda = opcion('vivienda', '¿En qué tipo de vivienda vives?');
  const tenencia = opcion('tenencia', '¿La vivienda es propia o rentada?');
  if (tenencia === 'rentada' && c.permiso !== true) falla('Si rentas, necesitas el permiso del arrendador para tener un perro. Confírmalo en el formato.');
  const espacio = opcion('espacio', '¿Dónde pasará el perro la mayor parte del día?');
  const habitantes = Number(c.habitantes);
  if (!Number.isInteger(habitantes) || habitantes < 1 || habitantes > 20) falla('Indica cuántas personas viven en tu hogar (de 1 a 20).');
  const ninos = opcion('ninos', '¿Hay niñas o niños en casa?');
  if (c.de_acuerdo !== true) falla('Todas las personas que viven contigo deben estar de acuerdo con la adopción.');
  const mascotas = opcion('mascotas', '¿Tienes otras mascotas?');
  const experiencia = opcion('experiencia', '¿Has tenido perros antes?');
  const horas = Number(c.horas_solo);
  if (!Number.isInteger(horas) || horas < 0 || horas > 24) falla('Indica cuántas horas al día estará solo (de 0 a 24).');
  const motivo = V.texto(c.motivo, { min: 20, max: 400, campo: '¿Por qué quieres adoptar?', minPalabras: 4, lineas: 5 });
  return { vivienda, tenencia, permiso: tenencia === 'rentada', espacio, habitantes, ninos, de_acuerdo: true, mascotas, experiencia, horas_solo: horas, motivo };
}

/* Texto legible del cuestionario (para el refugio y para que el adoptante vea lo que envió) */
function resumenCuestionario(c) {
  if (!c) return null;
  return [
    ['Vivienda', `${OPCIONES.vivienda[c.vivienda]} ${OPCIONES.tenencia[c.tenencia].toLowerCase()}${c.permiso ? ' (con permiso del arrendador)' : ''}`],
    ['Espacio para el perro', OPCIONES.espacio[c.espacio]],
    ['Personas en casa', `${c.habitantes}${c.ninos === 'si' ? ', con niñas o niños' : ''} · todas de acuerdo`],
    ['Otras mascotas', OPCIONES.mascotas[c.mascotas]],
    ['Experiencia', OPCIONES.experiencia[c.experiencia]],
    ['Horas solo al día', String(c.horas_solo)],
    ['¿Por qué quiere adoptar?', c.motivo],
  ];
}

r.get('/solicitudes/formato', (req, res) => res.json({ opciones: OPCIONES, compromisos: COMPROMISOS }));

/* ---------- RF-16: solicitar adopción ---------- */
r.post('/solicitudes', soloAdoptante, h(async (req, res) => {
  const b = req.body || {};
  const animalId = V.id(b.animal_id);
  const cuestionario = validarCuestionario(b.cuestionario);
  const comp = b.compromisos && typeof b.compromisos === 'object' ? b.compromisos : {};
  const faltan = Object.keys(COMPROMISOS).filter((k) => comp[k] !== true);
  if (faltan.length) falla('Para continuar acepta cada punto de la carta compromiso de adopción.');
  const mensaje = V.texto(b.mensaje, { min: 10, max: 300, campo: 'El mensaje', opcional: true, minPalabras: 2, lineas: 4 });
  const yo = await uno('SELECT telefono, mayor_edad_en FROM usuarios WHERE id = ?', [req.usuario.id]);
  const esRefugio = req.usuario.tipo === 'refugio';
  if (esRefugio) yo.telefono = (await uno('SELECT telefono FROM refugios WHERE usuario_id = ?', [req.usuario.id])).telefono; // contacto: el del refugio
  if (!yo.mayor_edad_en && b.mayor_edad !== true) falla('Para adoptar debes ser mayor de 18 años. Confírmalo en el formato.');
  // El refugio necesita un teléfono de contacto: si la cuenta no lo tiene, se pide en la solicitud
  const telefono = b.telefono && !esRefugio ? await V.telefonoLibre(V.telefono(b.telefono), req.usuario.id) : yo.telefono;
  if (!telefono) falla('Agregue su teléfono de contacto para que el refugio pueda comunicarse con usted.', 400, { codigo: 'TELEFONO' });
  const t = ahora();
  const id = await tx(async (c) => {
    if (!esRefugio && telefono !== yo.telefono) await q('UPDATE usuarios SET telefono = ? WHERE id = ?', [telefono, req.usuario.id], c);
    if (!yo.mayor_edad_en) await q('UPDATE usuarios SET mayor_edad_en = ? WHERE id = ?', [t, req.usuario.id], c);
    // Bloquea al adoptante y al animal para que dos envíos simultáneos no rebasen los límites
    await q('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [req.usuario.id], c);
    const a = await uno(
      `SELECT a.id, a.nombre, a.estado, a.eliminado, a.refugio_id, u.estado AS refugio_estado
         FROM animales a JOIN usuarios u ON u.id = a.refugio_id WHERE a.id = ? FOR UPDATE OF a`, [animalId], c);
    if (!a || a.eliminado || a.estado !== 'disponible' || a.refugio_estado !== 'activa') falla('El animal ya no está disponible para adopción.', 409);
    if (a.refugio_id === req.usuario.id) falla('No puedes solicitar la adopción de un perro de tu propio refugio.', 403);
    const dup = await uno("SELECT id FROM solicitudes WHERE animal_id = ? AND adoptante_id = ? AND estado IN ('pendiente','aprobada')", [animalId, req.usuario.id], c);
    if (dup) falla('Ya tiene una solicitud activa para el animal.', 409);
    const mias = await uno("SELECT COUNT(*) AS n FROM solicitudes WHERE adoptante_id = ? AND estado IN ('pendiente','aprobada') AND concretada_en IS NULL", [req.usuario.id], c);
    if (Number(mias.n) >= 5) falla('Tiene 5 solicitudes activas. No es posible enviar otra.', 409);
    const delAnimal = await uno("SELECT COUNT(*) AS n FROM solicitudes WHERE animal_id = ? AND estado IN ('pendiente','aprobada')", [animalId], c);
    if (Number(delAnimal.n) >= 20) falla('La publicación ya tiene 20 solicitudes activas.', 409);
    const ins = await q('INSERT INTO solicitudes (animal_id, adoptante_id, cuestionario, compromiso_en, enviada_en) VALUES (?, ?, ?, ?, ?) RETURNING id',
      [animalId, req.usuario.id, JSON.stringify(cuestionario), t, t], c);
    if (mensaje) await q('INSERT INTO mensajes (solicitud_id, autor_id, texto, creado_en) VALUES (?, ?, ?, ?)', [ins.insertId, req.usuario.id, mensaje, t], c);
    await notificar(a.refugio_id, `Nueva solicitud de adopción para ${a.nombre} de ${req.usuario.nombre}.`, c, `#/refugio/solicitudes?id=${ins.insertId}`);
    return ins.insertId;
  });
  res.status(201).json({ id, mensaje: 'Solicitud enviada. El refugio la revisará y recibirás una notificación.' });
}));

/* Mensajes y seguimientos de varias solicitudes en una sola consulta */
async function adjuntar(lista, yoId) {
  if (!lista.length) return lista;
  const ids = lista.map((x) => x.id);
  const msgs = await q(
    `SELECT m.id, m.solicitud_id, m.autor_id, m.texto, LEFT(m.creado_en, 16) AS creado, m.leido_en IS NOT NULL AS leido, u.tipo AS autor_tipo
       FROM mensajes m JOIN usuarios u ON u.id = m.autor_id WHERE m.solicitud_id = ANY(?) ORDER BY m.id`, [ids]);
  const segs = await q('SELECT id, solicitud_id, etapa, programado, realizado_en, resultado, notas FROM seguimientos WHERE solicitud_id = ANY(?) ORDER BY programado', [ids]);
  for (const s of lista) {
    // es_adoptante: el autor es quien adopta (puede ser una cuenta de refugio adoptando de otro refugio)
    s.mensajes = msgs.filter((m) => m.solicitud_id === s.id).map((m) => ({ ...m, mio: m.autor_id === yoId, es_adoptante: m.autor_id === s.adoptante_id }));
    s.sin_leer = s.mensajes.filter((m) => !m.mio && !m.leido).length;
    s.seguimientos = segs.filter((x) => x.solicitud_id === s.id);
    s.resumen = resumenCuestionario(s.cuestionario);
    s.puede_escribir = puedeEscribir(s);
  }
  return lista;
}

/* La conversación está abierta mientras la solicitud sigue viva y hasta 90 días después de la entrega (seguimiento) */
const puedeEscribir = (s) => (s.estado === 'pendiente' || s.estado === 'aprobada')
  && (!s.concretada_en || String(s.concretada_en) >= sumarDias(hoy(), -90));

/* ---------- RF-17: mis solicitudes (incluye lo que envié aunque el refugio no haya respondido) ---------- */
r.get('/solicitudes/mias', soloAdoptante, h(async (req, res) => {
  const lista = await q(
    `SELECT s.id, s.estado, LEFT(s.enviada_en, 16) AS enviada, s.motivo_rechazo, s.cuestionario, s.concretada_en, s.visita, s.visita_en, s.entrega,
            a.id AS animal_id, a.nombre AS animal, a.raza, a.raza_aprox, u.id AS refugio_id, u.nombre AS refugio, u.avatar_v AS refugio_avatar,
            rf.direccion, rf.telefono, rf.lat, rf.lng, rf.place_id, c.fecha AS cita_fecha, c.hora AS cita_hora
       FROM solicitudes s
       JOIN animales a ON a.id = s.animal_id
       JOIN usuarios u ON u.id = a.refugio_id
       JOIN refugios rf ON rf.usuario_id = a.refugio_id
       LEFT JOIN citas c ON c.solicitud_id = s.id
      WHERE s.adoptante_id = ? ORDER BY s.enviada_en DESC, s.id DESC`, [req.usuario.id]);
  // Para la tabla de la cita: qué llevar
  for (const x of lista.filter((y) => y.cita_fecha && !y.concretada_en)) {
    x.requisitos = (await q('SELECT nombre FROM requisitos WHERE animal_id = ? ORDER BY otro, id', [x.animal_id])).map((y) => y.nombre);
  }
  res.json(await adjuntar(lista, req.usuario.id));
}));

/* ---------- RF-18: solicitudes recibidas (el correo solo lo ve el Refugio de la solicitud, RNF-03) ---------- */
const VISTAS = {
  pendiente: "s.estado = 'pendiente'",
  aprobada: "s.estado = 'aprobada' AND s.concretada_en IS NULL",
  adoptada: 's.concretada_en IS NOT NULL',
  rechazada: "s.estado IN ('rechazada','cancelada')",
};
r.get('/refugio/solicitudes', soloRefugio, h(async (req, res) => {
  // Con animal_id: todas las de esa mascota; con id: solo esa (enlaces de notificaciones); si no, por estado
  const animalId = req.query.animal_id ? V.id(req.query.animal_id) : null;
  const solId = req.query.id ? V.id(req.query.id) : null;
  const vista = VISTAS[req.query.estado] ? req.query.estado : 'pendiente';
  const filtro = solId ? 's.id = ?' : animalId ? 'a.id = ?' : VISTAS[vista];
  const params = [req.usuario.id, ...(solId ? [solId] : animalId ? [animalId] : [])];
  const lista = await q(
    `SELECT s.id, s.estado, LEFT(s.enviada_en, 16) AS enviada, LEFT(s.aprobada_en, 10) AS aprobada, s.motivo_rechazo, s.cuestionario,
            s.concretada_en, s.visita, s.visita_en, s.entrega,
            a.id AS animal_id, a.nombre AS animal, a.estado AS animal_estado, a.raza, a.raza_aprox, a.esterilizado, e.nombre AS edad,
            u.id AS adoptante_id, u.nombre AS adoptante, u.correo AS adoptante_correo, COALESCE(u.telefono, (SELECT rr.telefono FROM refugios rr WHERE rr.usuario_id = u.id)) AS adoptante_telefono, u.tipo AS adoptante_tipo, u.avatar_v AS adoptante_avatar,
            c.fecha AS cita_fecha, c.hora AS cita_hora
       FROM solicitudes s
       JOIN animales a ON a.id = s.animal_id
       JOIN catalogo_valores e ON e.id = a.edad_id
       JOIN usuarios u ON u.id = s.adoptante_id
       LEFT JOIN citas c ON c.solicitud_id = s.id
      WHERE a.refugio_id = ? AND ${filtro} ORDER BY s.enviada_en DESC`, params);
  const cuentas = await q(
    `SELECT CASE WHEN s.concretada_en IS NOT NULL THEN 'adoptada' WHEN s.estado IN ('rechazada','cancelada') THEN 'rechazada' ELSE s.estado END AS v, COUNT(*) AS n
       FROM solicitudes s JOIN animales a ON a.id = s.animal_id WHERE a.refugio_id = ? GROUP BY 1`, [req.usuario.id]);
  res.json({ vista: solId || animalId ? null : vista, cuentas: Object.fromEntries(cuentas.map((x) => [x.v, Number(x.n)])), solicitudes: await adjuntar(lista, req.usuario.id) });
}));

async function solicitudPropia(req, c) {
  const s = await uno(
    `SELECT s.*, a.nombre AS animal, a.refugio_id, a.estado AS animal_estado, a.eliminado
       FROM solicitudes s JOIN animales a ON a.id = s.animal_id WHERE s.id = ? FOR UPDATE OF s`, [V.id(req.params.id)], c);
  if (!s || s.refugio_id !== req.usuario.id) falla('La solicitud no existe.', 404);
  return s;
}

/* ---------- Conversación corta adoptante ↔ refugio ---------- */
async function solicitudDeAmbos(req, c) {
  const s = await uno(
    `SELECT s.id, s.estado, s.concretada_en, s.adoptante_id, a.refugio_id, a.nombre AS animal
       FROM solicitudes s JOIN animales a ON a.id = s.animal_id WHERE s.id = ?`, [V.id(req.params.id)], c);
  if (!s || ![s.adoptante_id, s.refugio_id].includes(req.usuario.id)) falla('La solicitud no existe.', 404);
  return s;
}

r.get('/solicitudes/:id/mensajes', requiere('adoptante', 'refugio'), h(async (req, res) => {
  const s = await solicitudDeAmbos(req);
  await q('UPDATE mensajes SET leido_en = ? WHERE solicitud_id = ? AND autor_id <> ? AND leido_en IS NULL', [ahora(), s.id, req.usuario.id]);
  const msgs = await q('SELECT id, autor_id, texto, LEFT(creado_en, 16) AS creado FROM mensajes WHERE solicitud_id = ? ORDER BY id', [s.id]);
  res.json(msgs.map((m) => ({ ...m, mio: m.autor_id === req.usuario.id })));
}));

r.post('/solicitudes/:id/mensajes', requiere('adoptante', 'refugio'), h(async (req, res) => {
  const texto = V.texto((req.body || {}).texto, { min: 2, max: 300, campo: 'El mensaje', minPalabras: 1, lineas: 4 });
  await tx(async (c) => {
    const s = await solicitudDeAmbos(req, c);
    if (!puedeEscribir(s)) falla('La conversación está cerrada para esta solicitud.', 409);
    // Mensajes cortos, no chat: máximo 10 por persona al día y 3 seguidos sin respuesta
    const hoyMios = await uno('SELECT COUNT(*) AS n FROM mensajes WHERE solicitud_id = ? AND autor_id = ? AND creado_en >= ?', [s.id, req.usuario.id, haceMin(24 * 60)], c);
    if (Number(hoyMios.n) >= 10) falla('Llegaste al límite de 10 mensajes por día en esta solicitud.', 429);
    const ultimos = await q('SELECT autor_id FROM mensajes WHERE solicitud_id = ? ORDER BY id DESC LIMIT 3', [s.id], c);
    if (ultimos.length === 3 && ultimos.every((m) => m.autor_id === req.usuario.id)) falla('Espera la respuesta antes de enviar más mensajes (máximo 3 seguidos).', 429);
    await q('INSERT INTO mensajes (solicitud_id, autor_id, texto, creado_en) VALUES (?, ?, ?, ?)', [s.id, req.usuario.id, texto, ahora()], c);
    const otro = req.usuario.id === s.adoptante_id ? s.refugio_id : s.adoptante_id;
    const enlace = otro === s.refugio_id ? `#/refugio/solicitudes?id=${s.id}` : `#/solicitudes?id=${s.id}`;
    // Una sola notificación sin leer por conversación (no se llena la bandeja)
    const yaAvisado = await uno('SELECT id FROM notificaciones WHERE usuario_id = ? AND enlace = ? AND leida = 0', [otro, enlace], c);
    if (!yaAvisado) await notificar(otro, `${req.usuario.nombre} te escribió sobre la solicitud de ${s.animal}.`, c, enlace);
  });
  res.status(201).json({ mensaje: 'Mensaje enviado.' });
}));

/* ---------- RF-19: aprobar (pasa a cita y visita) ---------- */
r.post('/refugio/solicitudes/:id/aprobar', soloRefugio, h(async (req, res) => {
  await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    if (s.estado !== 'pendiente') falla('La solicitud ya no está pendiente.', 409);
    if (s.animal_estado !== 'disponible' || s.eliminado) falla('El animal ya no está disponible para adopción.', 409);
    // Regla: solo una solicitud aprobada por animal a la vez
    const otra = await uno("SELECT id FROM solicitudes WHERE animal_id = ? AND estado = 'aprobada' AND id <> ? FOR UPDATE", [s.animal_id, s.id], c);
    if (otra) falla('El animal ya tiene una solicitud aprobada. Concrete la adopción o cancele esa aprobación antes de aprobar otra.', 409);
    await q("UPDATE solicitudes SET estado = 'aprobada', aprobada_en = ? WHERE id = ?", [ahora(), s.id], c);
    await notificar(s.adoptante_id, `¡Tu solicitud para ${s.animal} fue aprobada! El refugio agendará una cita y la visita domiciliaria contigo.`, c, `#/solicitudes?id=${s.id}`);
  });
  res.json({ mensaje: 'Solicitud aprobada. Agenda la cita y registra la visita domiciliaria.' });
}));

/* ---------- RF-20: rechazar ---------- */
r.post('/refugio/solicitudes/:id/rechazar', soloRefugio, h(async (req, res) => {
  const m = limpiar(req.body && req.body.motivo);
  if (!m) falla('Debe ingresar el motivo del rechazo.');
  const motivo = V.motivo(m);
  await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    // También permite cancelar una aprobación que aún no se concreta (si el adoptante desiste)
    const cancelable = s.estado === 'aprobada' && !s.concretada_en && s.animal_estado === 'disponible';
    if (s.estado !== 'pendiente' && !cancelable) falla('La solicitud ya no está pendiente.', 409);
    await q("UPDATE solicitudes SET estado = 'rechazada', motivo_rechazo = ?, rechazada_en = ? WHERE id = ?", [motivo, ahora(), s.id], c);
    await q('DELETE FROM citas WHERE solicitud_id = ?', [s.id], c);
    await notificar(s.adoptante_id, `Tu solicitud para ${s.animal} fue rechazada. Motivo: ${motivo}`, c, `#/solicitudes?id=${s.id}`);
  });
  res.json({ mensaje: 'Solicitud rechazada.' });
}));

/* ---------- El adoptante puede retirar su solicitud ---------- */
r.post('/solicitudes/:id/cancelar', soloAdoptante, h(async (req, res) => {
  await tx(async (c) => {
    const s = await uno(
      `SELECT s.id, s.estado, s.concretada_en, a.refugio_id, a.nombre AS animal FROM solicitudes s JOIN animales a ON a.id = s.animal_id
        WHERE s.id = ? AND s.adoptante_id = ? FOR UPDATE OF s`, [V.id(req.params.id), req.usuario.id], c);
    if (!s) falla('La solicitud no existe.', 404);
    if (!['pendiente', 'aprobada'].includes(s.estado) || s.concretada_en) falla('Esta solicitud ya no se puede cancelar.', 409);
    await q("UPDATE solicitudes SET estado = 'cancelada', motivo_rechazo = 'La persona adoptante retiró su solicitud.', rechazada_en = ? WHERE id = ?", [ahora(), s.id], c);
    await q('DELETE FROM citas WHERE solicitud_id = ?', [s.id], c);
    await notificar(s.refugio_id, `${req.usuario.nombre} retiró su solicitud para ${s.animal}.`, c, `#/refugio/solicitudes?id=${s.id}`);
  });
  res.json({ mensaje: 'Solicitud cancelada.' });
}));

/* ---------- RF-21: agendar cita ---------- */
r.post('/refugio/solicitudes/:id/cita', soloRefugio, h(async (req, res) => {
  const { fecha, hora } = req.body || {};
  await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    if (s.estado !== 'aprobada' || s.concretada_en) falla('Las citas solo se agendan para solicitudes aprobadas.', 409);
    const t = hoy();
    if (!esFecha(fecha) || fecha <= t || fecha > sumarDias(t, 14)) falla('La fecha debe estar dentro de los próximos 14 días.');
    if (typeof hora !== 'string' || !/^([01]\d|2[0-3]):(00|30)$/.test(hora)) falla('Seleccione una hora en bloques de 30 minutos.');
    const dia = await uno('SELECT cerrado, abre, cierra FROM refugio_horarios WHERE refugio_id = ? AND dia = ?', [req.usuario.id, diaSemana(fecha)], c);
    if (!dia || dia.cerrado) falla('El Refugio está cerrado en el día seleccionado.');
    const [hh, mm] = hora.split(':').map(Number);
    const fin = `${String(hh + (mm === 30 ? 1 : 0)).padStart(2, '0')}:${mm === 30 ? '00' : '30'}`;
    if (hora < dia.abre || fin > dia.cierra) falla('La hora no está dentro del horario de atención.');
    const ocupado = await uno('SELECT solicitud_id FROM citas WHERE refugio_id = ? AND fecha = ? AND hora = ? FOR UPDATE', [req.usuario.id, fecha, hora], c);
    if (ocupado && ocupado.solicitud_id !== s.id) falla('El bloque seleccionado ya está ocupado. Seleccione otra hora.', 409);
    await q('DELETE FROM citas WHERE solicitud_id = ?', [s.id], c);
    await q('INSERT INTO citas (solicitud_id, refugio_id, fecha, hora, creada_en) VALUES (?, ?, ?, ?, ?)', [s.id, req.usuario.id, fecha, hora, ahora()], c);
    await notificar(s.adoptante_id, `Cita agendada para conocer a ${s.animal}: ${fecha} a las ${hora}. Lleva tu identificación y los requisitos.`, c, `#/solicitudes?id=${s.id}`);
  }).catch((e) => {
    if (e.code === 'ER_DUP_ENTRY') falla('El bloque seleccionado ya está ocupado. Seleccione otra hora.', 409);
    throw e;
  });
  res.json({ mensaje: 'Cita agendada.' });
}));

/* ---------- Visita domiciliaria: realizada, no requerida o el hogar no es apto (rechaza) ---------- */
r.put('/refugio/solicitudes/:id/visita', soloRefugio, h(async (req, res) => {
  const b = req.body || {};
  if (!['realizada', 'no_requerida', 'no_apta'].includes(b.resultado)) falla('Seleccione el resultado de la visita domiciliaria.');
  let fecha = null;
  if (b.resultado !== 'no_requerida') {
    if (!esFecha(b.fecha) || b.fecha > hoy() || b.fecha < sumarDias(hoy(), -60)) falla('Indique la fecha de la visita (hoy o en los últimos 60 días).');
    fecha = b.fecha;
  }
  const motivo = b.resultado === 'no_apta' ? V.motivo(b.motivo, 10, 300, 'Explique por qué el hogar no es apto (10 a 300 caracteres).') : null;
  await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    if (s.estado !== 'aprobada' || s.concretada_en) falla('La visita se registra en solicitudes aprobadas que aún no se concretan.', 409);
    if (fecha && fecha < String(s.aprobada_en).slice(0, 10)) falla('La visita no puede ser anterior a la aprobación de la solicitud.');
    await q('UPDATE solicitudes SET visita = ?, visita_en = ? WHERE id = ?', [b.resultado, fecha, s.id], c);
    if (motivo) {
      await q("UPDATE solicitudes SET estado = 'rechazada', motivo_rechazo = ?, rechazada_en = ? WHERE id = ?", [`Visita domiciliaria: ${motivo}`, ahora(), s.id], c);
      await q('DELETE FROM citas WHERE solicitud_id = ?', [s.id], c);
      await notificar(s.adoptante_id, `Tras la visita domiciliaria, tu solicitud para ${s.animal} no continuó. Motivo: ${motivo}`, c, `#/solicitudes?id=${s.id}`);
    }
  });
  res.json({ mensaje: motivo ? 'Visita registrada: la solicitud se rechazó.' : 'Visita domiciliaria registrada.' });
}));

/* ---------- RF-22 + RF-23: entrega (adopción) y cierre de las demás solicitudes ---------- */
r.post('/refugio/solicitudes/:id/adopcion', soloRefugio, h(async (req, res) => {
  const b = req.body || {};
  const cerradas = await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    return marcarAdopcion(c, s, b.fecha, b.entrega);
  });
  res.json({ mensaje: `Adopción registrada. Se programó el seguimiento (1 semana, 1 mes y 3 meses). Solicitudes pendientes cerradas: ${cerradas}.` });
}));

/* ---------- Seguimiento posterior a la adopción ---------- */
r.put('/refugio/seguimientos/:id', soloRefugio, h(async (req, res) => {
  const b = req.body || {};
  if (!['bien', 'con_dudas', 'problema', 'sin_contacto'].includes(b.resultado)) falla('Seleccione cómo está el perro.');
  const notas = V.texto(b.notas, { min: 5, max: 300, campo: 'Las notas', opcional: b.resultado === 'bien', minPalabras: 1, lineas: 4 });
  await tx(async (c) => {
    const sg = await uno(
      `SELECT sg.id, sg.programado, sg.etapa, s.adoptante_id, s.id AS solicitud_id, a.refugio_id, a.nombre AS animal
         FROM seguimientos sg JOIN solicitudes s ON s.id = sg.solicitud_id JOIN animales a ON a.id = s.animal_id WHERE sg.id = ? FOR UPDATE OF sg`, [V.id(req.params.id)], c);
    if (!sg || sg.refugio_id !== req.usuario.id) falla('El seguimiento no existe.', 404);
    if (sg.programado > sumarDias(hoy(), 3)) falla(`Este seguimiento está programado para el ${sg.programado}; regístralo a partir de 3 días antes.`, 409);
    await q('UPDATE seguimientos SET realizado_en = ?, resultado = ?, notas = ? WHERE id = ?', [hoy(), b.resultado, notas, sg.id], c);
  });
  res.json({ mensaje: 'Seguimiento registrado.' });
}));

/* RF-23 manual: el Refugio confirma el cierre de solicitudes de un animal adoptado */
r.post('/refugio/animales/:id/cerrar-solicitudes', soloRefugio, h(async (req, res) => {
  const id = V.id(req.params.id);
  const n = await tx(async (c) => {
    const a = await uno('SELECT id, nombre, refugio_id, estado FROM animales WHERE id = ? FOR UPDATE', [id], c);
    if (!a || a.refugio_id !== req.usuario.id) falla('La publicación no existe.', 404);
    if (a.estado !== 'adoptado') falla('El animal aún no está marcado como Adoptado.', 409);
    const cerradas = await cerrarPendientes(c, a);
    if (!cerradas) falla('No hay solicitudes activas para cerrar.', 409);
    return cerradas;
  });
  res.json({ mensaje: `Solicitudes cerradas: ${n}.` });
}));

/* ---------- RF-33: reportes ----------
   Adoptantes reportan fichas de perros y refugios; los refugios reportan a adoptantes con quienes tuvieron una solicitud. */
const MOTIVOS = {
  animal: ['Animal no doméstico', 'Contenido inapropiado', 'Información falsa', 'Otro'],
  refugio: ['Información falsa', 'Trato inadecuado', 'Cobro indebido', 'Refugio inexistente', 'Otro'],
  usuario: ['Datos falsos', 'Trato inadecuado', 'No se presentó a la cita', 'Comportamiento sospechoso', 'Otro'],
};
r.post('/reportes', requiere('adoptante', 'refugio'), limitadorReportes(), h(async (req, res) => {
  const b = req.body || {};
  const tipo = Object.keys(MOTIVOS).includes(b.objetivo_tipo) ? b.objetivo_tipo : falla('Objetivo inválido.');
  // Quien adopta reporta publicaciones y refugios; el refugio además reporta a quienes le enviaron solicitudes
  const permitido = req.usuario.tipo === 'adoptante' ? ['animal', 'refugio'] : ['animal', 'refugio', 'usuario'];
  if (!permitido.includes(tipo)) falla('No puedes reportar este tipo de cuenta.', 403);
  const objetivo = V.id(b.objetivo_id);
  if ((tipo === 'refugio' || tipo === 'usuario') && objetivo === req.usuario.id) falla('No puedes reportar tu propia cuenta.', 400);
  if (tipo === 'animal' && await uno('SELECT id FROM animales WHERE id = ? AND refugio_id = ?', [objetivo, req.usuario.id])) falla('No puedes reportar tu propia publicación.', 400);
  if (!MOTIVOS[tipo].includes(b.motivo)) falla('Seleccione un motivo.');
  const desc = V.texto(b.descripcion, { min: 10, max: 300, campo: 'La descripción', minPalabras: 3, lineas: 4 });
  let existe;
  if (tipo === 'animal') existe = await uno('SELECT id FROM animales WHERE id = ? AND eliminado = 0', [objetivo]);
  else if (tipo === 'refugio') existe = await uno("SELECT id FROM usuarios WHERE id = ? AND tipo = 'refugio' AND estado = 'activa'", [objetivo]);
  else {
    // Solo adoptantes que hayan enviado una solicitud a este refugio
    existe = await uno(
      `SELECT u.id FROM usuarios u JOIN solicitudes s ON s.adoptante_id = u.id JOIN animales a ON a.id = s.animal_id
        WHERE u.id = ? AND u.tipo IN ('adoptante', 'refugio') AND a.refugio_id = ? LIMIT 1`, [objetivo, req.usuario.id]);
  }
  if (!existe) falla('El objetivo reportado no existe.', 404);
  const dup = await uno("SELECT id FROM reportes WHERE autor_id = ? AND objetivo_tipo = ? AND objetivo_id = ? AND estado = 'abierto'", [req.usuario.id, tipo, objetivo]);
  if (dup) falla('Ya tiene un reporte abierto sobre el mismo objetivo.', 409);
  await q('INSERT INTO reportes (autor_id, objetivo_tipo, objetivo_id, motivo, descripcion, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
    [req.usuario.id, tipo, objetivo, b.motivo, desc, ahora()]);
  res.status(201).json({ mensaje: 'Reporte enviado. El equipo de Dopta lo revisará.' });
}));
r.get('/reportes/motivos', (req, res) => res.json(MOTIVOS));

function limitadorReportes() {
  return require('./seguridad').limitador({ ventanaMin: 60, max: 10, clave: (req) => `rep|${req.usuario ? req.usuario.id : req.ip}`, mensaje: 'Demasiados reportes en poco tiempo. Intente más tarde.' });
}

module.exports = { router: r, MOTIVOS, COMPROMISOS };
