/* Solicitudes de adopción, citas, adopciones y reportes de usuarios (RF-16 a RF-23, RF-33). */
const express = require('express');
const { q, uno, tx } = require('./db');
const {
  h, V, falla, limpiar, ahora, hoy, sumarDias, diaSemana, esFecha, notificar,
} = require('./util');
const { requiere } = require('./seguridad');
const { cerrarPendientes, marcarAdopcion } = require('./animales');

const r = express.Router();
const soloAdoptante = requiere('adoptante');
const soloRefugio = requiere('refugio');
const MOTIVOS = ['Animal no doméstico', 'Contenido inapropiado', 'Información falsa', 'Otro'];

/* ---------- RF-16: solicitar adopción ---------- */
r.post('/solicitudes', soloAdoptante, h(async (req, res) => {
  const animalId = V.id(req.body && req.body.animal_id);
  const mensaje = V.mensajeSolicitud(req.body && req.body.mensaje);
  // El refugio necesita un teléfono de contacto: si la cuenta no lo tiene, se pide en la solicitud
  const yo = await uno('SELECT telefono FROM usuarios WHERE id = ?', [req.usuario.id]);
  const telefono = req.body && req.body.telefono ? V.telefono(req.body.telefono) : yo.telefono;
  if (!telefono) falla('Agregue su teléfono de contacto para que el refugio pueda comunicarse con usted.', 400, { codigo: 'TELEFONO' });
  await tx(async (c) => {
    if (telefono !== yo.telefono) await q('UPDATE usuarios SET telefono = ? WHERE id = ?', [telefono, req.usuario.id], c);
    // Bloquea al adoptante y al animal para que dos envíos simultáneos no rebasen los límites
    await q('SELECT id FROM usuarios WHERE id = ? FOR UPDATE', [req.usuario.id], c);
    const a = await uno(
      `SELECT a.id, a.nombre, a.estado, a.eliminado, a.refugio_id, u.estado AS refugio_estado
         FROM animales a JOIN usuarios u ON u.id = a.refugio_id WHERE a.id = ? FOR UPDATE`, [animalId], c);
    if (!a || a.eliminado || a.estado !== 'disponible' || a.refugio_estado !== 'activa') falla('El animal ya no está disponible para adopción.', 409);
    const dup = await uno("SELECT id FROM solicitudes WHERE animal_id = ? AND adoptante_id = ? AND estado IN ('pendiente','aprobada')", [animalId, req.usuario.id], c);
    if (dup) falla('Ya tiene una solicitud activa para el animal.', 409);
    const mias = await uno("SELECT COUNT(*) AS n FROM solicitudes WHERE adoptante_id = ? AND estado IN ('pendiente','aprobada')", [req.usuario.id], c);
    if (Number(mias.n) >= 5) falla('Tiene 5 solicitudes activas. No es posible enviar otra.', 409);
    const delAnimal = await uno("SELECT COUNT(*) AS n FROM solicitudes WHERE animal_id = ? AND estado IN ('pendiente','aprobada')", [animalId], c);
    if (Number(delAnimal.n) >= 20) falla('La publicación ya tiene 20 solicitudes activas.', 409);
    await q('INSERT INTO solicitudes (animal_id, adoptante_id, mensaje, enviada_en) VALUES (?, ?, ?, ?)', [animalId, req.usuario.id, mensaje, ahora()], c);
    await notificar(a.refugio_id, `Nueva solicitud de adopción para ${a.nombre} de ${req.usuario.nombre}${mensaje ? ' (incluye un mensaje)' : ''}.`, c);
  });
  res.status(201).json({ mensaje: 'Solicitud enviada. El refugio la revisará y recibirás una notificación.' });
}));

/* ---------- RF-17: mis solicitudes ---------- */
r.get('/solicitudes/mias', soloAdoptante, h(async (req, res) => {
  const lista = await q(
    `SELECT s.id, s.estado, LEFT(s.enviada_en, 10) AS enviada, s.motivo_rechazo, s.mensaje, s.nota_refugio, LEFT(s.nota_en, 16) AS nota_en, s.concretada_en,
            a.id AS animal_id, a.nombre AS animal, a.raza, a.raza_aprox, u.nombre AS refugio,
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
  res.json(lista);
}));

/* ---------- RF-18: solicitudes recibidas (el correo solo lo ve el Refugio de la solicitud, RNF-03) ---------- */
r.get('/refugio/solicitudes', soloRefugio, h(async (req, res) => {
  // Con animal_id se listan todas las solicitudes de esa mascota, en cualquier estado
  const animalId = req.query.animal_id ? V.id(req.query.animal_id) : null;
  const estado = ['pendiente', 'aprobada', 'rechazada'].includes(req.query.estado) ? req.query.estado : 'pendiente';
  const filtro = animalId ? 'a.id = ?' : 's.estado = ?';
  const lista = await q(
    `SELECT s.id, s.estado, LEFT(s.enviada_en, 10) AS enviada, LEFT(s.aprobada_en, 10) AS aprobada, s.motivo_rechazo, s.mensaje, s.nota_refugio, LEFT(s.nota_en, 16) AS nota_en, s.concretada_en,
            a.id AS animal_id, a.nombre AS animal, a.estado AS animal_estado, a.raza, a.raza_aprox,
            u.nombre AS adoptante, u.correo AS adoptante_correo, u.telefono AS adoptante_telefono, c.fecha AS cita_fecha, c.hora AS cita_hora
       FROM solicitudes s
       JOIN animales a ON a.id = s.animal_id
       JOIN usuarios u ON u.id = s.adoptante_id
       LEFT JOIN citas c ON c.solicitud_id = s.id
      WHERE a.refugio_id = ? AND ${filtro} ORDER BY s.enviada_en DESC`, [req.usuario.id, animalId || estado]);
  res.json(lista);
}));

async function solicitudPropia(req, c) {
  const s = await uno(
    `SELECT s.*, a.nombre AS animal, a.refugio_id, a.estado AS animal_estado, a.eliminado
       FROM solicitudes s JOIN animales a ON a.id = s.animal_id WHERE s.id = ? FOR UPDATE`, [V.id(req.params.id)], c);
  if (!s || s.refugio_id !== req.usuario.id) falla('La solicitud no existe.', 404);
  return s;
}

/* ---------- Nota corta del refugio al adoptante (aviso dentro de la solicitud) ---------- */
r.put('/refugio/solicitudes/:id/nota', soloRefugio, h(async (req, res) => {
  const nota = V.notaRefugio((req.body || {}).nota);
  await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    if (!['pendiente', 'aprobada'].includes(s.estado) || s.concretada_en) falla('Solo se pueden dejar notas en solicitudes pendientes o aprobadas.', 409);
    await q('UPDATE solicitudes SET nota_refugio = ?, nota_en = ? WHERE id = ?', [nota, nota ? ahora() : null, s.id], c);
    if (nota && nota !== s.nota_refugio) await notificar(s.adoptante_id, `${req.usuario.nombre} te dejó una nota sobre tu solicitud para ${s.animal}: “${nota}”`, c);
  });
  res.json({ mensaje: nota ? 'Nota enviada al adoptante.' : 'Nota eliminada.' });
}));

/* ---------- RF-19: aprobar ---------- */
r.post('/refugio/solicitudes/:id/aprobar', soloRefugio, h(async (req, res) => {
  await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    if (s.estado !== 'pendiente') falla('La solicitud ya no está pendiente.', 409);
    if (s.animal_estado !== 'disponible' || s.eliminado) falla('El animal ya no está disponible para adopción.', 409);
    // Regla: solo una solicitud aprobada por animal a la vez
    const otra = await uno("SELECT id FROM solicitudes WHERE animal_id = ? AND estado = 'aprobada' AND id <> ? FOR UPDATE", [s.animal_id, s.id], c);
    if (otra) falla('El animal ya tiene una solicitud aprobada. Concrete la adopción o cancele esa aprobación antes de aprobar otra.', 409);
    await q("UPDATE solicitudes SET estado = 'aprobada', aprobada_en = ? WHERE id = ?", [ahora(), s.id], c);
    await notificar(s.adoptante_id, `¡Tu solicitud para ${s.animal} fue aprobada! El refugio agendará una cita contigo.`, c);
  });
  res.json({ mensaje: 'Solicitud aprobada.' });
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
    await notificar(s.adoptante_id, `Tu solicitud para ${s.animal} fue rechazada. Motivo: ${motivo}`, c);
  });
  res.json({ mensaje: 'Solicitud rechazada.' });
}));

/* ---------- RF-21: agendar cita ---------- */
r.post('/refugio/solicitudes/:id/cita', soloRefugio, h(async (req, res) => {
  const { fecha, hora } = req.body || {};
  await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    if (s.estado !== 'aprobada' || s.concretada_en) falla('Las citas solo se agendan para solicitudes aprobadas.', 409);
    const t = hoy();
    if (!esFecha(fecha) || fecha <= t || fecha > sumarDias(t, 7)) falla('La fecha debe estar dentro de los próximos 7 días.');
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
    await notificar(s.adoptante_id, `Cita agendada para conocer a ${s.animal}: ${fecha} a las ${hora}. Lleva los requisitos de adopción.`, c);
  }).catch((e) => {
    if (e.code === 'ER_DUP_ENTRY') falla('El bloque seleccionado ya está ocupado. Seleccione otra hora.', 409);
    throw e;
  });
  res.json({ mensaje: 'Cita agendada.' });
}));

/* ---------- RF-22 + RF-23: marcar adopción y cerrar las solicitudes pendientes ---------- */
r.post('/refugio/solicitudes/:id/adopcion', soloRefugio, h(async (req, res) => {
  const fecha = req.body && req.body.fecha;
  const cerradas = await tx(async (c) => {
    const s = await solicitudPropia(req, c);
    return marcarAdopcion(c, s, fecha);
  });
  res.json({ mensaje: `Adopción registrada. Solicitudes pendientes cerradas: ${cerradas}.` });
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

/* ---------- RF-33: reportar publicación o Refugio ---------- */
r.post('/reportes', soloAdoptante, h(async (req, res) => {
  const b = req.body || {};
  const tipo = b.objetivo_tipo === 'refugio' ? 'refugio' : b.objetivo_tipo === 'animal' ? 'animal' : falla('Objetivo inválido.');
  const objetivo = V.id(b.objetivo_id);
  if (!MOTIVOS.includes(b.motivo)) falla('Seleccione un motivo.');
  const desc = V.motivo(b.descripcion, 10, 300, 'La descripción debe tener de 10 a 300 caracteres.');
  const existe = tipo === 'animal'
    ? await uno('SELECT id FROM animales WHERE id = ? AND eliminado = 0', [objetivo])
    : await uno("SELECT id FROM usuarios WHERE id = ? AND tipo = 'refugio' AND estado = 'activa'", [objetivo]);
  if (!existe) falla('El objetivo reportado no existe.', 404);
  const dup = await uno("SELECT id FROM reportes WHERE adoptante_id = ? AND objetivo_tipo = ? AND objetivo_id = ? AND estado = 'abierto'", [req.usuario.id, tipo, objetivo]);
  if (dup) falla('Ya tiene un reporte abierto sobre el mismo objetivo.', 409);
  await q('INSERT INTO reportes (adoptante_id, objetivo_tipo, objetivo_id, motivo, descripcion, creado_en) VALUES (?, ?, ?, ?, ?, ?)',
    [req.usuario.id, tipo, objetivo, b.motivo, desc, ahora()]);
  res.status(201).json({ mensaje: 'Reporte enviado. Un Administrador lo revisará.' });
}));

module.exports = { router: r, MOTIVOS };
