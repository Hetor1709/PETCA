/* Dopta · Servidor integrado en el navegador (sustituye a la antigua API Node + PostgreSQL).
   - Los datos viven en localStorage (clave "dopta.datos.v2") con la misma estructura de tablas que database/schema.sql (ver data/esquema.json).
   - Las llamadas fetch("/api/...") que hace app.js se interceptan aquí y se resuelven con la misma lógica de las rutas antiguas.
   - Las contraseñas se guardan con PBKDF2-SHA256 (Web Crypto). Las sesiones usan un token aleatorio guardado en localStorage.
   - Catálogos, razas y C.P. de la CDMX se leen de data/*.json.
   - Lo que dependía de un servidor (envío de correos, Google Places con clave secreta, DNS del correo) se explica en el README. */
(function () {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const Filtro = root.Filtro;
  const Reglas = root.Reglas;

  const CLAVE_DATOS = 'dopta.datos.v2';
  const CLAVE_SESION = 'dopta.sesion';
  const ITERACIONES = 150000;
  const INACTIVIDAD_MIN = 30;
  const POR_PAGINA = 24;
  const POR_PAGINA_ADMIN = 20;
  const AVISO_VERSION = 'v1.0';
  const TABLAS = ['usuarios', 'avatares', 'catalogo_valores', 'refugios', 'refugio_horarios', 'refugio_cambios', 'animales', 'requisitos',
    'vacunas', 'solicitudes', 'mensajes', 'citas', 'seguimientos', 'notificaciones', 'errores_notificacion', 'reportes', 'sesiones',
    'recuperaciones', 'recuperacion_intentos'];

  /* ---------- Datos estáticos (data/*.json) ---------- */
  const ESTATICO = { razas: [], cp: {} };

  /* ---------- Errores ---------- */
  class ErrorApp extends Error {
    constructor(status, mensaje, extra) { super(mensaje); this.status = status; this.extra = extra; }
  }
  const falla = (mensaje, status = 400, extra) => { throw new ErrorApp(status, mensaje, extra); };

  /* ---------- Texto ---------- */
  const limpiar = (v) => (typeof v === 'string' ? v : '')
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/g, '')
    .replace(/[<>]/g, '')
    .trim();
  const largo = (v) => [...v].length;
  const entre = (v, min, max) => largo(v) >= min && largo(v) <= max;
  const sinAcentos = (t) => String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const tieneLetras = (t, n = 2) => (String(t).match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length >= n;

  /* ---------- Fechas (zona America/Mexico_City) ---------- */
  const ZONA = 'America/Mexico_City';
  const partes = (d = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  const ahora = (d) => { const p = partes(d); return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; };
  const hoy = (d) => ahora(d).slice(0, 10);
  const haceMin = (min) => ahora(new Date(Date.now() - min * 60000));
  const enMin = (min) => ahora(new Date(Date.now() + min * 60000));
  const sumarDias = (fecha, n) => { const d = new Date(`${fecha}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diasEntre = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
  const diaSemana = (fecha) => (new Date(`${fecha}T12:00:00Z`).getUTCDay() + 6) % 7;
  const esFecha = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
  const esHora = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  const FECHA_MIN = '2000-01-01';

  /* ---------- Validaciones (mismas reglas que tenía el servidor) ---------- */
  const RE_NOMBRE_PERSONA = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/;
  const RE_CALLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,#°\-]+$/;
  const RE_NUM_EXT = /^(S\/N|\d{1,5}[A-Z]?(-[A-Z0-9]{1,3})?)$/;
  const RE_NUM_INT = /^[A-Z0-9][A-Z0-9 .\-]{0,9}$/;
  const RE_NOMBRE_REFUGIO = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,&()\-]+$/;
  const RE_PLACE = /^[A-Za-z0-9_-]{10,300}$/;
  const CP_ALCALDIA = {
    '01': 'Álvaro Obregón', '02': 'Azcapotzalco', '03': 'Benito Juárez', '04': 'Coyoacán', '05': 'Cuajimalpa de Morelos',
    '06': 'Cuauhtémoc', '07': 'Gustavo A. Madero', '08': 'Iztacalco', '09': 'Iztapalapa', '10': 'La Magdalena Contreras',
    '11': 'Miguel Hidalgo', '12': 'Milpa Alta', '13': 'Tláhuac', '14': 'Tlalpan', '15': 'Venustiano Carranza', '16': 'Xochimilco',
  };
  const CENTRO_ALCALDIA = {
    'alvaro obregon': [19.3587, -99.2033], azcapotzalco: [19.4869, -99.1844], 'benito juarez': [19.3727, -99.1565],
    coyoacan: [19.3467, -99.1617], 'cuajimalpa de morelos': [19.3569, -99.2990], cuauhtemoc: [19.4326, -99.1490],
    'gustavo a. madero': [19.4825, -99.1131], iztacalco: [19.3953, -99.0977], iztapalapa: [19.3550, -99.0622],
    'la magdalena contreras': [19.3044, -99.2408], 'miguel hidalgo': [19.4280, -99.2050], 'milpa alta': [19.1925, -99.0230],
    tlahuac: [19.2869, -99.0040], tlalpan: [19.2900, -99.1700], 'venustiano carranza': [19.4300, -99.1000], xochimilco: [19.2570, -99.1030],
  };
  const CDMX = { minLat: 19.04, maxLat: 19.6, minLng: -99.37, maxLng: -98.94 };
  const enCDMX = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= CDMX.minLat && lat <= CDMX.maxLat && lng >= CDMX.minLng && lng <= CDMX.maxLng;

  /* Teléfono: 10 dígitos, clave que empieza entre 2 y 9, sin series inventadas. (El servidor anterior además consultaba
     libphonenumber para validar la LADA; en el navegador solo se revisa el formato y las series falsas.) */
  function telefonoReal(t) {
    if (!/^[2-9]\d{9}$/.test(t)) return false;
    if (/(\d)\1{5,}/.test(t)) return false;
    if ('01234567890123456789'.includes(t.slice(2)) || '98765432109876543210'.includes(t.slice(2))) return false;
    if (/^(\d\d)\1{4}$/.test(t) || /^\d\d(\d\d)\1{3}$/.test(t)) return false;
    return true;
  }

  const GENERICOS = new Set(['perro', 'perra', 'perrito', 'perrita', 'can', 'mascota', 'animal', 'sin nombre', 'ninguno', 'ninguna',
    'nombre', 'test', 'prueba', 'asdf', 'qwerty', 'xxx', 'na', 'no', 'si', 'desconocido', 'desconocida', 'callejero', 'callejera']);
  function problemaNombre(n, tipo) {
    const plano = sinAcentos(n);
    if (/(.)\1\1/.test(plano.replace(/\s/g, ''))) return 'El nombre no puede repetir la misma letra 3 o más veces seguidas.';
    if (!/[aeiouy]/.test(plano)) return 'El nombre debe incluir al menos una vocal.';
    if (Filtro.groseria(n)) return 'El nombre contiene palabras no permitidas.';
    if (Filtro.sinSentido(n)) return 'El nombre parece no tener sentido. Escríbelo con letras reales.';
    if (tipo === 'perro') {
      if (GENERICOS.has(plano) || ESTATICO.razas.some((x) => sinAcentos(x.nombre) === plano)) return 'Escriba el nombre del perro, no un término genérico o el nombre de su raza.';
      if (plano.split(' ').length > 3) return 'El nombre del perro puede tener máximo 3 palabras.';
    }
    if (tipo === 'persona' && plano.split(' ').length > 6) return 'El nombre puede tener máximo 6 palabras.';
    if (tipo === 'persona' && plano.split(' ').every((p) => p.length === 1)) return 'Escriba el nombre completo, no solo iniciales.';
    return null;
  }

  function nacimientoMinimo(edadNombre, base) {
    const m = String(edadNombre || '').match(/(\d+)\s*(mes|año|ano)/i);
    if (!m) return null;
    const n = Number(m[1]) + 1;
    const d = new Date(`${base}T12:00:00Z`);
    if (/^mes/i.test(m[2])) d.setUTCMonth(d.getUTCMonth() - n); else d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 10);
  }

  const V = {
    correo(v) {
      const c = limpiar(v).toLowerCase();
      const p = Filtro.problemaCorreo(c);
      if (p) falla(p);
      return c;
    },
    contrasena(v) {
      if (typeof v !== 'string' || v.length < 8 || v.length > 64 || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(v) || !/\d/.test(v)) {
        falla('La contraseña debe tener de 8 a 64 caracteres, con al menos una letra y un número.');
      }
      return v;
    },
    nombrePersona(v) {
      const n = limpiar(v).replace(/\s+/g, ' ');
      if (!entre(n, 2, 100) || !RE_NOMBRE_PERSONA.test(n)) falla('El nombre debe tener entre 2 y 100 caracteres y solo letras y espacios.');
      const p = problemaNombre(n, 'persona');
      if (p) falla(p);
      return n;
    },
    nombreRefugio(v, msg = 'El nombre del refugio debe tener de 3 a 120 caracteres.') {
      const n = limpiar(v).replace(/\s+/g, ' ');
      if (!entre(n, 3, 120)) falla(msg);
      if (!tieneLetras(n)) falla('El nombre debe incluir letras, no solo números o símbolos.');
      if (!RE_NOMBRE_REFUGIO.test(n)) falla('El nombre solo puede tener letras, números, espacios y . , & ( ) -');
      const p = problemaNombre(n, 'refugio');
      if (p) falla(p);
      return n;
    },
    ubicacion(b, alcaldias) {
      const t = (v) => limpiar(typeof v === 'string' ? v : '').replace(/\s+/g, ' ');
      const calle = t(b.calle);
      const numExt = t(b.num_ext).toUpperCase().replace(/^S\/?N$/, 'S/N');
      const numInt = t(b.num_int).toUpperCase();
      const cp = typeof b.cp === 'string' ? b.cp.trim() : '';
      if (!/^\d{5}$/.test(cp)) falla('El código postal debe tener exactamente 5 dígitos.');
      const datosCp = ESTATICO.cp[cp];
      if (!datosCp) falla(`El código postal ${cp} no existe en la Ciudad de México (catálogo de Correos de México). Revísalo.`);
      const alc = alcaldias.find((a) => sinAcentos(a.nombre) === sinAcentos(datosCp.a)) || alcaldias.find((a) => Number(a.id) === Number(b.alcaldia_id));
      if (!alc) falla('Seleccione una alcaldía de la lista.');
      const elegida = sinAcentos(t(b.colonia).replace(/^col(onia)?\.?\s+/i, ''));
      const col = datosCp.c.find(([n]) => sinAcentos(n) === elegida);
      if (!col) falla(`Elige la colonia de la lista del C.P. ${cp}.`);
      const colonia = col[0];
      if (!entre(calle, 3, 100) || !RE_CALLE.test(calle) || !tieneLetras(calle, 3)) falla('La calle debe tener de 3 a 100 caracteres, con letras (puede incluir números y . , - #).');
      if (Filtro.groseria(calle) || Filtro.sinSentido(calle)) falla('Escribe el nombre real de la calle.');
      if (!RE_NUM_EXT.test(numExt) || /^0+\D*$/.test(numExt)) falla('El número exterior debe ser un número (ej. 1200, 15-B o 12A) o S/N si no tiene.');
      if (numInt && !RE_NUM_INT.test(numInt)) falla('El número interior puede tener hasta 10 letras o números (ej. 3, B, Depto 4).');
      const direccion = `${calle} ${numExt}${numInt ? ` Int. ${numInt}` : ''}, Col. ${colonia}, C.P. ${cp}`.slice(0, 200);
      return { calle, num_ext: numExt, num_int: numInt || null, colonia, cp, alcaldia_id: alc.id, direccion };
    },
    dimensiones(d, raza, tamanoNombre, edadNombre) {
      const peso = Math.round(Number(d.peso_kg) * 10) / 10;
      const altura = Math.round(Number(d.altura_cm));
      const dimsRazas = Object.fromEntries(ESTATICO.razas.map((r) => [r.id, r]));
      const p = Reglas.problema(peso, altura, Reglas.rango(raza, tamanoNombre, dimsRazas), Reglas.mesesDeEdad(edadNombre));
      if (p) falla(p);
      return { peso, altura };
    },
    texto(v, { min = 10, max = 500, campo = 'El texto', opcional = false, minPalabras = 2, lineas = 6 } = {}) {
      const crudo = limpiar(typeof v === 'string' ? v : '');
      if (!crudo.replace(/\s/g, '') && opcional) return null;
      const r = Filtro.revisarTexto(crudo, { min, max, campo, minPalabras, lineas });
      if (r.error) falla(r.error);
      return r.texto;
    },
    telefono(v) {
      const t = typeof v === 'string' ? v.replace(/[\s-]/g, '').replace(/^\+?52/, '') : '';
      if (!/^\d{10}$/.test(t)) falla('El teléfono debe tener exactamente 10 dígitos numéricos.');
      if (!telefonoReal(t)) falla('Ingrese un teléfono real de México: con una clave LADA válida, fijo o celular, y que no sea una serie como 5500000000 o 1234567890.');
      return t;
    },
    telefonoLibre(t, propioId = 0, w) {
      const otro = w.usuarios.some((u) => u.telefono === t && u.id !== propioId && !['baja', 'eliminada', 'rechazada'].includes(u.estado))
        || w.refugios.some((r) => {
          const u = usuarioPorId(w, r.usuario_id);
          return r.telefono === t && u && u.id !== propioId && !['baja', 'eliminada', 'rechazada'].includes(u.estado);
        });
      if (otro) falla('Ese teléfono ya está registrado en otra cuenta. Usa un número distinto.', 409);
      return t;
    },
    horario(lista) {
      if (!Array.isArray(lista) || lista.length !== 7) falla('Indique el horario de los 7 días de la semana.');
      const aMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
      const res = lista.map((d, i) => {
        if (!d || d.cerrado) return { dia: i, cerrado: 1, abre: null, cierra: null };
        if (!esHora(d.abre) || !esHora(d.cierra) || d.abre >= d.cierra) {
          falla('El horario de apertura debe ser menor que el horario de cierre, en formato HH:MM de 24 horas.');
        }
        if (aMin(d.cierra) - aMin(d.abre) < 60) falla('Cada día abierto debe tener al menos 1 hora de atención.');
        return { dia: i, cerrado: 0, abre: d.abre, cierra: d.cierra };
      });
      if (res.every((d) => d.cerrado)) falla('Indique al menos un día abierto para poder agendar citas.');
      return res;
    },
    motivo(v, min = 10, max = 300, msg = `El motivo debe tener de ${min} a ${max} caracteres.`) {
      const m = limpiar(v).replace(/\s+/g, ' ');
      if (!entre(m, min, max) || m.replace(/\s/g, '').length < min) falla(msg);
      return V.texto(m, { min, max, campo: 'El motivo', minPalabras: 2, lineas: 1 });
    },
    nombrePerro(v) {
      const n = limpiar(v).replace(/\s+/g, ' ');
      if (!entre(n, 2, 30) || !RE_NOMBRE_PERSONA.test(n)) falla('El nombre del perro debe tener de 2 a 30 caracteres, solo letras y espacios.');
      const p = problemaNombre(n, 'perro');
      if (p) falla(p);
      return n;
    },
    id(v) {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0 || n > 4294967295) falla('Identificador inválido.', 404);
      return n;
    },
    raza(v, w) {
      const r = limpiar(v);
      if (r !== 'mestizo' && !ESTATICO.razas.some((x) => x.id === r)) falla('Seleccione la raza del animal.');
      return r;
    },
    razaAprox(v) {
      const r = limpiar(v);
      if (!r) return null;
      if (!ESTATICO.razas.some((x) => x.id === r)) falla('Seleccione una raza de la lista.');
      return r;
    },
    pagina(v) {
      const n = Number(v || 1);
      return Number.isInteger(n) && n > 0 && n < 100000 ? n : 1;
    },
  };

  const OPCIONES_ANIMAL = {
    salud_general: { titulo: 'Estado de salud general', opciones: { excelente: 'Excelente', bueno: 'Bueno', regular: 'Regular', recuperacion: 'En recuperación' } },
    tratamiento: { titulo: '¿Requiere medicamento o trato especial?', opciones: { no: 'No requiere', medicamento: 'Sí, medicamento', dieta: 'Sí, dieta especial', cuidados: 'Sí, cuidados especiales' } },
    temp_general: { titulo: 'Temperamento general', opciones: { tranquilo: 'Tranquilo', jugueton: 'Juguetón', activo: 'Muy activo', nervioso: 'Nervioso' } },
    temp_perros: { titulo: 'Con otros perros', opciones: { sociable: 'Sociable', selectivo: 'Selectivo', unico: 'Prefiere ser el único', no_evaluado: 'No evaluado' } },
    temp_desconocidos: { titulo: 'Con desconocidos', opciones: { amigable: 'Amigable', timido: 'Tímido al inicio', desconfiado: 'Desconfiado', no_evaluado: 'No evaluado' } },
    temp_comida: { titulo: 'Al comer', opciones: { tranquilo: 'Come tranquilo', rapido: 'Come rápido', protege: 'Protege su comida', no_evaluado: 'No evaluado' } },
  };
  const CAMPOS_ANIMAL = Object.keys(OPCIONES_ANIMAL);
  const MOTIVOS = {
    animal: ['Animal no doméstico', 'Contenido inapropiado', 'Información falsa', 'Otro'],
    refugio: ['Información falsa', 'Trato inadecuado', 'Cobro indebido', 'Refugio inexistente', 'Otro'],
    usuario: ['Datos falsos', 'Trato inadecuado', 'No se presentó a la cita', 'Comportamiento sospechoso', 'Otro'],
  };
  const GRUPOS_EDAD = { cachorro: (m) => m < 12, joven: (m) => m >= 12 && m < 36, adulto: (m) => m >= 36 && m < 96, senior: (m) => m >= 96 };

  function periodo(query) {
    const t = hoy();
    if (query.periodo === '7') return { inicio: sumarDias(t, -6), fin: t };
    if (query.periodo === '30') return { inicio: sumarDias(t, -29), fin: t };
    const { inicio, fin } = query;
    if (!esFecha(inicio) || !esFecha(fin)) falla('Ingrese la fecha de inicio y la fecha de fin en formato AAAA-MM-DD.');
    if (inicio < FECHA_MIN) falla('La fecha de inicio no puede ser anterior al año 2000.');
    if (inicio > fin) falla('La fecha de inicio debe ser anterior o igual a la fecha de fin.');
    if (fin > t) falla('La fecha de fin debe ser igual o anterior a hoy.');
    if (diasEntre(inicio, fin) + 1 > 365) falla('El periodo máximo es de 365 días.');
    return { inicio, fin };
  }

  /* ======================= Base de datos (en memoria, copia en localStorage) ======================= */
  let db = { seq: {}, t: Object.fromEntries(TABLAS.map((t) => [t, []])) };

  const usuarioPorId = (w, id) => w.usuarios.find((u) => u.id === Number(id)) || null;
  const refugioDe = (w, usuarioId) => w.refugios.find((r) => r.usuario_id === Number(usuarioId)) || null;
  const valorCat = (w, id) => w.catalogo_valores.find((v) => v.id === Number(id)) || null;
  const alcaldiaDe = (w, rf) => (rf && rf.alcaldia_id ? (valorCat(w, rf.alcaldia_id) || {}).nombre || null : null);
  const siguienteId = (w, tabla) => { w.seq[tabla] = (w.seq[tabla] || 0) + 1; return w.seq[tabla]; };
  const insertar = (w, tabla, fila) => { const id = fila.id !== undefined ? fila.id : siguienteId(w, tabla); const f = { ...fila, id }; w[tabla].push(f); return f; };
  const horarioDe = (w, refugioId) => w.refugio_horarios.filter((h) => h.refugio_id === refugioId).sort((a, b) => a.dia - b.dia)
    .map((h) => ({ dia: h.dia, cerrado: Number(h.cerrado), abre: h.abre, cierra: h.cierra }));
  const notificar = (w, usuarioId, texto, enlace = null) => {
    const e = enlace && /^#\/[\w\-/?=&]{0,190}$/.test(enlace) ? enlace : null;
    insertar(w, 'notificaciones', { usuario_id: usuarioId, texto: [...String(texto)].slice(0, 200).join(''), enlace: e, leida: 0, creada_en: ahora(), leida_en: null });
  };
  const normalizar = (t) => sinAcentos(t);
  const tieneVal = (w, catalogo, nombre) => w.catalogo_valores.find((x) => x.catalogo === catalogo && sinAcentos(x.nombre) === sinAcentos(nombre));
  void tieneVal;

  /* Fila de tarjeta (catálogo público y listas del refugio) */
  function tarjeta(w, a, extra = false) {
    const u = usuarioPorId(w, a.refugio_id);
    const rf = refugioDe(w, a.refugio_id);
    const fila = {
      id: a.id, nombre: a.nombre, raza: a.raza, raza_aprox: a.raza_aprox, estado: a.estado,
      edad: (valorCat(w, a.edad_id) || {}).nombre, tamano: (valorCat(w, a.tamano_id) || {}).nombre,
      temperamento: a.temperamento, temp_general: a.temp_general, temp_perros: a.temp_perros, esterilizado: a.esterilizado,
      refugio: u ? u.nombre : null, refugio_id: a.refugio_id, alcaldia: alcaldiaDe(w, rf),
    };
    if (extra) {
      fila.publicado_en = a.publicado_en;
      fila.adoptado_en = a.adoptado_en;
      fila.activas = w.solicitudes.filter((s) => s.animal_id === a.id && ['pendiente', 'aprobada'].includes(s.estado)).length;
    }
    return fila;
  }

  /* ======================= Catálogos ======================= */
  function catalogos(w) {
    const res = { tamano: [], edad: [], tipo_requisito: [], alcaldia: [], vacuna: [], documento: [] };
    [...w.catalogo_valores].sort((a, b) => (a.catalogo < b.catalogo ? -1 : a.catalogo > b.catalogo ? 1 : (a.orden - b.orden) || (a.id - b.id)))
      .forEach((f) => res[f.catalogo].push({ id: f.id, nombre: f.nombre, orden: f.orden, activo: !!f.activo }));
    const prefijo = Object.fromEntries(Object.entries(CP_ALCALDIA).map(([k, v]) => [sinAcentos(v), k]));
    res.alcaldia.forEach((a) => { a.cp = prefijo[sinAcentos(a.nombre)] || null; });
    return res;
  }
  const DIMS = () => ({ razas: Object.fromEntries(ESTATICO.razas.map((x) => [x.id, { nombre: x.nombre, peso: x.peso, altura: x.altura }])), tamano: Reglas.DIMS_TAMANO });

  /* ======================= Refugios: datos institucionales ======================= */
  function validarRefugio(w, b, propioId = 0) {
    const alcaldias = w.catalogo_valores.filter((x) => x.catalogo === 'alcaldia' && x.activo);
    const datos = {
      institucion: V.nombreRefugio(b.institucion, 'El nombre de la institución debe tener de 3 a 120 caracteres.'),
      ...V.ubicacion(b, alcaldias),
      telefono: V.telefonoLibre(V.telefono(b.telefono), propioId, w),
      horario: V.horario(b.horario),
      lat: null, lng: null, place_id: null,
    };
    const lat = Number(b.lat);
    const lng = Number(b.lng);
    if (b.lat != null && b.lng != null && enCDMX(lat, lng)) {
      datos.lat = Math.round(lat * 1e6) / 1e6;
      datos.lng = Math.round(lng * 1e6) / 1e6;
      datos.place_id = RE_PLACE.test(String(b.place_id || '')) ? b.place_id : null;
    }
    return datos;
  }

  function guardarRefugio(w, id, d, nuevo) {
    const campos = { institucion: d.institucion, direccion: d.direccion, calle: d.calle, num_ext: d.num_ext, num_int: d.num_int, colonia: d.colonia, cp: d.cp, telefono: d.telefono, alcaldia_id: d.alcaldia_id, lat: d.lat, lng: d.lng, place_id: d.place_id };
    if (nuevo) w.refugios.push({ usuario_id: id, ...campos });
    else Object.assign(refugioDe(w, id), campos);
    for (const x of d.horario) {
      const fila = w.refugio_horarios.find((h) => h.refugio_id === id && h.dia === x.dia);
      if (fila) Object.assign(fila, { cerrado: x.cerrado, abre: x.abre, cierra: x.cierra });
      else w.refugio_horarios.push({ refugio_id: id, dia: x.dia, cerrado: x.cerrado, abre: x.abre, cierra: x.cierra });
    }
  }

  /* ======================= Contraseñas y sesiones ======================= */
  const crypto = root.crypto;
  const bytesA64 = (bytes) => { let s = ''; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); };
  const a64Bytes = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
  const b64url = (bytes) => bytesA64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  async function pbkdf2(clave, salt, iter) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256);
    return new Uint8Array(bits);
  }
  async function hashClave(clave) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return `pbkdf2$${ITERACIONES}$${bytesA64(salt)}$${bytesA64(await pbkdf2(clave, salt, ITERACIONES))}`;
  }
  async function verificarClave(clave, guardado) {
    if (typeof guardado !== 'string' || !guardado.startsWith('pbkdf2$')) return false;
    const [, iter, salt, hash] = guardado.split('$');
    const calc = bytesA64(await pbkdf2(clave, a64Bytes(salt), Number(iter)));
    return calc === hash;
  }
  async function sha256(texto) {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  const leerToken = () => { try { return root.localStorage.getItem(CLAVE_SESION); } catch { return null; } };
  const guardarToken = (t) => { try { root.localStorage.setItem(CLAVE_SESION, t); } catch { /* sin almacenamiento */ } };
  const quitarToken = () => { try { root.localStorage.removeItem(CLAVE_SESION); } catch { /* sin almacenamiento */ } };

  /* Límite de intentos en memoria (igual que el servidor anterior) */
  const contadores = new Map();
  function limitar(clave, ventanaMin, max, mensaje = 'Demasiadas solicitudes. Intente más tarde.') {
    const t = Date.now();
    let e = contadores.get(clave);
    if (!e || e.reinicia < t) { e = { n: 0, reinicia: t + ventanaMin * 60000 }; contadores.set(clave, e); }
    e.n += 1;
    if (e.n > max) falla(mensaje, 429);
  }

  /* ======================= Sesión del usuario actual ======================= */
  async function cargarSesion(w, c) {
    c.usuario = null;
    const token = leerToken();
    if (!token || token.length > 100) return;
    const th = await sha256(token);
    const s = w.sesiones.find((x) => x.token_hash === th);
    if (!s) { c.borrarToken = true; return; }
    const u = usuarioPorId(w, s.usuario_id);
    if (!u || u.estado !== 'activa') {
      w.sesiones = w.sesiones.filter((x) => x.usuario_id !== s.usuario_id);
      c.borrarToken = true;
      return;
    }
    if (s.ultima_actividad < haceMin(INACTIVIDAD_MIN)) {
      w.sesiones = w.sesiones.filter((x) => x.token_hash !== th);
      c.borrarToken = true;
      c.sesionExpirada = true;
      return;
    }
    if (!c.auto && s.ultima_actividad < haceMin(0.5)) s.ultima_actividad = ahora();
    c.usuario = { id: u.id, tipo: u.tipo, nombre: u.nombre, correo: u.correo, avatar_v: u.avatar_v };
    c.tokenHash = th;
  }

  async function crearSesion(w, c, usuarioId) {
    const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const t = ahora();
    w.sesiones.push({ token_hash: await sha256(token), usuario_id: usuarioId, creada_en: t, ultima_actividad: t, ip: null });
    c.nuevoToken = token;
  }

  const requiere = (c, ...tipos) => {
    if (!c.usuario) throw new ErrorApp(401, c.sesionExpirada ? 'Su sesión terminó por inactividad. Inicie sesión de nuevo.' : 'Inicie sesión para continuar.', { codigo: 'SESION' });
    if (tipos.length && !tipos.includes(c.usuario.tipo)) throw new ErrorApp(403, 'No tiene permiso para realizar esta acción.');
  };

  /* ======================= Notificaciones y mantenimiento ======================= */
  function mantenimiento(w) {
    w.sesiones = w.sesiones.filter((s) => s.ultima_actividad >= haceMin(30));
    w.notificaciones = w.notificaciones.filter((n) => !(n.leida === 1 && n.leida_en && n.leida_en < haceMin(30 * 24 * 60)));
    w.recuperacion_intentos = w.recuperacion_intentos.filter((x) => x.creado_en >= haceMin(24 * 60));
    w.recuperaciones = w.recuperaciones.filter((x) => x.expira_en >= haceMin(24 * 60));
    const bajas = w.usuarios.filter((u) => u.estado === 'baja' && !u.purgado && u.purgar_en && u.purgar_en <= ahora());
    for (const u of bajas) {
      Object.assign(u, { nombre: 'Cuenta dada de baja', correo: `baja-${u.id}@dopta.invalid`, hash: '!', telefono: null, avatar_v: 0, purgado: 1 });
      if (u.tipo === 'refugio') {
        Object.assign(refugioDe(w, u.id) || {}, { institucion: 'Datos eliminados', direccion: 'Datos eliminados', calle: null, num_ext: null, num_int: null, colonia: null, cp: null, telefono: '0000000000', lat: null, lng: null, place_id: null });
      }
      w.mensajes.forEach((m) => { if (m.autor_id === u.id) m.texto = '[mensaje eliminado]'; });
      w.solicitudes.forEach((s) => { if (s.adoptante_id === u.id) s.cuestionario = null; });
      w.avatares = w.avatares.filter((a) => a.usuario_id !== u.id);
      w.notificaciones = w.notificaciones.filter((n) => n.usuario_id !== u.id);
    }
    const hoyTxt = hoy();
    for (const sg of w.seguimientos) {
      if (sg.avisado || sg.realizado_en || sg.programado > hoyTxt) continue;
      const s = w.solicitudes.find((x) => x.id === sg.solicitud_id);
      const a = s && w.animales.find((x) => x.id === s.animal_id);
      if (!a) continue;
      const etapa = { '1_semana': '1 semana', '1_mes': '1 mes', '3_meses': '3 meses' }[sg.etapa];
      notificar(w, a.refugio_id, `Toca el seguimiento de ${etapa} de ${a.nombre}: contacta a la familia y registra cómo está.`, `#/refugio/solicitudes?id=${s.id}`);
      sg.avisado = 1;
    }
  }

  /* ======================= Animales: validación ======================= */
  function validarAnimal(w, d, actual = {}, refugioId = null, animalId = null) {
    const cat = catalogos(w);
    const usable = (lista, id, actualId) => lista.some((x) => x.id === id && (x.activo || x.id === actualId));
    const t = hoy();
    const fechaPasada = (f) => { if (!esFecha(f) || f > t) falla('La fecha debe ser igual o anterior a la fecha de hoy.'); return f; };

    const nombre = V.nombrePerro(d.nombre);
    const raza = V.raza(d.raza, w);
    const razaAprox = raza === 'mestizo' ? V.razaAprox(d.raza_aprox) : null;
    const edadId = Number(d.edad_id);
    if (!usable(cat.edad, edadId, actual.edad_id)) falla('Seleccione la edad del animal.');
    const tamanoId = tamanoDeRaza(raza, cat.tamano) || Number(d.tamano_id);
    if (!usable(cat.tamano, tamanoId, actual.tamano_id)) falla('Seleccione el tamaño del animal.');
    const cerrados = {};
    for (const c of CAMPOS_ANIMAL) {
      const v = typeof d[c] === 'string' ? d[c] : '';
      if (!Object.prototype.hasOwnProperty.call(OPCIONES_ANIMAL[c].opciones, v)) falla(`Seleccione una opción en “${OPCIONES_ANIMAL[c].titulo}”.`);
      cerrados[c] = v;
    }
    const fechaIngreso = fechaPasada(d.fecha_ingreso);
    const dims = V.dimensiones(d, raza, (cat.tamano.find((x) => x.id === tamanoId) || {}).nombre, (cat.edad.find((x) => x.id === edadId) || {}).nombre);

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
    if (refugioId) {
      const dup = w.animales.find((a) => a.refugio_id === refugioId && !a.eliminado && a.estado === 'disponible'
        && a.nombre.toLowerCase() === nombre.toLowerCase() && a.raza === raza && a.id !== (animalId || 0));
      if (dup) falla(`Ya tienes publicado a un perro disponible llamado ${nombre} con la misma raza. Edita esa publicación en lugar de crear otra.`, 409);
    }
    return { nombre, raza, razaAprox, edadId, tamanoId, cerrados, fechaIngreso, requisitos, vacunas, esterilizado, fechaEst, desparasitado, dims };
  }

  function tamanoDeRaza(raza, catTamano) {
    const r = ESTATICO.razas.find((x) => x.id === raza);
    if (!r || !r.tamano) return null;
    const t = catTamano.find((x) => x.activo && sinAcentos(x.nombre) === sinAcentos(r.tamano));
    return t ? t.id : null;
  }

  function guardarDetalle(w, id, v) {
    w.requisitos = w.requisitos.filter((x) => x.animal_id !== id);
    w.vacunas = w.vacunas.filter((x) => x.animal_id !== id);
    for (const x of v.requisitos) insertar(w, 'requisitos', { animal_id: id, nombre: x.nombre, tipo_id: x.tipo_id, otro: x.otro });
    for (const x of v.vacunas) insertar(w, 'vacunas', { animal_id: id, nombre: x.nombre, fecha: x.fecha });
  }

  function propio(w, c, id) {
    const a = w.animales.find((x) => x.id === id && !x.eliminado);
    if (!a) falla('La publicación no existe.', 404);
    if (a.refugio_id !== c.usuario.id) falla('No tiene permiso para editar la publicación.', 403);
    return a;
  }

  /* ======================= Protocolo de adopción ======================= */
  const OPCIONES_SOL = {
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
    const opcion = (k, titulo) => (Object.prototype.hasOwnProperty.call(OPCIONES_SOL[k], c[k]) ? c[k] : falla(`Responde: ${titulo}.`));
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

  function resumenCuestionario(c) {
    if (!c) return null;
    return [
      ['Vivienda', `${OPCIONES_SOL.vivienda[c.vivienda]} ${OPCIONES_SOL.tenencia[c.tenencia].toLowerCase()}${c.permiso ? ' (con permiso del arrendador)' : ''}`],
      ['Espacio para el perro', OPCIONES_SOL.espacio[c.espacio]],
      ['Personas en casa', `${c.habitantes}${c.ninos === 'si' ? ', con niñas o niños' : ''} · todas de acuerdo`],
      ['Otras mascotas', OPCIONES_SOL.mascotas[c.mascotas]],
      ['Experiencia', OPCIONES_SOL.experiencia[c.experiencia]],
      ['Horas solo al día', String(c.horas_solo)],
      ['¿Por qué quiere adoptar?', c.motivo],
    ];
  }

  const puedeEscribir = (s) => (s.estado === 'pendiente' || s.estado === 'aprobada') && (!s.concretada_en || String(s.concretada_en) >= sumarDias(hoy(), -90));

  /* Mensajes y seguimientos de varias solicitudes */
  function adjuntar(w, lista, yoId) {
    return lista.map((s) => {
      const mensajes = w.mensajes.filter((m) => m.solicitud_id === s.id).sort((a, b) => a.id - b.id).map((m) => {
        const autor = usuarioPorId(w, m.autor_id) || {};
        return {
          id: m.id, solicitud_id: m.solicitud_id, autor_id: m.autor_id, texto: m.texto, creado: String(m.creado_en).slice(0, 16),
          leido: m.leido_en != null, autor_tipo: autor.tipo, mio: m.autor_id === yoId, es_adoptante: m.autor_id === s.adoptante_id,
        };
      });
      const sinLeer = mensajes.filter((m) => !m.mio && !m.leido).length;
      const seguimientos = w.seguimientos.filter((x) => x.solicitud_id === s.id).sort((a, b) => (a.programado < b.programado ? -1 : a.programado > b.programado ? 1 : 0))
        .map((x) => ({ id: x.id, solicitud_id: x.solicitud_id, etapa: x.etapa, programado: x.programado, realizado_en: x.realizado_en, resultado: x.resultado, notas: x.notas }));
      return { ...s, mensajes, sin_leer: sinLeer, seguimientos, resumen: resumenCuestionario(s.cuestionario), puede_escribir: puedeEscribir(s) };
    });
  }

  /* Lista de entrega (protocolo CDMX, art. 32) */
  function validarEntrega(e, animal) {
    const d = e && typeof e === 'object' ? e : {};
    const si = (k) => d[k] === true;
    if (!si('carta_firmada')) falla('Para entregar al perro, el adoptante debe firmar la carta compromiso de adopción.');
    if (!si('desparasitado')) falla('El perro debe entregarse desparasitado.');
    if (!si('cartilla')) falla('Entrega la cartilla de vacunación (o el registro de vacunas) al adoptante.');
    const meses = Reglas.mesesDeEdad(animal.edad);
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

  function cerrarPendientes(w, animal) {
    const pend = w.solicitudes.filter((s) => s.animal_id === animal.id && (s.estado === 'pendiente' || (s.estado === 'aprobada' && !s.concretada_en)));
    const t = ahora();
    for (const s of pend) {
      Object.assign(s, { estado: 'rechazada', motivo_rechazo: 'El animal ya fue adoptado', rechazada_en: t });
      w.citas = w.citas.filter((c) => c.solicitud_id !== s.id);
      notificar(w, s.adoptante_id, `Su solicitud para ${animal.nombre} fue rechazada: el animal ya fue adoptado.`, `#/solicitudes?id=${s.id}`);
    }
    return pend.length;
  }

  function marcarAdopcion(w, s, fecha, entrega) {
    if (s.estado !== 'aprobada' || s.concretada_en) falla('No hay una solicitud aprobada para el animal.', 409);
    const animal = w.animales.find((a) => a.id === s.animal_id);
    if (!animal || animal.estado === 'adoptado' || animal.eliminado) falla('El animal ya no está disponible para adopción.', 409);
    if (!s.visita) falla('Antes de entregar, registra la visita domiciliaria (realizada o no requerida) en la solicitud.', 409);
    if (!esFecha(fecha) || fecha > hoy() || fecha < String(s.aprobada_en).slice(0, 10)) {
      falla('La fecha de concreción debe estar entre la fecha de aprobación y hoy.');
    }
    const edad = (valorCat(w, animal.edad_id) || {}).nombre;
    const lista = validarEntrega(entrega, { esterilizado: animal.esterilizado, edad });
    Object.assign(animal, { estado: 'adoptado', adoptado_en: fecha, actualizado_en: ahora(), esterilizado: lista.esterilizado ? 1 : 0, desparasitado: 1 });
    Object.assign(s, { concretada_en: fecha, entrega: lista });
    for (const [etapa, dias] of [['1_semana', 7], ['1_mes', 30], ['3_meses', 90]]) {
      if (!w.seguimientos.some((x) => x.solicitud_id === s.id && x.etapa === etapa)) {
        insertar(w, 'seguimientos', { solicitud_id: s.id, etapa, programado: sumarDias(fecha, dias), realizado_en: null, resultado: null, notas: null, avisado: 0 });
      }
    }
    notificar(w, s.adoptante_id, `¡Felicidades! La adopción de ${animal.nombre} quedó concretada el ${fecha}. El refugio te contactará para el seguimiento.`, `#/solicitudes?id=${s.id}`);
    return cerrarPendientes(w, { id: animal.id, nombre: animal.nombre });
  }

  /* ======================= Cambios de datos del refugio (aprobación del Administrador) ======================= */
  const CAMPOS_REFUGIO = ['institucion', 'direccion', 'calle', 'num_ext', 'num_int', 'colonia', 'cp', 'telefono', 'alcaldia_id', 'lat', 'lng', 'place_id'];
  const ETIQUETAS = { nombre: 'Nombre', institucion: 'Institución', direccion: 'Dirección', telefono: 'Teléfono', horario: 'Horario' };
  const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  function actualesRefugio(w, id) {
    const u = usuarioPorId(w, id);
    const rf = refugioDe(w, id) || {};
    return {
      nombre: u.nombre, institucion: rf.institucion, direccion: rf.direccion, calle: rf.calle, num_ext: rf.num_ext, num_int: rf.num_int,
      colonia: rf.colonia, cp: rf.cp, telefono: rf.telefono, alcaldia_id: rf.alcaldia_id, lat: rf.lat ?? null, lng: rf.lng ?? null, place_id: rf.place_id ?? null,
      horario: horarioDe(w, id),
    };
  }
  function solicitarCambioRefugio(w, usuario, nuevos) {
    const ant = actualesRefugio(w, usuario.id);
    const pendiente = w.refugio_cambios.find((x) => x.refugio_id === usuario.id && x.estado === 'pendiente');
    const datos = { ...(pendiente ? pendiente.datos : {}) };
    for (const [k, v] of Object.entries(nuevos)) {
      if (igual(v, ant[k])) delete datos[k]; else datos[k] = v;
    }
    if (['direccion', 'calle', 'num_ext', 'num_int', 'colonia', 'cp', 'alcaldia_id'].some((k) => k in datos)) {
      for (const k of ['direccion', 'calle', 'num_ext', 'num_int', 'colonia', 'cp', 'alcaldia_id', 'lat', 'lng', 'place_id']) if (k in nuevos) datos[k] = nuevos[k];
    }
    if (!Object.keys(datos).length) {
      if (pendiente) Object.assign(pendiente, { estado: 'cancelado', revisado_en: ahora() });
      return { mensaje: pendiente ? 'Se canceló el cambio pendiente: tus datos quedan como estaban.' : 'No hay cambios que guardar.', pendiente: false };
    }
    const anteriores = Object.fromEntries(Object.keys(datos).map((k) => [k, ant[k] ?? null]));
    if (pendiente) Object.assign(pendiente, { datos, anteriores, creado_en: ahora() });
    else insertar(w, 'refugio_cambios', { refugio_id: usuario.id, datos, anteriores, estado: 'pendiente', motivo: null, revisor_id: null, creado_en: ahora(), revisado_en: null });
    const admin = w.usuarios.find((u) => u.tipo === 'admin' && u.estado === 'activa');
    if (admin && !pendiente) notificar(w, admin.id, `${usuario.nombre} pidió cambiar sus datos de refugio. Revísalo antes de aplicarlo.`, '#/admin/refugios?vista=cambios');
    const campos = [...new Set(Object.keys(datos).map((k) => ETIQUETAS[k] || 'Dirección'))].join(', ');
    return { mensaje: `Cambio enviado (${campos}). Se aplicará cuando el Administrador lo apruebe; mientras, se muestran tus datos actuales.`, pendiente: true };
  }
  function aplicarCambio(w, cambio) {
    const d = cambio.datos;
    if ('nombre' in d) Object.assign(usuarioPorId(w, cambio.refugio_id), { nombre: d.nombre });
    const sets = CAMPOS_REFUGIO.filter((k) => k in d);
    if (sets.length) { const rf = refugioDe(w, cambio.refugio_id); for (const k of sets) rf[k] = d[k]; }
    if (Array.isArray(d.horario)) {
      for (const x of d.horario) {
        const fila = w.refugio_horarios.find((h) => h.refugio_id === cambio.refugio_id && h.dia === x.dia);
        if (fila) Object.assign(fila, { cerrado: x.cerrado, abre: x.abre, cierra: x.cierra });
        else w.refugio_horarios.push({ refugio_id: cambio.refugio_id, dia: x.dia, cerrado: x.cerrado, abre: x.abre, cierra: x.cierra });
      }
    }
  }
  function decidirCambio(w, c, id, aprobar, motivo) {
    const cambio = w.refugio_cambios.find((x) => x.id === id && x.estado === 'pendiente');
    if (!cambio) falla('El cambio ya fue revisado o no existe.', 404);
    if (aprobar) aplicarCambio(w, cambio);
    Object.assign(cambio, { estado: aprobar ? 'aprobado' : 'rechazado', motivo: aprobar ? null : motivo, revisor_id: c.usuario.id, revisado_en: ahora() });
    notificar(w, cambio.refugio_id, aprobar
      ? 'El Administrador aprobó el cambio de tus datos de refugio: ya se muestran los nuevos.'
      : `El Administrador no aprobó el cambio de tus datos de refugio: ${motivo}`, '#/refugio/perfil');
  }

  /* ======================= Enlace a mapas (sin clave: solo búsqueda) ======================= */
  function mapa(x) {
    const texto = [x.institucion || x.nombre, x.direccion, x.alcaldia, 'Ciudad de México'].filter(Boolean).join(', ');
    const base = 'https://www.google.com/maps/search/?api=1';
    const ver = `${base}&query=${encodeURIComponent(texto)}${x.place_id ? `&query_place_id=${encodeURIComponent(x.place_id)}` : ''}`;
    return {
      consulta: texto,
      url: ver,
      soloDireccion: `${base}&query=${encodeURIComponent([x.direccion, 'Ciudad de México'].filter(Boolean).join(', '))}`,
      embed: null,
    };
  }

  /* ======================= Estadísticas ======================= */
  function generales(w, query) {
    const p = periodo(query);
    const dias = diasEntre(p.inicio, p.fin) + 1;
    const porMes = dias > 62;
    const clave = (f) => (porMes ? String(f).slice(0, 7) : String(f).slice(0, 10));
    const enRango = (f) => f && f >= p.inicio && f <= p.fin;
    const animales = w.animales;
    const pub = animales.filter((a) => enRango(a.fecha_ingreso));
    const ado = animales.filter((a) => a.estado === 'adoptado' && enRango(a.adoptado_en));
    const d10 = (f) => (f ? String(f).slice(0, 10) : '');
    const refs = w.usuarios.filter((u) => u.tipo === 'refugio' && u.verificado_en && d10(u.verificado_en) <= p.fin
      && (u.estado === 'activa' || (u.estado === 'baja' && d10(u.baja_en) >= p.inicio)
        || (u.estado === 'eliminada' && d10(u.eliminado_en) >= p.inicio)));
    const sols = w.solicitudes.filter((s) => enRango(String(s.enviada_en).slice(0, 10)));
    const reps = w.reportes.filter((r) => enRango(String(r.creado_en).slice(0, 10)));
    const claves = [];
    for (let d = p.inicio; d <= p.fin; d = sumarDias(d, 1)) { const k = porMes ? d.slice(0, 7) : d; if (claves[claves.length - 1] !== k) claves.push(k); }
    const serie = (lista, fn) => { const m = {}; lista.forEach((x) => { const k = clave(fn(x)); m[k] = (m[k] || 0) + 1; }); return claves.map((k) => m[k] || 0); };
    const estados = {};
    sols.forEach((s) => { const e = s.concretada_en ? 'concretada' : s.estado; estados[e] = (estados[e] || 0) + 1; });
    const totalSol = sols.length;
    const decididas = (estados.aprobada || 0) + (estados.concretada || 0) + (estados.rechazada || 0);
    const diasProm = (lista) => (lista.length ? Math.round(lista.reduce((a, x) => a + diasEntre(x.fecha_ingreso, x.adoptado_en), 0) / lista.length) : null);
    const porRef = {};
    ado.forEach((a) => { const n = (usuarioPorId(w, a.refugio_id) || {}).nombre; porRef[n] = (porRef[n] || 0) + 1; });
    const topRef = Object.entries(porRef).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n).slice(0, 5);
    const porTam = w.catalogo_valores.filter((v) => v.catalogo === 'tamano').sort((a, b) => a.orden - b.orden).map((t) => ({
      nombre: t.nombre,
      adoptados: ado.filter((a) => a.tamano_id === t.id).length,
      disponibles: animales.filter((a) => a.tamano_id === t.id && a.estado === 'disponible' && !a.eliminado).length,
    }));
    const porAlc = {};
    w.refugios.forEach((rf) => {
      const u = usuarioPorId(w, rf.usuario_id);
      if (!u || u.tipo !== 'refugio' || u.estado !== 'activa' || !rf.alcaldia_id) return;
      const n = alcaldiaDe(w, rf);
      porAlc[n] = (porAlc[n] || 0) + 1;
    });
    const refugiosAlc = Object.entries(porAlc).map(([nombre, n]) => ({ nombre, n })).sort((a, b) => b.n - a.n);
    const pubPorDia = pub.length;
    void pubPorDia;
    return {
      ...p,
      animales_publicados: pub.length,
      adopciones_concretadas: ado.length,
      refugios_activos: refs.length,
      solicitudes: totalSol,
      reportes: reps.length,
      dias_promedio_adopcion: diasProm(ado),
      tasa_aprobacion: decididas ? Math.round((((estados.aprobada || 0) + (estados.concretada || 0)) / decididas) * 100) : null,
      agrupado: porMes ? 'mes' : 'dia',
      serie: {
        claves,
        ingresos: serie(pub, (a) => a.fecha_ingreso),
        adopciones: serie(ado, (a) => a.adoptado_en),
        solicitudes: serie(sols, (s) => String(s.enviada_en).slice(0, 10)),
      },
      solicitudes_por_estado: estados,
      top_refugios: topRef,
      por_tamano: porTam,
      refugios_por_alcaldia: refugiosAlc,
    };
  }

  /* ======================= Imágenes ======================= */
  function tipoImagen(bytes) {
    const b = bytes;
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
    if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
    return null;
  }
  const TIPO_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  /* ======================= Rutas ======================= */
  const RUTAS = [];
  function ruta(metodo, patron, fn) {
    const nombres = [];
    const re = new RegExp(`^${patron.replace(/:(\w+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; })}$`);
    RUTAS.push({ metodo, re, nombres, fn });
  }
  const G = (p, f) => ruta('GET', p, f);
  const P = (p, f) => ruta('POST', p, f);
  const PUT = (p, f) => ruta('PUT', p, f);
  const DEL = (p, f) => ruta('DELETE', p, f);

  const soloAdmin = (c) => requiere(c, 'admin');
  const adminOFuncionario = (c) => requiere(c, 'admin', 'funcionario');
  const soloRefugio = (c) => requiere(c, 'refugio');
  const adoptantes = (c) => requiere(c, 'adoptante', 'refugio');

  /* --- Sistema --- */
  G('/version', (c, w) => ({ version: '2.0.0', bd: true }));

  /* --- Catálogos y listas públicas --- */
  G('/catalogos', (c, w) => ({ ...catalogos(w), animal: OPCIONES_ANIMAL, dims: DIMS() }));

  function filasAnimalesPublicos(w, q) {
    const pagina = V.pagina(q.pagina);
    const texto = limpiar(q.q).slice(0, 60);
    const f = q;
    const activos = (a) => {
      const rf = refugioDe(w, a.refugio_id);
      const u = usuarioPorId(w, a.refugio_id);
      return !a.eliminado && a.estado === 'disponible' && u && u.estado === 'activa' && rf;
    };
    let lista = w.animales.filter(activos);
    if (texto) {
      const n = normalizar(texto);
      const razas = ESTATICO.razas.filter((x) => normalizar(x.nombre).includes(n)).map((x) => x.id);
      if ('mestizo'.includes(n)) razas.push('mestizo');
      lista = lista.filter((a) => {
        const u = usuarioPorId(w, a.refugio_id);
        return sinAcentos(a.nombre).includes(n) || sinAcentos(u.nombre).includes(n)
          || razas.includes(a.raza) || razas.includes(a.raza_aprox);
      });
    }
    if (f.tamano) { const id = V.id(f.tamano); lista = lista.filter((a) => a.tamano_id === id); }
    if (f.raza) { const r = limpiar(f.raza); lista = lista.filter((a) => a.raza === r || a.raza_aprox === r); }
    if (f.alcaldia) { const id = V.id(f.alcaldia); lista = lista.filter((a) => (refugioDe(w, a.refugio_id) || {}).alcaldia_id === id); }
    if (f.refugio) { const id = V.id(f.refugio); lista = lista.filter((a) => a.refugio_id === id); }
    if (GRUPOS_EDAD[f.edad]) {
      const ids = catalogos(w).edad.filter((e) => { const m = Reglas.mesesDeEdad(e.nombre); return m != null && GRUPOS_EDAD[f.edad](m); }).map((e) => e.id);
      lista = lista.filter((a) => ids.includes(a.edad_id));
    }
    if (f.esterilizado === '1') lista = lista.filter((a) => a.esterilizado === 1);
    if (f.vacunado === '1') lista = lista.filter((a) => w.vacunas.some((v) => v.animal_id === a.id));
    if (f.perros === '1') lista = lista.filter((a) => a.temp_perros === 'sociable');
    if (f.desconocidos === '1') lista = lista.filter((a) => a.temp_desconocidos === 'amigable');
    if (f.sin_tratamiento === '1') lista = lista.filter((a) => a.tratamiento === 'no');
    if (f.energia && OPCIONES_ANIMAL.temp_general.opciones[f.energia]) lista = lista.filter((a) => a.temp_general === f.energia);
    const orden = f.orden;
    const cmp = (x, y, campo, dir) => (x[campo] < y[campo] ? -dir : x[campo] > y[campo] ? dir : 0);
    if (orden === 'esperando') lista.sort((x, y) => cmp(x, y, 'fecha_ingreso', 1) || cmp(x, y, 'id', 1));
    else if (orden === 'nombre') lista.sort((x, y) => cmp(x, y, 'nombre', 1) || cmp(x, y, 'id', 1));
    else lista.sort((x, y) => cmp(x, y, 'publicado_en', -1) || cmp(x, y, 'id', -1));
    return { pagina, lista };
  }

  G('/animales', (c, w) => {
    const { pagina, lista } = filasAnimalesPublicos(w, c.query);
    return { total: lista.length, pagina, porPagina: POR_PAGINA, animales: lista.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA).map((a) => tarjeta(w, a)) };
  });

  function detalleRefugio(w, id) {
    const u = usuarioPorId(w, id);
    const rf = refugioDe(w, id);
    if (!u || u.tipo !== 'refugio' || u.estado !== 'activa' || !rf) return null;
    return { id: u.id, nombre: u.nombre, verificado: u.verificado_en ? String(u.verificado_en).slice(0, 10) : null, institucion: rf.institucion, direccion: rf.direccion, telefono: rf.telefono, lat: rf.lat ?? null, lng: rf.lng ?? null, place_id: rf.place_id, alcaldia: alcaldiaDe(w, rf) };
  }

  G('/refugios', (c, w) => {
    const texto = limpiar(c.query.q).slice(0, 60);
    const n = normalizar(texto);
    const lista = w.refugios.map((rf) => ({ rf, u: usuarioPorId(w, rf.usuario_id) }))
      .filter(({ u }) => u && u.tipo === 'refugio' && u.estado === 'activa')
      .filter(({ rf, u }) => !texto || sinAcentos(u.nombre).includes(n) || sinAcentos(rf.institucion).includes(n) || sinAcentos(alcaldiaDe(w, rf) || '').includes(n))
      .map(({ rf, u }) => {
        const disp = w.animales.filter((a) => a.refugio_id === u.id && !a.eliminado && a.estado === 'disponible').length;
        const ado = w.animales.filter((a) => a.refugio_id === u.id && !a.eliminado && a.estado === 'adoptado').length;
        const alc = alcaldiaDe(w, rf);
        const cent = rf.lat == null && alc ? CENTRO_ALCALDIA[sinAcentos(alc)] : null;
        return {
          id: u.id, nombre: u.nombre, institucion: rf.institucion, alcaldia: alc, rf_lat: rf.lat,
          lat: cent ? cent[0] : rf.lat == null ? null : Number(rf.lat), lng: cent ? cent[1] : rf.lng == null ? null : Number(rf.lng),
          disponibles: disp, adoptados: ado, aprox: !!cent,
        };
      })
      .sort((a, b) => (b.disponibles - a.disponibles) || (a.nombre < b.nombre ? -1 : a.nombre > b.nombre ? 1 : 0))
      .slice(0, 60);
    return lista.map(({ rf_lat, ...x }) => x);
  });

  G('/refugios/:id', (c, w) => {
    const id = V.id(c.params.id);
    const p = detalleRefugio(w, id);
    if (!p) falla('El refugio no existe o ya no está activo.', 404);
    p.horario = horarioDe(w, id);
    p.animales = w.animales.filter((a) => a.refugio_id === id && !a.eliminado && a.estado === 'disponible')
      .sort((x, y) => (x.publicado_en < y.publicado_en ? 1 : x.publicado_en > y.publicado_en ? -1 : y.id - x.id)).map((a) => tarjeta(w, a));
    p.adoptados = w.animales.filter((a) => a.refugio_id === id && !a.eliminado && a.estado === 'adoptado').length;
    return p;
  });

  G('/animales/:id', (c, w) => {
    const id = V.id(c.params.id);
    const a = w.animales.find((x) => x.id === id);
    const u = a && usuarioPorId(w, a.refugio_id);
    const rf = a && refugioDe(w, a.refugio_id);
    if (!a || !u || !rf || a.eliminado || u.estado !== 'activa') falla('La publicación ya no existe.', 404);
    const edad = valorCat(w, a.edad_id) || {};
    const tam = valorCat(w, a.tamano_id) || {};
    const out = {
      id: a.id, refugio_id: a.refugio_id, nombre: a.nombre, raza: a.raza, raza_aprox: a.raza_aprox, estado: a.estado,
      salud: a.salud, temperamento: a.temperamento, salud_general: a.salud_general, tratamiento: a.tratamiento,
      temp_general: a.temp_general, temp_perros: a.temp_perros, temp_desconocidos: a.temp_desconocidos, temp_comida: a.temp_comida,
      fecha_ingreso: a.fecha_ingreso, esterilizado: a.esterilizado, fecha_esterilizacion: a.fecha_esterilizacion,
      publicado_en: a.publicado_en, adoptado_en: a.adoptado_en, peso_kg: a.peso_kg == null ? null : Number(a.peso_kg), altura_cm: a.altura_cm,
      edad: edad.nombre, tamano: tam.nombre, refugio: u.nombre, institucion: rf.institucion, direccion: rf.direccion,
      telefono: rf.telefono, lat: rf.lat ?? null, lng: rf.lng ?? null, place_id: rf.place_id, alcaldia: alcaldiaDe(w, rf),
    };
    out.requisitos = w.requisitos.filter((r) => r.animal_id === id).sort((x, y) => x.id - y.id)
      .map((r) => ({ nombre: r.nombre, tipo: (valorCat(w, r.tipo_id) || {}).nombre }));
    out.vacunas = w.vacunas.filter((v) => v.animal_id === id).sort((x, y) => (x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : 0))
      .map((v) => ({ nombre: v.nombre, fecha: v.fecha }));
    out.horario = horarioDe(w, a.refugio_id);
    const adopta = c.usuario && (c.usuario.tipo === 'adoptante' || (c.usuario.tipo === 'refugio' && c.usuario.id !== a.refugio_id));
    if (adopta) {
      const s = w.solicitudes.find((x) => x.animal_id === id && x.adoptante_id === c.usuario.id && ['pendiente', 'aprobada'].includes(x.estado));
      out.miSolicitud = s ? { id: s.id, estado: s.estado } : null;
    }
    out.puedeSolicitar = !c.usuario || !!adopta;
    out.esMio = !!(c.usuario && c.usuario.id === a.refugio_id);
    return out;
  });

  /* --- Lugares: sin clave de Google en el navegador (la dirección se escribe a mano) --- */
  G('/lugares/estado', () => ({ activo: false }));
  G('/lugares/cp/:cp', (c, w) => {
    const cp = String(c.params.cp || '');
    if (!/^\d{5}$/.test(cp)) falla('El código postal debe tener exactamente 5 dígitos.');
    const d = ESTATICO.cp[cp];
    if (!d) falla(`El código postal ${cp} no existe en la Ciudad de México.`, 404);
    const alc = w.catalogo_valores.find((x) => x.catalogo === 'alcaldia' && sinAcentos(x.nombre) === sinAcentos(d.a));
    return { cp, alcaldia: d.a, alcaldia_id: alc ? alc.id : null, colonias: d.c.map(([nombre, tipo]) => ({ nombre, tipo })) };
  });
  P('/lugares/calles', () => ({ calles: [], activo: false }));
  P('/lugares/sugerencias', () => ({ sugerencias: [], activo: false }));
  P('/lugares/detalle', () => falla('El autocompletado de direcciones no está disponible.', 503));
  P('/lugares/inversa', () => falla('La ubicación automática no está disponible.', 503));

  /* --- Cuentas y acceso --- */
  P('/auth/registro', async (c, w) => {
    const b = c.body || {};
    const tipo = b.tipo === 'refugio' ? 'refugio' : b.tipo === 'adoptante' ? 'adoptante' : null;
    const vacio = (...v) => v.some((x) => typeof x !== 'string' || !x.trim());
    if (!tipo || vacio(b.nombre, b.correo, b.contrasena)) falla('Complete todos los campos obligatorios.');
    if (b.aviso !== true) falla('Debe aceptar el aviso de privacidad para crear una cuenta.');
    limitar(`registro|${c.ip}`, 60, 10, 'Demasiados registros desde esta conexión. Intente más tarde.');
    const nombre = tipo === 'adoptante' ? V.nombrePersona(b.nombre) : V.nombreRefugio(b.nombre);
    const mail = V.correo(b.correo);
    const pass = V.contrasena(b.contrasena);
    if (typeof b.confirmar === 'string' && b.confirmar !== pass) falla('Las contraseñas no coinciden.');
    if (tipo === 'adoptante' && b.mayor_edad !== true) falla('Para adoptar debes ser mayor de 18 años. Confirma la casilla de mayoría de edad.');
    if (w.usuarios.some((u) => u.correo === mail && !['baja', 'eliminada'].includes(u.estado))) falla('El correo electrónico ya está registrado.', 409);
    const inst = tipo === 'refugio' ? validarRefugio(w, b) : null;
    const telefono = tipo === 'adoptante' ? V.telefonoLibre(V.telefono(b.telefono), 0, w) : null;
    const t = ahora();
    const u = insertar(w, 'usuarios', {
      tipo, nombre, correo: mail, telefono, hash: await hashClave(pass), estado: tipo === 'refugio' ? 'pendiente' : 'activa',
      aviso_version: AVISO_VERSION, aviso_fecha: `${t.slice(0, 16)}:00`, creado: t, verificado_en: null, rechazado_en: null, baja_en: null,
      purgar_en: null, purgado: 0, eliminado_motivo: null, eliminado_en: null, mayor_edad_en: tipo === 'adoptante' ? t : null, avatar_v: 0,
    });
    if (inst) guardarRefugio(w, u.id, inst, true);
    c.status = 201;
    return { mensaje: tipo === 'refugio' ? 'Registro recibido. La cuenta se verificará antes de publicar animales.' : 'Cuenta creada' };
  });

  P('/auth/revalidar', async (c, w) => {
    const b = c.body || {};
    if (!b.correo || !b.contrasena || !b.nombre) falla('Complete todos los campos obligatorios.');
    limitar(`login|${String(b.correo).toLowerCase()}`, 15, 10, 'Demasiados intentos de inicio de sesión. Espere 15 minutos.');
    const mail = V.correo(b.correo);
    const u = w.usuarios.find((x) => x.correo === mail && !['baja', 'eliminada'].includes(x.estado));
    const ok = u ? await verificarClave(String(b.contrasena), u.hash) : false;
    if (!u || !ok || u.tipo !== 'refugio' || u.estado !== 'rechazada') falla('Correo o contraseña incorrectos.', 401);
    const nombre = V.nombreRefugio(b.nombre);
    const inst = validarRefugio(w, b, u.id);
    Object.assign(u, { nombre, estado: 'pendiente', creado: ahora(), rechazado_en: null });
    guardarRefugio(w, u.id, inst, false);
    return { mensaje: 'Registro recibido. La cuenta se verificará antes de publicar animales.' };
  });

  P('/auth/login', async (c, w) => {
    const b = c.body || {};
    const mail = limpiar(b.correo).toLowerCase();
    const pass = typeof b.contrasena === 'string' ? b.contrasena : '';
    if (!mail || mail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || pass.length < 8 || pass.length > 64) {
      falla('Complete los campos con un formato válido.');
    }
    limitar(`login|${mail}`, 15, 10, 'Demasiados intentos de inicio de sesión. Espere 15 minutos.');
    const u = w.usuarios.find((x) => x.correo === mail && !['baja', 'eliminada'].includes(x.estado));
    const ok = u ? await verificarClave(pass, u.hash) : false;
    if (!u || !ok) falla('Correo o contraseña incorrectos.', 401);
    if (u.estado === 'pendiente') falla('Su cuenta está pendiente de verificación.', 403);
    if (u.estado === 'rechazada') falla('Su cuenta no fue verificada. Vuelva a enviar su solicitud de validación.', 403, { codigo: 'RECHAZADA' });
    w.sesiones = w.sesiones.filter((s) => s.usuario_id !== u.id);
    await crearSesion(w, c, u.id);
    return { usuario: { id: u.id, tipo: u.tipo, nombre: u.nombre, correo: u.correo, avatar_v: u.avatar_v }, panel: PANEL[u.tipo] };
  });

  const PANEL = { adoptante: '#/', refugio: '#/refugio', admin: '#/admin', funcionario: '#/admin' };

  P('/auth/logout', async (c, w) => {
    const token = leerToken();
    if (token) { const th = await sha256(token); w.sesiones = w.sesiones.filter((s) => s.token_hash !== th); }
    c.borrarToken = true;
    return { mensaje: 'Sesión cerrada.' };
  });

  G('/auth/yo', (c, w) => {
    if (!c.usuario) return { usuario: null, expirada: !!c.sesionExpirada };
    const noLeidas = w.notificaciones.filter((n) => n.usuario_id === c.usuario.id && n.leida === 0).length;
    return { usuario: c.usuario, panel: PANEL[c.usuario.tipo], noLeidas };
  });

  P('/auth/recuperar', async (c, w) => {
    const mail = V.correo((c.body || {}).correo);
    limitar(`recup|${mail}`, 60, 3, 'Ha alcanzado el límite de 3 solicitudes por hora. Intente más tarde.');
    w.recuperacion_intentos.push({ correo: mail, creado_en: ahora() });
    const u = w.usuarios.find((x) => x.correo === mail && x.estado === 'activa');
    const res = { mensaje: 'Si el correo existe, recibirá un enlace en unos minutos.' };
    if (u) {
      const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
      w.recuperaciones.push({ token_hash: await sha256(token), usuario_id: u.id, expira_en: enMin(30), usado_en: null });
      // Sin servidor de correo: el enlace se entrega en pantalla (no se envía por correo)
      res.enlace = `${location.origin}${location.pathname}#/restablecer?token=${token}`;
    }
    return res;
  });

  async function tokenValido(w, token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) falla('El enlace no es válido. Solicite uno nuevo.');
    const th = await sha256(token);
    const t = w.recuperaciones.find((x) => x.token_hash === th);
    if (!t) falla('El enlace no es válido. Solicite uno nuevo.');
    if (t.usado_en) falla('El enlace ya fue utilizado. Solicite uno nuevo.', 410);
    if (t.expira_en < ahora()) falla('El enlace expiró. Solicite uno nuevo.', 410);
    return t;
  }

  P('/auth/recuperar/verificar', async (c, w) => { await tokenValido(w, (c.body || {}).token); return { valido: true }; });

  P('/auth/restablecer', async (c, w) => {
    const b = c.body || {};
    const pass = V.contrasena(b.contrasena);
    const t = await tokenValido(w, b.token);
    const u = usuarioPorId(w, t.usuario_id);
    if (await verificarClave(pass, u.hash)) falla('La nueva contraseña debe ser distinta a la que ya tenías.');
    u.hash = await hashClave(pass);
    t.usado_en = ahora();
    w.sesiones = w.sesiones.filter((s) => s.usuario_id !== u.id);
    return { mensaje: 'Contraseña actualizada. Inicie sesión con su nueva contraseña.' };
  });

  G('/cuenta', (c, w) => {
    requiere(c);
    const u = usuarioPorId(w, c.usuario.id);
    const out = { id: u.id, tipo: u.tipo, nombre: u.nombre, correo: u.correo, telefono: u.telefono, creado: u.creado, aviso_version: u.aviso_version, avatar_v: u.avatar_v, mayor_edad: !!u.mayor_edad_en };
    if (u.tipo === 'refugio') {
      const rf = refugioDe(w, u.id);
      out.refugio = rf ? { institucion: rf.institucion } : null;
      const pend = w.refugio_cambios.find((x) => x.refugio_id === u.id && x.estado === 'pendiente');
      out.cambio_pendiente = pend ? { id: pend.id, datos: pend.datos, creado_en: String(pend.creado_en).slice(0, 16) } : null;
    }
    return out;
  });

  PUT('/cuenta/nombre', (c, w) => {
    requiere(c, 'adoptante', 'refugio');
    const b = c.body || {};
    const msg = 'El nombre debe tener de 2 a 100 caracteres, o de 3 a 120 caracteres para una institución.';
    const u = usuarioPorId(w, c.usuario.id);
    if (u.tipo === 'adoptante') {
      let n;
      try { n = V.nombrePersona(b.nombre); } catch { falla(msg); }
      u.nombre = n;
      return { mensaje: 'Datos actualizados.' };
    }
    const n = V.nombreRefugio(b.nombre, msg);
    const i = V.nombreRefugio(b.institucion, msg);
    return solicitarCambioRefugio(w, c.usuario, { nombre: n, institucion: i });
  });

  PUT('/cuenta/telefono', (c, w) => {
    requiere(c, 'adoptante');
    const tel = V.telefonoLibre(V.telefono((c.body || {}).telefono), c.usuario.id, w);
    usuarioPorId(w, c.usuario.id).telefono = tel;
    return { mensaje: 'Teléfono actualizado.' };
  });

  PUT('/cuenta/avatar', async (c, w) => {
    requiere(c);
    limitar(`avatar|${c.usuario.id}`, 15, 20);
    const buf = c.rawBody;
    const bytes = buf ? new Uint8Array(buf) : null;
    const ext = bytes ? tipoImagen(bytes) : null;
    if (!bytes || !ext) falla('La foto debe ser una imagen PNG, JPG o WebP.');
    if (bytes.length > 300 * 1024) falla('La foto es demasiado grande (máximo 300 KB).', 413);
    const dataUrl = `data:${TIPO_MIME[ext]};base64,${bytesA64(bytes)}`;
    const existente = w.avatares.find((a) => a.usuario_id === c.usuario.id);
    if (existente) Object.assign(existente, { tipo: TIPO_MIME[ext], datos: dataUrl, creado_en: ahora() });
    else w.avatares.push({ usuario_id: c.usuario.id, tipo: TIPO_MIME[ext], datos: dataUrl, creado_en: ahora() });
    const u = usuarioPorId(w, c.usuario.id);
    u.avatar_v += 1;
    return { mensaje: 'Foto de perfil actualizada.', avatar_v: u.avatar_v };
  });

  DEL('/cuenta/avatar', (c, w) => {
    requiere(c);
    w.avatares = w.avatares.filter((a) => a.usuario_id !== c.usuario.id);
    usuarioPorId(w, c.usuario.id).avatar_v = 0;
    return { mensaje: 'Foto de perfil eliminada.', avatar_v: 0 };
  });

  PUT('/cuenta/contrasena', async (c, w) => {
    requiere(c);
    const b = c.body || {};
    limitar(`pass|${c.usuario.id}`, 15, 10);
    const u = usuarioPorId(w, c.usuario.id);
    if (typeof b.actual !== 'string' || !(await verificarClave(b.actual, u.hash))) falla('La contraseña actual es incorrecta.');
    const nueva = V.contrasena(b.nueva);
    if (await verificarClave(nueva, u.hash)) falla('La nueva contraseña debe ser distinta a la actual.');
    u.hash = await hashClave(nueva);
    w.sesiones = w.sesiones.filter((s) => !(s.usuario_id === u.id && s.token_hash !== c.tokenHash));
    return { mensaje: 'Contraseña actualizada.' };
  });

  P('/cuenta/baja', async (c, w) => {
    requiere(c, 'adoptante', 'refugio');
    const b = c.body || {};
    limitar(`baja|${c.usuario.id}`, 15, 5);
    const u = usuarioPorId(w, c.usuario.id);
    if (typeof b.contrasena !== 'string' || !(await verificarClave(b.contrasena, u.hash))) falla('La contraseña es incorrecta. La cuenta no se da de baja.');
    const t = ahora();
    Object.assign(u, { estado: 'baja', baja_en: t, purgar_en: `${sumarDias(hoy(), 30)} ${t.slice(11)}` });
    retirarActividad(w, u, 'El adoptante dio de baja su cuenta.', 'El refugio dio de baja su cuenta.');
    w.sesiones = w.sesiones.filter((s) => s.usuario_id !== u.id);
    c.borrarToken = true;
    return { mensaje: 'Su cuenta fue dada de baja. Sus datos personales se eliminarán en 30 días.' };
  });

  function retirarActividad(w, usuario, motivoAdoptante, motivoRefugio) {
    const t = ahora();
    for (const s of w.solicitudes) {
      if (s.adoptante_id === usuario.id && ['pendiente', 'aprobada'].includes(s.estado) && !s.concretada_en) {
        Object.assign(s, { estado: 'cancelada', motivo_rechazo: motivoAdoptante, rechazada_en: t });
      }
    }
    if (usuario.tipo === 'refugio') {
      const pend = w.solicitudes.filter((s) => ['pendiente', 'aprobada'].includes(s.estado)
        && w.animales.some((a) => a.id === s.animal_id && a.refugio_id === usuario.id && a.estado === 'disponible'));
      for (const s of pend) {
        Object.assign(s, { estado: 'rechazada', motivo_rechazo: motivoRefugio, rechazada_en: t });
        const a = w.animales.find((x) => x.id === s.animal_id);
        notificar(w, s.adoptante_id, `Su solicitud para ${a.nombre} fue rechazada: ${motivoRefugio}`, `#/solicitudes?id=${s.id}`);
      }
      w.animales.forEach((a) => { if (a.refugio_id === usuario.id && !a.eliminado && a.estado === 'disponible') Object.assign(a, { eliminado: 1, eliminado_por: 'refugio', eliminado_en: t }); });
    }
  }

  /* --- Notificaciones --- */
  G('/notificaciones', (c, w) => {
    requiere(c);
    return w.notificaciones.filter((n) => n.usuario_id === c.usuario.id).sort((a, b) => b.id - a.id).slice(0, 100)
      .map((n) => ({ id: n.id, texto: n.texto, enlace: n.enlace, leida: n.leida, creada_en: n.creada_en }));
  });
  P('/notificaciones/:id/leida', (c, w) => {
    requiere(c);
    const id = V.id(c.params.id);
    const n = w.notificaciones.find((x) => x.id === id && x.usuario_id === c.usuario.id && x.leida === 0);
    if (n) Object.assign(n, { leida: 1, leida_en: ahora() });
    return { ok: true };
  });
  P('/notificaciones/leidas', (c, w) => {
    requiere(c);
    w.notificaciones.forEach((n) => { if (n.usuario_id === c.usuario.id && n.leida === 0) Object.assign(n, { leida: 1, leida_en: ahora() }); });
    return { ok: true };
  });

  /* --- Refugio: publicaciones --- */
  G('/refugio/animales', (c, w) => {
    soloRefugio(c);
    return w.animales.filter((a) => a.refugio_id === c.usuario.id && !a.eliminado)
      .sort((x, y) => ((x.estado === 'adoptado') - (y.estado === 'adoptado')) || (x.publicado_en < y.publicado_en ? 1 : x.publicado_en > y.publicado_en ? -1 : 0))
      .map((a) => tarjeta(w, a, true));
  });

  G('/refugio/animales/:id', (c, w) => {
    soloRefugio(c);
    const a = propio(w, c, V.id(c.params.id));
    if (c.query.editar === '1' && a.estado === 'adoptado') falla('Una publicación adoptada no es editable.', 409);
    return {
      ...a,
      requisitos: w.requisitos.filter((r) => r.animal_id === a.id).map((r) => ({ nombre: r.nombre, tipo_id: r.tipo_id, otro: r.otro })),
      vacunas: w.vacunas.filter((v) => v.animal_id === a.id).map((v) => ({ nombre: v.nombre, fecha: v.fecha })),
    };
  });

  P('/refugio/animales', (c, w) => {
    soloRefugio(c);
    const v = validarAnimal(w, c.body || {}, {}, c.usuario.id);
    const t = ahora();
    const a = insertar(w, 'animales', {
      refugio_id: c.usuario.id, nombre: v.nombre, raza: v.raza, raza_aprox: v.razaAprox, edad_id: v.edadId, tamano_id: v.tamanoId,
      salud: '', temperamento: '', ...Object.fromEntries(CAMPOS_ANIMAL.map((k) => [k, v.cerrados[k]])),
      fecha_ingreso: v.fechaIngreso, esterilizado: v.esterilizado, fecha_esterilizacion: v.fechaEst, desparasitado: v.desparasitado,
      peso_kg: v.dims.peso, altura_cm: v.dims.altura, estado: 'disponible', adoptado_en: null, eliminado: 0,
      eliminado_por: null, eliminado_motivo: null, eliminado_desc: null, eliminado_en: null, publicado_en: t, actualizado_en: t,
    });
    guardarDetalle(w, a.id, v);
    c.status = 201;
    return { id: a.id, mensaje: 'Publicación creada con estado Disponible.' };
  });

  PUT('/refugio/animales/:id', (c, w) => {
    soloRefugio(c);
    const id = V.id(c.params.id);
    const actual = propio(w, c, id);
    if (actual.estado === 'adoptado') falla('Una publicación adoptada no es editable.', 409);
    const reqActuales = w.requisitos.filter((x) => x.animal_id === id);
    const tipos = reqActuales.map((x) => x.tipo_id);
    const documentos = reqActuales.filter((x) => !x.otro).map((x) => x.nombre);
    const vacunasActuales = w.vacunas.filter((x) => x.animal_id === id).map((x) => x.nombre);
    const datos = c.body && typeof c.body === 'object' ? c.body : falla('Solicitud inválida.');
    const v = validarAnimal(w, datos, { edad_id: actual.edad_id, tamano_id: actual.tamano_id, tipos, documentos, vacunas: vacunasActuales }, c.usuario.id, id);
    const fuertes = [['nombre', v.nombre, 'nombre'], ['raza', v.raza, 'raza'], ['raza_aprox', v.razaAprox, 'raza parecida'],
      ['edad_id', v.edadId, 'edad'], ['tamano_id', v.tamanoId, 'tamaño']].filter(([k, nuevo]) => String(actual[k] ?? '') !== String(nuevo ?? ''));
    const activas = fuertes.length ? w.solicitudes.filter((s) => s.animal_id === id && ['pendiente', 'aprobada'].includes(s.estado) && !s.concretada_en) : [];
    if (activas.length && datos.confirmar_reinicio !== true) {
      falla(`Cambiaste ${fuertes.map((x) => x[2]).join(', ')} y ${actual.nombre} tiene ${activas.length} solicitud(es) activa(s). Si guardas, esas solicitudes se cancelarán y se avisará a cada adoptante.`,
        409, { codigo: 'REINICIO', solicitudes: activas.length, campos: fuertes.map((x) => x[2]) });
    }
    Object.assign(actual, {
      nombre: v.nombre, raza: v.raza, raza_aprox: v.razaAprox, edad_id: v.edadId, tamano_id: v.tamanoId,
      ...Object.fromEntries(CAMPOS_ANIMAL.map((k) => [k, v.cerrados[k]])), fecha_ingreso: v.fechaIngreso, esterilizado: v.esterilizado,
      fecha_esterilizacion: v.fechaEst, desparasitado: v.desparasitado, peso_kg: v.dims.peso, altura_cm: v.dims.altura, actualizado_en: ahora(),
    });
    guardarDetalle(w, id, v);
    for (const s of activas) {
      Object.assign(s, { estado: 'cancelada', motivo_rechazo: `El refugio cambió datos importantes de la publicación (${fuertes.map((x) => x[2]).join(', ')}).`, rechazada_en: ahora() });
      w.citas = w.citas.filter((x) => x.solicitud_id !== s.id);
      notificar(w, s.adoptante_id, `Tu solicitud para ${actual.nombre} se canceló porque el refugio cambió datos importantes del perro (${fuertes.map((x) => x[2]).join(', ')}). Revisa la ficha y, si te sigue interesando, vuelve a solicitar.`, `#/animal/${id}`);
    }
    const n = activas.length;
    return { mensaje: n ? `Cambios guardados. Se cancelaron ${n} solicitud(es) y se avisó a cada adoptante.` : 'Cambios guardados.' };
  });

  DEL('/refugio/animales/:id', (c, w) => {
    soloRefugio(c);
    const id = V.id(c.params.id);
    const a = propio(w, c, id);
    if (w.solicitudes.some((s) => s.animal_id === id && ['pendiente', 'aprobada'].includes(s.estado))) {
      falla('La publicación tiene solicitudes activas. Rechácelas antes de eliminarla.', 409);
    }
    Object.assign(a, { eliminado: 1, eliminado_por: 'refugio', eliminado_en: ahora() });
    return { mensaje: 'Publicación eliminada.' };
  });

  P('/refugio/animales/:id/estado', (c, w) => {
    soloRefugio(c);
    const id = V.id(c.params.id);
    const estado = c.body && c.body.estado;
    if (!['disponible', 'adoptado'].includes(estado)) falla('Seleccione un estado válido.');
    const a = propio(w, c, id);
    if (a.estado === estado) falla('La publicación ya tiene el estado seleccionado.', 409);
    let cerradas = 0;
    if (estado === 'adoptado') {
      const s = w.solicitudes.find((x) => x.animal_id === id && x.estado === 'aprobada' && !x.concretada_en);
      if (!s) falla('No hay una solicitud aprobada para el animal.', 409);
      cerradas = marcarAdopcion(w, s, c.body.fecha, c.body.entrega);
    } else {
      Object.assign(a, { estado: 'disponible', adoptado_en: null, actualizado_en: ahora() });
      for (const s of w.solicitudes.filter((x) => x.animal_id === id && x.concretada_en)) {
        s.concretada_en = null;
        w.seguimientos = w.seguimientos.filter((x) => !(x.solicitud_id === s.id && !x.realizado_en));
        notificar(w, s.adoptante_id, `La adopción de ${a.nombre} se revirtió; el refugio se pondrá en contacto contigo.`, `#/solicitudes?id=${s.id}`);
      }
    }
    return { mensaje: estado === 'adoptado' ? `Estado actualizado a Adoptado. Solicitudes pendientes cerradas: ${cerradas}.` : 'Estado actualizado a Disponible.' };
  });

  /* --- Refugio: perfil y estadísticas --- */
  G('/refugio/perfil', (c, w) => {
    soloRefugio(c);
    const u = usuarioPorId(w, c.usuario.id);
    const rf = refugioDe(w, u.id);
    const pend = w.refugio_cambios.find((x) => x.refugio_id === u.id && x.estado === 'pendiente');
    const rech = w.refugio_cambios.filter((x) => x.refugio_id === u.id && x.estado === 'rechazado').sort((a, b) => b.id - a.id)[0];
    return {
      nombre: u.nombre, correo: u.correo, institucion: rf.institucion, direccion: rf.direccion, calle: rf.calle, num_ext: rf.num_ext,
      num_int: rf.num_int, colonia: rf.colonia, cp: rf.cp, telefono: rf.telefono, alcaldia_id: rf.alcaldia_id, lat: rf.lat ?? null, lng: rf.lng ?? null,
      place_id: rf.place_id, horario: horarioDe(w, u.id),
      cambio_pendiente: pend ? { id: pend.id, datos: pend.datos, creado_en: String(pend.creado_en).slice(0, 16) } : null,
      ultimo_rechazo: rech ? { motivo: rech.motivo, revisado_en: String(rech.revisado_en).slice(0, 16) } : null,
    };
  });
  PUT('/refugio/perfil', (c, w) => {
    soloRefugio(c);
    const b = c.body || {};
    const actual = refugioDe(w, c.usuario.id);
    const d = validarRefugio(w, { ...b, institucion: b.institucion === undefined ? actual.institucion : b.institucion }, c.usuario.id);
    return solicitarCambioRefugio(w, c.usuario, d);
  });
  G('/refugio/estadisticas', (c, w) => {
    soloRefugio(c);
    const p = periodo(c.query);
    const ing = w.animales.filter((a) => a.refugio_id === c.usuario.id && a.fecha_ingreso >= p.inicio && a.fecha_ingreso <= p.fin).length;
    const ado = w.animales.filter((a) => a.refugio_id === c.usuario.id && a.estado === 'adoptado' && a.adoptado_en >= p.inicio && a.adoptado_en <= p.fin).length;
    return { ...p, ingresos: ing, adopciones: ado };
  });

  /* --- Protocolo de adopción: solicitudes --- */
  G('/solicitudes/formato', () => ({ opciones: OPCIONES_SOL, compromisos: COMPROMISOS }));

  P('/solicitudes', (c, w) => {
    adoptantes(c);
    const b = c.body || {};
    const animalId = V.id(b.animal_id);
    const cuestionario = validarCuestionario(b.cuestionario);
    const comp = b.compromisos && typeof b.compromisos === 'object' ? b.compromisos : {};
    if (Object.keys(COMPROMISOS).some((k) => comp[k] !== true)) falla('Para continuar acepta cada punto de la carta compromiso de adopción.');
    const mensaje = V.texto(b.mensaje, { min: 10, max: 300, campo: 'El mensaje', opcional: true, minPalabras: 2, lineas: 4 });
    const yo = usuarioPorId(w, c.usuario.id);
    const esRefugio = c.usuario.tipo === 'refugio';
    let telefonoPropio = yo.telefono;
    if (esRefugio) telefonoPropio = refugioDe(w, yo.id).telefono;
    if (!yo.mayor_edad_en && b.mayor_edad !== true) falla('Para adoptar debes ser mayor de 18 años. Confírmalo en el formato.');
    const telefono = b.telefono && !esRefugio ? V.telefonoLibre(V.telefono(b.telefono), c.usuario.id, w) : telefonoPropio;
    if (!telefono) falla('Agregue su teléfono de contacto para que el refugio pueda comunicarse con usted.', 400, { codigo: 'TELEFONO' });
    const t = ahora();
    if (!esRefugio && telefono !== yo.telefono) yo.telefono = telefono;
    if (!yo.mayor_edad_en) yo.mayor_edad_en = t;
    const a = w.animales.find((x) => x.id === animalId);
    const ur = a && usuarioPorId(w, a.refugio_id);
    if (!a || a.eliminado || a.estado !== 'disponible' || !ur || ur.estado !== 'activa') falla('El animal ya no está disponible para adopción.', 409);
    if (a.refugio_id === c.usuario.id) falla('No puedes solicitar la adopción de un perro de tu propio refugio.', 403);
    if (w.solicitudes.some((s) => s.animal_id === animalId && s.adoptante_id === c.usuario.id && ['pendiente', 'aprobada'].includes(s.estado))) falla('Ya tiene una solicitud activa para el animal.', 409);
    const mias = w.solicitudes.filter((s) => s.adoptante_id === c.usuario.id && ['pendiente', 'aprobada'].includes(s.estado) && !s.concretada_en).length;
    if (mias >= 5) falla('Tiene 5 solicitudes activas. No es posible enviar otra.', 409);
    const delAnimal = w.solicitudes.filter((s) => s.animal_id === animalId && ['pendiente', 'aprobada'].includes(s.estado)).length;
    if (delAnimal >= 20) falla('La publicación ya tiene 20 solicitudes activas.', 409);
    const s = insertar(w, 'solicitudes', {
      animal_id: animalId, adoptante_id: c.usuario.id, estado: 'pendiente', motivo_rechazo: null, cuestionario, compromiso_en: t,
      enviada_en: t, aprobada_en: null, rechazada_en: null, visita: null, visita_en: null, concretada_en: null, entrega: null,
    });
    if (mensaje) insertar(w, 'mensajes', { solicitud_id: s.id, autor_id: c.usuario.id, texto: mensaje, creado_en: t, leido_en: null });
    notificar(w, a.refugio_id, `Nueva solicitud de adopción para ${a.nombre} de ${c.usuario.nombre}.`, `#/refugio/solicitudes?id=${s.id}`);
    c.status = 201;
    return { id: s.id, mensaje: 'Solicitud enviada. El refugio la revisará y recibirás una notificación.' };
  });

  G('/solicitudes/mias', (c, w) => {
    adoptantes(c);
    const lista = w.solicitudes.filter((s) => s.adoptante_id === c.usuario.id).sort((x, y) => (x.enviada_en < y.enviada_en ? 1 : x.enviada_en > y.enviada_en ? -1 : y.id - x.id)).map((s) => {
      const a = w.animales.find((x) => x.id === s.animal_id) || {};
      const u = usuarioPorId(w, a.refugio_id) || {};
      const rf = refugioDe(w, a.refugio_id) || {};
      const cita = w.citas.find((x) => x.solicitud_id === s.id);
      return {
        id: s.id, estado: s.estado, enviada: String(s.enviada_en).slice(0, 16), motivo_rechazo: s.motivo_rechazo, cuestionario: s.cuestionario,
        concretada_en: s.concretada_en, visita: s.visita, visita_en: s.visita_en, entrega: s.entrega,
        animal_id: a.id, animal: a.nombre, raza: a.raza, raza_aprox: a.raza_aprox, refugio_id: u.id, refugio: u.nombre, refugio_avatar: u.avatar_v,
        direccion: rf.direccion, telefono: rf.telefono, lat: rf.lat ?? null, lng: rf.lng ?? null, place_id: rf.place_id,
        cita_fecha: cita ? cita.fecha : null, cita_hora: cita ? cita.hora : null,
        requisitos: cita && !s.concretada_en ? w.requisitos.filter((r) => r.animal_id === a.id).sort((x, y) => (x.otro - y.otro) || (x.id - y.id)).map((r) => r.nombre) : undefined,
      };
    });
    return adjuntar(w, lista, c.usuario.id);
  });

  const VISTAS = {
    pendiente: (s) => s.estado === 'pendiente',
    aprobada: (s) => s.estado === 'aprobada' && !s.concretada_en,
    adoptada: (s) => !!s.concretada_en,
    rechazada: (s) => ['rechazada', 'cancelada'].includes(s.estado),
  };
  G('/refugio/solicitudes', (c, w) => {
    soloRefugio(c);
    const animalId = c.query.animal_id ? V.id(c.query.animal_id) : null;
    const solId = c.query.id ? V.id(c.query.id) : null;
    const vista = VISTAS[c.query.estado] ? c.query.estado : 'pendiente';
    const mias = w.solicitudes.map((s) => ({ s, a: w.animales.find((x) => x.id === s.animal_id) })).filter(({ a }) => a && a.refugio_id === c.usuario.id);
    const filtrados = mias.filter(({ s, a }) => {
      if (solId) return s.id === solId;
      if (animalId) return a.id === animalId;
      return VISTAS[vista](s);
    });
    const lista = filtrados.sort((x, y) => (x.s.enviada_en < y.s.enviada_en ? 1 : x.s.enviada_en > y.s.enviada_en ? -1 : y.s.id - x.s.id)).map(({ s, a }) => {
      const ad = usuarioPorId(w, s.adoptante_id) || {};
      const cita = w.citas.find((x) => x.solicitud_id === s.id);
      return {
        id: s.id, estado: s.estado, enviada: String(s.enviada_en).slice(0, 16), aprobada: s.aprobada_en ? String(s.aprobada_en).slice(0, 10) : null,
        motivo_rechazo: s.motivo_rechazo, cuestionario: s.cuestionario, concretada_en: s.concretada_en, visita: s.visita, visita_en: s.visita_en, entrega: s.entrega,
        animal_id: a.id, animal: a.nombre, animal_estado: a.estado, raza: a.raza, raza_aprox: a.raza_aprox, esterilizado: a.esterilizado,
        edad: (valorCat(w, a.edad_id) || {}).nombre, adoptante_id: ad.id, adoptante: ad.nombre, adoptante_correo: ad.correo,
        adoptante_telefono: ad.telefono || (refugioDe(w, ad.id) || {}).telefono || null, adoptante_tipo: ad.tipo, adoptante_avatar: ad.avatar_v,
        cita_fecha: cita ? cita.fecha : null, cita_hora: cita ? cita.hora : null,
      };
    });
    const cuentas = {};
    mias.forEach(({ s }) => {
      const v = s.concretada_en ? 'adoptada' : ['rechazada', 'cancelada'].includes(s.estado) ? 'rechazada' : s.estado;
      cuentas[v] = (cuentas[v] || 0) + 1;
    });
    return { vista: solId || animalId ? null : vista, cuentas, solicitudes: adjuntar(w, lista, c.usuario.id) };
  });

  function solicitudDeAmbos(w, c, id) {
    const s = w.solicitudes.find((x) => x.id === id);
    const a = s && w.animales.find((x) => x.id === s.animal_id);
    if (!s || !a || ![s.adoptante_id, a.refugio_id].includes(c.usuario.id)) falla('La solicitud no existe.', 404);
    return { ...s, refugio_id: a.refugio_id, animal: a.nombre };
  }

  G('/solicitudes/:id/mensajes', (c, w) => {
    requiere(c, 'adoptante', 'refugio');
    const s = solicitudDeAmbos(w, c, V.id(c.params.id));
    const msgs = w.mensajes.filter((m) => m.solicitud_id === s.id).sort((x, y) => x.id - y.id);
    msgs.forEach((m) => { if (m.autor_id !== c.usuario.id && m.leido_en == null) m.leido_en = ahora(); });
    return msgs.map((m) => ({ id: m.id, autor_id: m.autor_id, texto: m.texto, creado: String(m.creado_en).slice(0, 16), mio: m.autor_id === c.usuario.id }));
  });

  P('/solicitudes/:id/mensajes', (c, w) => {
    requiere(c, 'adoptante', 'refugio');
    const texto = V.texto((c.body || {}).texto, { min: 2, max: 300, campo: 'El mensaje', minPalabras: 1, lineas: 4 });
    const s = solicitudDeAmbos(w, c, V.id(c.params.id));
    if (!puedeEscribir(s)) falla('La conversación está cerrada para esta solicitud.', 409);
    const hace24 = haceMin(24 * 60);
    const hoyMios = w.mensajes.filter((m) => m.solicitud_id === s.id && m.autor_id === c.usuario.id && m.creado_en >= hace24).length;
    if (hoyMios >= 10) falla('Llegaste al límite de 10 mensajes por día en esta solicitud.', 429);
    const ultimos = w.mensajes.filter((m) => m.solicitud_id === s.id).sort((x, y) => y.id - x.id).slice(0, 3);
    if (ultimos.length === 3 && ultimos.every((m) => m.autor_id === c.usuario.id)) falla('Espera la respuesta antes de enviar más mensajes (máximo 3 seguidos).', 429);
    insertar(w, 'mensajes', { solicitud_id: s.id, autor_id: c.usuario.id, texto, creado_en: ahora(), leido_en: null });
    const otro = c.usuario.id === s.adoptante_id ? s.refugio_id : s.adoptante_id;
    const enlace = otro === s.refugio_id ? `#/refugio/solicitudes?id=${s.id}` : `#/solicitudes?id=${s.id}`;
    const yaAvisado = w.notificaciones.some((n) => n.usuario_id === otro && n.enlace === enlace && n.leida === 0);
    if (!yaAvisado) notificar(w, otro, `${c.usuario.nombre} te escribió sobre la solicitud de ${s.animal}.`, enlace);
    c.status = 201;
    return { mensaje: 'Mensaje enviado.' };
  });

  function solicitudPropia(w, c, id) {
    const s = w.solicitudes.find((x) => x.id === id);
    const a = s && w.animales.find((x) => x.id === s.animal_id);
    if (!s || !a || a.refugio_id !== c.usuario.id) falla('La solicitud no existe.', 404);
    return { ...s, animal: a.nombre, refugio_id: a.refugio_id, animal_estado: a.estado, eliminado: a.eliminado, animal_id: a.id, esterilizado: a.esterilizado };
  }
  const aSolicitud = (w, s) => { const real = w.solicitudes.find((x) => x.id === s.id); return real; };

  P('/refugio/solicitudes/:id/aprobar', (c, w) => {
    soloRefugio(c);
    const s = solicitudPropia(w, c, V.id(c.params.id));
    if (s.estado !== 'pendiente') falla('La solicitud ya no está pendiente.', 409);
    if (s.animal_estado !== 'disponible' || s.eliminado) falla('El animal ya no está disponible para adopción.', 409);
    if (w.solicitudes.some((x) => x.animal_id === s.animal_id && x.estado === 'aprobada' && x.id !== s.id)) {
      falla('El animal ya tiene una solicitud aprobada. Concrete la adopción o cancele esa aprobación antes de aprobar otra.', 409);
    }
    const real = aSolicitud(w, s);
    Object.assign(real, { estado: 'aprobada', aprobada_en: ahora() });
    notificar(w, s.adoptante_id, `¡Tu solicitud para ${s.animal} fue aprobada! El refugio agendará una cita y la visita domiciliaria contigo.`, `#/solicitudes?id=${s.id}`);
    return { mensaje: 'Solicitud aprobada. Agenda la cita y registra la visita domiciliaria.' };
  });

  P('/refugio/solicitudes/:id/rechazar', (c, w) => {
    soloRefugio(c);
    const m = limpiar(c.body && c.body.motivo);
    if (!m) falla('Debe ingresar el motivo del rechazo.');
    const motivo = V.motivo(m);
    const s = solicitudPropia(w, c, V.id(c.params.id));
    const cancelable = s.estado === 'aprobada' && !s.concretada_en && s.animal_estado === 'disponible';
    if (s.estado !== 'pendiente' && !cancelable) falla('La solicitud ya no está pendiente.', 409);
    const real = aSolicitud(w, s);
    Object.assign(real, { estado: 'rechazada', motivo_rechazo: motivo, rechazada_en: ahora() });
    w.citas = w.citas.filter((x) => x.solicitud_id !== s.id);
    notificar(w, s.adoptante_id, `Tu solicitud para ${s.animal} fue rechazada. Motivo: ${motivo}`, `#/solicitudes?id=${s.id}`);
    return { mensaje: 'Solicitud rechazada.' };
  });

  P('/solicitudes/:id/cancelar', (c, w) => {
    adoptantes(c);
    const id = V.id(c.params.id);
    const s = w.solicitudes.find((x) => x.id === id && x.adoptante_id === c.usuario.id);
    if (!s) falla('La solicitud no existe.', 404);
    const a = w.animales.find((x) => x.id === s.animal_id);
    if (!['pendiente', 'aprobada'].includes(s.estado) || s.concretada_en) falla('Esta solicitud ya no se puede cancelar.', 409);
    Object.assign(s, { estado: 'cancelada', motivo_rechazo: 'La persona adoptante retiró su solicitud.', rechazada_en: ahora() });
    w.citas = w.citas.filter((x) => x.solicitud_id !== s.id);
    notificar(w, a.refugio_id, `${c.usuario.nombre} retiró su solicitud para ${a.nombre}.`, `#/refugio/solicitudes?id=${s.id}`);
    return { mensaje: 'Solicitud cancelada.' };
  });

  P('/refugio/solicitudes/:id/cita', (c, w) => {
    soloRefugio(c);
    const { fecha, hora } = c.body || {};
    const s = solicitudPropia(w, c, V.id(c.params.id));
    if (s.estado !== 'aprobada' || s.concretada_en) falla('Las citas solo se agendan para solicitudes aprobadas.', 409);
    const t = hoy();
    if (!esFecha(fecha) || fecha <= t || fecha > sumarDias(t, 14)) falla('La fecha debe estar dentro de los próximos 14 días.');
    if (typeof hora !== 'string' || !/^([01]\d|2[0-3]):(00|30)$/.test(hora)) falla('Seleccione una hora en bloques de 30 minutos.');
    const dia = w.refugio_horarios.find((x) => x.refugio_id === c.usuario.id && x.dia === diaSemana(fecha));
    if (!dia || dia.cerrado) falla('El Refugio está cerrado en el día seleccionado.');
    const [hh, mm] = hora.split(':').map(Number);
    const fin = `${String(hh + (mm === 30 ? 1 : 0)).padStart(2, '0')}:${mm === 30 ? '00' : '30'}`;
    if (hora < dia.abre || fin > dia.cierra) falla('La hora no está dentro del horario de atención.');
    const ocupado = w.citas.find((x) => x.refugio_id === c.usuario.id && x.fecha === fecha && x.hora === hora);
    if (ocupado && ocupado.solicitud_id !== s.id) falla('El bloque seleccionado ya está ocupado. Seleccione otra hora.', 409);
    w.citas = w.citas.filter((x) => x.solicitud_id !== s.id);
    insertar(w, 'citas', { solicitud_id: s.id, refugio_id: c.usuario.id, fecha, hora, creada_en: ahora() });
    notificar(w, s.adoptante_id, `Cita agendada para conocer a ${s.animal}: ${fecha} a las ${hora}. Lleva tu identificación y los requisitos.`, `#/solicitudes?id=${s.id}`);
    return { mensaje: 'Cita agendada.' };
  });

  PUT('/refugio/solicitudes/:id/visita', (c, w) => {
    soloRefugio(c);
    const b = c.body || {};
    if (!['realizada', 'no_requerida', 'no_apta'].includes(b.resultado)) falla('Seleccione el resultado de la visita domiciliaria.');
    let fecha = null;
    if (b.resultado !== 'no_requerida') {
      if (!esFecha(b.fecha) || b.fecha > hoy() || b.fecha < sumarDias(hoy(), -60)) falla('Indique la fecha de la visita (hoy o en los últimos 60 días).');
      fecha = b.fecha;
    }
    const motivo = b.resultado === 'no_apta' ? V.motivo(b.motivo, 10, 300, 'Explique por qué el hogar no es apto (10 a 300 caracteres).') : null;
    const s = solicitudPropia(w, c, V.id(c.params.id));
    if (s.estado !== 'aprobada' || s.concretada_en) falla('La visita se registra en solicitudes aprobadas que aún no se concretan.', 409);
    if (fecha && fecha < String(s.aprobada_en).slice(0, 10)) falla('La visita no puede ser anterior a la aprobación de la solicitud.');
    const real = aSolicitud(w, s);
    Object.assign(real, { visita: b.resultado, visita_en: fecha });
    if (motivo) {
      Object.assign(real, { estado: 'rechazada', motivo_rechazo: `Visita domiciliaria: ${motivo}`, rechazada_en: ahora() });
      w.citas = w.citas.filter((x) => x.solicitud_id !== s.id);
      notificar(w, s.adoptante_id, `Tras la visita domiciliaria, tu solicitud para ${s.animal} no continuó. Motivo: ${motivo}`, `#/solicitudes?id=${s.id}`);
    }
    return { mensaje: motivo ? 'Visita registrada: la solicitud se rechazó.' : 'Visita domiciliaria registrada.' };
  });

  P('/refugio/solicitudes/:id/adopcion', (c, w) => {
    soloRefugio(c);
    const b = c.body || {};
    const s = solicitudPropia(w, c, V.id(c.params.id));
    const cerradas = marcarAdopcion(w, aSolicitud(w, s), b.fecha, b.entrega);
    return { mensaje: `Adopción registrada. Se programó el seguimiento (1 semana, 1 mes y 3 meses). Solicitudes pendientes cerradas: ${cerradas}.` };
  });

  PUT('/refugio/seguimientos/:id', (c, w) => {
    soloRefugio(c);
    const b = c.body || {};
    if (!['bien', 'con_dudas', 'problema', 'sin_contacto'].includes(b.resultado)) falla('Seleccione cómo está el perro.');
    const notas = V.texto(b.notas, { min: 5, max: 300, campo: 'Las notas', opcional: b.resultado === 'bien', minPalabras: 1, lineas: 4 });
    const sg = w.seguimientos.find((x) => x.id === V.id(c.params.id));
    const s = sg && w.solicitudes.find((x) => x.id === sg.solicitud_id);
    const a = s && w.animales.find((x) => x.id === s.animal_id);
    if (!sg || !a || a.refugio_id !== c.usuario.id) falla('El seguimiento no existe.', 404);
    if (sg.programado > sumarDias(hoy(), 3)) falla(`Este seguimiento está programado para el ${sg.programado}; regístralo a partir de 3 días antes.`, 409);
    Object.assign(sg, { realizado_en: hoy(), resultado: b.resultado, notas });
    return { mensaje: 'Seguimiento registrado.' };
  });

  P('/refugio/animales/:id/cerrar-solicitudes', (c, w) => {
    soloRefugio(c);
    const id = V.id(c.params.id);
    const a = w.animales.find((x) => x.id === id);
    if (!a || a.refugio_id !== c.usuario.id) falla('La publicación no existe.', 404);
    if (a.estado !== 'adoptado') falla('El animal aún no está marcado como Adoptado.', 409);
    const n = cerrarPendientes(w, a);
    if (!n) falla('No hay solicitudes activas para cerrar.', 409);
    return { mensaje: `Solicitudes cerradas: ${n}.` };
  });

  /* --- Reportes --- */
  G('/reportes/motivos', () => MOTIVOS);
  P('/reportes', (c, w) => {
    adoptantes(c);
    const b = c.body || {};
    const tipo = Object.keys(MOTIVOS).includes(b.objetivo_tipo) ? b.objetivo_tipo : falla('Objetivo inválido.');
    const permitido = c.usuario.tipo === 'adoptante' ? ['animal', 'refugio'] : ['animal', 'refugio', 'usuario'];
    if (!permitido.includes(tipo)) falla('No puedes reportar este tipo de cuenta.', 403);
    const objetivo = V.id(b.objetivo_id);
    if ((tipo === 'refugio' || tipo === 'usuario') && objetivo === c.usuario.id) falla('No puedes reportar tu propia cuenta.', 400);
    if (tipo === 'animal' && w.animales.some((a) => a.id === objetivo && a.refugio_id === c.usuario.id)) falla('No puedes reportar tu propia publicación.', 400);
    if (!MOTIVOS[tipo].includes(b.motivo)) falla('Seleccione un motivo.');
    const desc = V.texto(b.descripcion, { min: 10, max: 300, campo: 'La descripción', minPalabras: 3, lineas: 4 });
    limitar(`rep|${c.usuario.id}`, 60, 10, 'Demasiados reportes en poco tiempo. Intente más tarde.');
    let existe;
    if (tipo === 'animal') existe = w.animales.some((a) => a.id === objetivo && !a.eliminado);
    else if (tipo === 'refugio') existe = w.usuarios.some((u) => u.id === objetivo && u.tipo === 'refugio' && u.estado === 'activa');
    else existe = w.usuarios.some((u) => u.id === objetivo && ['adoptante', 'refugio'].includes(u.tipo)
      && w.solicitudes.some((s) => s.adoptante_id === u.id && (w.animales.find((a) => a.id === s.animal_id) || {}).refugio_id === c.usuario.id));
    if (!existe) falla('El objetivo reportado no existe.', 404);
    if (w.reportes.some((r) => r.autor_id === c.usuario.id && r.objetivo_tipo === tipo && r.objetivo_id === objetivo && r.estado === 'abierto')) {
      falla('Ya tiene un reporte abierto sobre el mismo objetivo.', 409);
    }
    insertar(w, 'reportes', { autor_id: c.usuario.id, objetivo_tipo: tipo, objetivo_id: objetivo, motivo: b.motivo, descripcion: desc, estado: 'abierto', nota: null, admin_id: null, creado_en: ahora(), cerrado_en: null });
    c.status = 201;
    return { mensaje: 'Reporte enviado. El equipo de Dopta lo revisará.' };
  });

  /* --- Administración (Administrador y Funcionarios) --- */
  G('/admin/resumen', (c, w) => {
    adminOFuncionario(c);
    const admin = c.usuario.tipo === 'admin';
    return {
      rol: c.usuario.tipo,
      refugiosPendientes: admin ? w.usuarios.filter((u) => u.tipo === 'refugio' && u.estado === 'pendiente').length : 0,
      reportesAbiertos: w.reportes.filter((r) => r.estado === 'abierto').length,
      cambiosPendientes: admin ? w.refugio_cambios.filter((x) => x.estado === 'pendiente').length : 0,
      erroresNotificacion: admin ? w.errores_notificacion.filter((e) => e.revisado === 0).sort((a, b) => b.id - a.id).slice(0, 20)
        .map((e) => ({ id: e.id, texto: e.texto, creado_en: e.creado_en })) : [],
    };
  });
  P('/admin/errores-notificacion/revisados', (c, w) => { soloAdmin(c); w.errores_notificacion.forEach((e) => { e.revisado = 1; }); return { ok: true }; });

  G('/admin/refugios-pendientes', (c, w) => {
    soloAdmin(c);
    const plazo = haceMin(3 * 24 * 60);
    return w.usuarios.filter((u) => u.tipo === 'refugio' && u.estado === 'pendiente').sort((a, b) => (a.creado < b.creado ? -1 : a.creado > b.creado ? 1 : 0)).map((u) => {
      const rf = refugioDe(w, u.id);
      const x = {
        id: u.id, nombre: u.nombre, correo: u.correo, creado: u.creado, aviso_version: u.aviso_version, aviso_fecha: u.aviso_fecha,
        institucion: rf.institucion, direccion: rf.direccion, telefono: rf.telefono, calle: rf.calle, num_ext: rf.num_ext, num_int: rf.num_int,
        colonia: rf.colonia, cp: rf.cp, lat: rf.lat ?? null, lng: rf.lng ?? null, place_id: rf.place_id, alcaldia: alcaldiaDe(w, rf),
        plazo_vencido: u.creado < plazo,
      };
      x.horario = horarioDe(w, u.id);
      x.mapa = mapa(x);
      x.coincidencias = w.refugios.filter((r) => r.usuario_id !== u.id && (r.telefono === x.telefono
        || (r.cp === x.cp && sinAcentos(r.calle || '') === sinAcentos(x.calle || '') && r.num_ext === x.num_ext)))
        .slice(0, 5).map((r) => { const cu = usuarioPorId(w, r.usuario_id); return { id: cu.id, nombre: cu.nombre, estado: cu.estado }; });
      return x;
    });
  });

  function decidirRefugio(c, w, aceptar) {
    const id = V.id(c.params.id);
    const motivo = aceptar ? null : V.motivo(c.body && c.body.motivo, 10, 300, 'Indique el motivo del rechazo (10 a 300 caracteres).');
    const u = w.usuarios.find((x) => x.id === id && x.tipo === 'refugio');
    if (!u) falla('La cuenta no existe.', 404);
    if (u.estado !== 'pendiente') falla('La cuenta ya no está pendiente de verificación.', 409);
    if (aceptar) {
      Object.assign(u, { estado: 'activa', verificado_en: ahora() });
      notificar(w, id, '¡Tu refugio fue verificado! Ya puedes publicar animales en adopción.', '#/refugio');
    } else {
      Object.assign(u, { estado: 'rechazada', rechazado_en: ahora(), eliminado_motivo: motivo });
    }
  }
  P('/admin/refugios/:id/aceptar', (c, w) => { soloAdmin(c); decidirRefugio(c, w, true); return { mensaje: 'Cuenta verificada.' }; });
  P('/admin/refugios/:id/rechazar', (c, w) => { soloAdmin(c); decidirRefugio(c, w, false); return { mensaje: 'Cuenta rechazada.' }; });

  G('/admin/refugios', (c, w) => {
    soloAdmin(c);
    const texto = limpiar(c.query.q).slice(0, 60);
    const n = normalizar(texto);
    const dig = texto.replace(/\D/g, '');
    const estados = ['activa', 'pendiente', 'rechazada', 'baja', 'eliminada'];
    let lista = w.usuarios.filter((u) => u.tipo === 'refugio' && !u.purgado).map((u) => ({ u, rf: refugioDe(w, u.id) || {} }));
    if (texto) lista = lista.filter(({ u, rf }) => sinAcentos(u.nombre).includes(n) || sinAcentos(rf.institucion || '').includes(n)
      || sinAcentos(u.correo).includes(n) || (dig && String(rf.telefono || '').includes(dig)));
    if (estados.includes(c.query.estado)) lista = lista.filter(({ u }) => u.estado === c.query.estado);
    if (c.query.alcaldia) { const id = V.id(c.query.alcaldia); lista = lista.filter(({ rf }) => rf.alcaldia_id === id); }
    const cuenta = (u, fn) => w.animales.filter((a) => a.refugio_id === u.id && fn(a)).length;
    const filas = lista.map(({ u, rf }) => ({
      id: u.id, nombre: u.nombre, correo: u.correo, estado: u.estado, creado: String(u.creado).slice(0, 10),
      verificado: u.verificado_en ? String(u.verificado_en).slice(0, 10) : null, avatar_v: u.avatar_v,
      institucion: rf.institucion, direccion: rf.direccion, telefono: rf.telefono, place_id: rf.place_id, alcaldia: alcaldiaDe(w, rf),
      disponibles: cuenta(u, (a) => !a.eliminado && a.estado === 'disponible'),
      adoptados: cuenta(u, (a) => a.estado === 'adoptado'),
      activas: w.solicitudes.filter((s) => ['pendiente', 'aprobada'].includes(s.estado) && !s.concretada_en
        && (w.animales.find((a) => a.id === s.animal_id) || {}).refugio_id === u.id).length,
      reportes: w.reportes.filter((r) => r.objetivo_tipo === 'refugio' && r.objetivo_id === u.id && r.estado === 'abierto').length,
      cambios: w.refugio_cambios.filter((x) => x.refugio_id === u.id && x.estado === 'pendiente').length,
    }));
    const ORDEN = {
      nombre: (x, y) => (x.nombre < y.nombre ? -1 : x.nombre > y.nombre ? 1 : 0),
      recientes: (x, y) => (x.creado < y.creado ? 1 : x.creado > y.creado ? -1 : 0),
      adopciones: (x, y) => (y.adoptados - x.adoptados) || (x.nombre < y.nombre ? -1 : 1),
      reportes: (x, y) => (y.reportes - x.reportes) || (x.nombre < y.nombre ? -1 : 1),
    };
    return filas.sort(ORDEN[c.query.orden] || ORDEN.nombre).slice(0, 200).map((x) => ({ ...x, mapa: mapa(x) }));
  });

  G('/admin/refugios/:id', (c, w) => {
    soloAdmin(c);
    const id = V.id(c.params.id);
    const u = w.usuarios.find((x) => x.id === id);
    const rf = u && refugioDe(w, id);
    if (!u || !rf) falla('El refugio no existe.', 404);
    const x = {
      id: u.id, nombre: u.nombre, correo: u.correo, estado: u.estado, creado: u.creado, verificado_en: u.verificado_en, eliminado_motivo: u.eliminado_motivo,
      avatar_v: u.avatar_v, institucion: rf.institucion, direccion: rf.direccion, calle: rf.calle, num_ext: rf.num_ext, num_int: rf.num_int,
      colonia: rf.colonia, cp: rf.cp, telefono: rf.telefono, lat: rf.lat ?? null, lng: rf.lng ?? null, place_id: rf.place_id, alcaldia: alcaldiaDe(w, rf),
    };
    x.horario = horarioDe(w, id);
    x.mapa = mapa(x);
    x.animales = w.animales.filter((a) => a.refugio_id === id).sort((p, q) => (p.publicado_en < q.publicado_en ? 1 : -1)).slice(0, 100).map((a) => ({
      id: a.id, nombre: a.nombre, estado: a.estado, eliminado: a.eliminado, publicado: String(a.publicado_en).slice(0, 10), adoptado_en: a.adoptado_en,
      solicitudes: w.solicitudes.filter((s) => s.animal_id === a.id).length,
    }));
    x.reportes = w.reportes.filter((r) => r.objetivo_tipo === 'refugio' && r.objetivo_id === id).sort((a, b) => b.id - a.id).slice(0, 20)
      .map((r) => ({ id: r.id, motivo: r.motivo, descripcion: r.descripcion, estado: r.estado, creado: String(r.creado_en).slice(0, 10) }));
    x.cambios = w.refugio_cambios.filter((r) => r.refugio_id === id).sort((a, b) => b.id - a.id).slice(0, 10)
      .map((r) => ({ id: r.id, datos: r.datos, anteriores: r.anteriores, estado: r.estado, motivo: r.motivo, creado: String(r.creado_en).slice(0, 16) }));
    const adoptados = w.animales.filter((a) => a.refugio_id === id && a.estado === 'adoptado' && a.adoptado_en);
    void adoptados;
    x.dias_promedio_adopcion = adoptados.length ? Math.round(adoptados.reduce((s, a) => s + diasEntre(a.fecha_ingreso, a.adoptado_en), 0) / adoptados.length) : null;
    return x;
  });

  G('/admin/refugio-cambios', (c, w) => {
    soloAdmin(c);
    const alcaldias = Object.fromEntries(w.catalogo_valores.filter((v) => v.catalogo === 'alcaldia').map((a) => [a.id, a.nombre]));
    return w.refugio_cambios.filter((x) => x.estado === 'pendiente').sort((a, b) => (a.creado_en < b.creado_en ? -1 : 1)).map((x) => {
      const u = usuarioPorId(w, x.refugio_id);
      const rf = refugioDe(w, x.refugio_id) || {};
      const alc = alcaldiaDe(w, rf);
      return {
        id: x.id, refugio_id: x.refugio_id, datos: x.datos, anteriores: x.anteriores, creado: String(x.creado_en).slice(0, 16),
        nombre: u.nombre, correo: u.correo, institucion: rf.institucion, direccion: rf.direccion, place_id: rf.place_id, alcaldia: alc,
        etiquetas: ETIQUETAS,
        mapa_actual: mapa({ institucion: rf.institucion, direccion: rf.direccion, alcaldia: alc, place_id: rf.place_id }),
        mapa_nuevo: mapa({ institucion: x.datos.institucion || rf.institucion, direccion: x.datos.direccion || rf.direccion, alcaldia: alcaldias[x.datos.alcaldia_id] || alc, place_id: x.datos.place_id }),
      };
    });
  });
  P('/admin/refugio-cambios/:id/aprobar', (c, w) => { soloAdmin(c); decidirCambio(w, c, V.id(c.params.id), true); return { mensaje: 'Cambio aprobado y aplicado.' }; });
  P('/admin/refugio-cambios/:id/rechazar', (c, w) => {
    soloAdmin(c);
    const motivo = V.motivo((c.body || {}).motivo, 10, 300, 'Indique el motivo (10 a 300 caracteres).');
    decidirCambio(w, c, V.id(c.params.id), false, motivo);
    return { mensaje: 'Cambio rechazado. Se avisó al refugio.' };
  });

  G('/admin/publicaciones', (c, w) => {
    soloAdmin(c);
    const p = V.pagina(c.query.pagina);
    const lista = w.animales.filter((a) => !a.eliminado).sort((a, b) => (a.publicado_en < b.publicado_en ? 1 : a.publicado_en > b.publicado_en ? -1 : b.id - a.id));
    return {
      total: lista.length, pagina: p, porPagina: POR_PAGINA_ADMIN,
      publicaciones: lista.slice((p - 1) * POR_PAGINA_ADMIN, p * POR_PAGINA_ADMIN).map((a) => ({
        id: a.id, nombre: a.nombre, raza: a.raza, raza_aprox: a.raza_aprox, estado: a.estado, publicado: String(a.publicado_en).slice(0, 16),
        refugio: (usuarioPorId(w, a.refugio_id) || {}).nombre,
      })),
    };
  });

  P('/admin/publicaciones/:id/eliminar', (c, w) => {
    soloAdmin(c);
    const id = V.id(c.params.id);
    const b = c.body || {};
    if (!MOTIVOS.animal.includes(b.motivo)) falla('Seleccione un motivo.');
    const desc = b.motivo === 'Otro' ? V.motivo(b.descripcion, 10, 300, 'La descripción debe tener de 10 a 300 caracteres.') : null;
    const a = w.animales.find((x) => x.id === id);
    if (!a || a.eliminado) falla('La publicación no existe.', 404);
    const t = ahora();
    Object.assign(a, { eliminado: 1, eliminado_por: 'admin', eliminado_motivo: b.motivo, eliminado_desc: desc, eliminado_en: t });
    for (const s of w.solicitudes.filter((x) => x.animal_id === id && ['pendiente', 'aprobada'].includes(x.estado) && !x.concretada_en)) {
      Object.assign(s, { estado: 'cancelada', motivo_rechazo: 'La publicación fue retirada por moderación.', rechazada_en: t });
      notificar(w, s.adoptante_id, `Tu solicitud para ${a.nombre} se cerró porque la publicación fue retirada por moderación.`, `#/solicitudes?id=${s.id}`);
    }
    notificar(w, a.refugio_id, `Tu publicación de ${a.nombre} fue eliminada por moderación. Motivo: ${b.motivo}${desc ? ` (${desc})` : ''}.`, '#/refugio');
    return { mensaje: 'Publicación eliminada.' };
  });

  G('/admin/cuentas', (c, w) => {
    soloAdmin(c);
    const p = V.pagina(c.query.pagina);
    const texto = limpiar(c.query.q).slice(0, 60);
    const n = normalizar(texto);
    let lista = w.usuarios.filter((u) => !u.purgado);
    if (texto) lista = lista.filter((u) => sinAcentos(u.nombre).includes(n) || sinAcentos(u.correo).includes(n));
    if (['adoptante', 'refugio', 'admin', 'funcionario'].includes(c.query.tipo)) lista = lista.filter((u) => u.tipo === c.query.tipo);
    lista = lista.sort((a, b) => b.id - a.id);
    return {
      total: lista.length, pagina: p, porPagina: POR_PAGINA_ADMIN,
      cuentas: lista.slice((p - 1) * POR_PAGINA_ADMIN, p * POR_PAGINA_ADMIN).map((u) => ({
        id: u.id, tipo: u.tipo, nombre: u.nombre, correo: u.correo, telefono: u.telefono, estado: u.estado, creado: String(u.creado).slice(0, 10), avatar_v: u.avatar_v,
      })),
    };
  });

  P('/admin/cuentas/:id/eliminar', (c, w) => {
    soloAdmin(c);
    const id = V.id(c.params.id);
    const motivo = V.motivo((c.body || {}).motivo);
    const u = usuarioPorId(w, id);
    if (!u) falla('La cuenta no existe.', 404);
    if (u.tipo === 'admin') falla('No es posible eliminar la cuenta del Administrador.', 403);
    if (u.estado === 'eliminada') falla('La cuenta ya está eliminada.', 409);
    Object.assign(u, { estado: 'eliminada', eliminado_motivo: motivo, eliminado_en: ahora() });
    retirarActividad(w, u, 'La cuenta del adoptante fue eliminada.', 'La cuenta del refugio fue eliminada.');
    w.sesiones = w.sesiones.filter((s) => s.usuario_id !== id);
    return { mensaje: 'Cuenta eliminada.' };
  });

  P('/admin/cuentas/:id/admin', (c) => { soloAdmin(c); throw new ErrorApp(403, 'Solo puede haber un Administrador. Puedes subir la cuenta a Funcionario.'); });

  P('/admin/cuentas/:id/funcionario', (c, w) => {
    soloAdmin(c);
    const id = V.id(c.params.id);
    const u = usuarioPorId(w, id);
    if (!u) falla('La cuenta no existe.', 404);
    if (u.tipo === 'funcionario') falla('La cuenta ya es de Funcionario.', 409);
    if (u.tipo !== 'adoptante' || u.estado !== 'activa') falla('Solo una cuenta de Adoptante activa puede subir a Funcionario.', 409);
    if (w.solicitudes.some((s) => s.adoptante_id === id && ['pendiente', 'aprobada'].includes(s.estado) && !s.concretada_en)) {
      falla('La cuenta tiene solicitudes de adopción activas. Deben cerrarse antes de subirla a Funcionario.', 409);
    }
    u.tipo = 'funcionario';
    w.sesiones = w.sesiones.filter((s) => s.usuario_id !== id);
    notificar(w, id, 'Tu cuenta ahora es de Funcionario: puedes atender reportes y ver estadísticas.', '#/admin');
    return { mensaje: `${u.nombre} ahora es Funcionario.` };
  });

  P('/admin/cuentas/:id/quitar-funcionario', (c, w) => {
    soloAdmin(c);
    const id = V.id(c.params.id);
    const u = usuarioPorId(w, id);
    if (!u || u.tipo !== 'funcionario') falla('La cuenta no es de Funcionario.', 409);
    u.tipo = 'adoptante';
    w.sesiones = w.sesiones.filter((s) => s.usuario_id !== id);
    return { mensaje: 'La cuenta volvió a ser de Adoptante.' };
  });

  /* Catálogos editables */
  const EDITABLES = ['tamano', 'edad', 'tipo_requisito', 'vacuna', 'documento'];
  const nombreValor = (v) => {
    const n = limpiar(v).replace(/\s+/g, ' ');
    if (!n || [...n].length > 50) falla('El nombre del valor debe tener de 1 a 50 caracteres.');
    return n;
  };
  const duplicadoCat = (w, catalogo, nombre, idPropio) => {
    if (w.catalogo_valores.some((v) => v.catalogo === catalogo && v.nombre === nombre && v.id !== idPropio)) {
      falla('Ya existe un valor con el mismo nombre en el catálogo.', 409);
    }
  };
  P('/admin/catalogos', (c, w) => {
    soloAdmin(c);
    const b = c.body || {};
    if (!EDITABLES.includes(b.catalogo)) falla('Seleccione un catálogo.');
    const n = nombreValor(b.nombre);
    duplicadoCat(w, b.catalogo, n, 0);
    const orden = Math.max(0, ...w.catalogo_valores.filter((v) => v.catalogo === b.catalogo).map((v) => v.orden)) + 1;
    insertar(w, 'catalogo_valores', { catalogo: b.catalogo, nombre: n, orden, activo: 1 });
    c.status = 201;
    return { mensaje: 'Valor agregado.' };
  });
  function valorEditable(w, id) {
    const v = w.catalogo_valores.find((x) => x.id === V.id(id));
    if (!v || !EDITABLES.includes(v.catalogo)) falla('El valor no existe.', 404);
    return v;
  }
  PUT('/admin/catalogos/:id', (c, w) => {
    soloAdmin(c);
    const v = valorEditable(w, c.params.id);
    const n = nombreValor((c.body || {}).nombre);
    duplicadoCat(w, v.catalogo, n, v.id);
    v.nombre = n;
    return { mensaje: 'Valor renombrado.' };
  });
  P('/admin/catalogos/:id/desactivar', (c, w) => {
    soloAdmin(c);
    const v = valorEditable(w, c.params.id);
    if (!v.activo) falla('El valor ya está desactivado.', 409);
    v.activo = 0;
    return { mensaje: 'Valor desactivado.' };
  });
  P('/admin/catalogos/:id/activar', (c, w) => {
    soloAdmin(c);
    const v = valorEditable(w, c.params.id);
    if (v.activo) falla('El valor ya está activo.', 409);
    v.activo = 1;
    return { mensaje: 'Valor activado.' };
  });

  /* Reportes (Administrador y Funcionarios) */
  G('/admin/reportes', (c, w) => {
    adminOFuncionario(c);
    const p = V.pagina(c.query.pagina);
    const estado = ['abierto', 'resuelto', 'descartado'].includes(c.query.estado) ? c.query.estado : 'abierto';
    const lista = w.reportes.filter((r) => r.estado === estado).sort((a, b) => (a.creado_en < b.creado_en ? 1 : a.creado_en > b.creado_en ? -1 : b.id - a.id));
    const cuentas = {};
    w.reportes.forEach((r) => { cuentas[r.estado] = (cuentas[r.estado] || 0) + 1; });
    return {
      total: lista.length, pagina: p, porPagina: POR_PAGINA_ADMIN,
      reportes: lista.slice((p - 1) * POR_PAGINA_ADMIN, p * POR_PAGINA_ADMIN).map((r) => {
        const autor = usuarioPorId(w, r.autor_id) || {};
        const ad = r.admin_id ? usuarioPorId(w, r.admin_id) : null;
        let objetivo;
        if (r.objetivo_tipo === 'animal') {
          const a = w.animales.find((x) => x.id === r.objetivo_id);
          objetivo = a ? `${a.nombre} · ${(usuarioPorId(w, a.refugio_id) || {}).nombre}` : null;
        } else objetivo = (usuarioPorId(w, r.objetivo_id) || {}).nombre || null;
        return {
          id: r.id, objetivo_tipo: r.objetivo_tipo, objetivo_id: r.objetivo_id, motivo: r.motivo, descripcion: r.descripcion, estado: r.estado, nota: r.nota,
          creado: String(r.creado_en).slice(0, 16), cerrado: r.cerrado_en ? String(r.cerrado_en).slice(0, 16) : null,
          autor: autor.nombre, autor_correo: autor.correo, autor_tipo: autor.tipo, atendio: ad ? ad.nombre : null, objetivo,
          veces_reportado: w.reportes.filter((x) => x.objetivo_tipo === r.objetivo_tipo && x.objetivo_id === r.objetivo_id).length,
        };
      }),
      cuentas,
    };
  });

  function cerrarReporte(c, w, estado) {
    const nota = V.motivo((c.body || {}).nota, 10, 300, 'La nota debe tener de 10 a 300 caracteres.');
    const rep = w.reportes.find((x) => x.id === V.id(c.params.id));
    if (!rep) falla('El reporte no existe.', 404);
    if (rep.estado !== 'abierto') falla('El reporte ya está resuelto o descartado.', 409);
    Object.assign(rep, { estado, nota, admin_id: c.usuario.id, cerrado_en: ahora() });
    notificar(w, rep.autor_id, `Tu reporte fue ${estado}. Nota: ${nota}`);
  }
  P('/admin/reportes/:id/resolver', (c, w) => { adminOFuncionario(c); cerrarReporte(c, w, 'resuelto'); return { mensaje: 'Reporte resuelto.' }; });
  P('/admin/reportes/:id/descartar', (c, w) => { adminOFuncionario(c); cerrarReporte(c, w, 'descartado'); return { mensaje: 'Reporte descartado.' }; });

  /* Estadísticas */
  G('/admin/estadisticas', (c, w) => { adminOFuncionario(c); return generales(w, c.query); });
  G('/admin/estadisticas.csv', (c, w) => {
    adminOFuncionario(c);
    const e = generales(w, c.query);
    const filas = [
      ['periodo', `${e.inicio} a ${e.fin}`],
      ['animales_publicados', e.animales_publicados],
      ['adopciones_concretadas', e.adopciones_concretadas],
      ['refugios_activos', e.refugios_activos],
      ['solicitudes', e.solicitudes],
      ['tasa_aprobacion_%', e.tasa_aprobacion ?? ''],
      ['dias_promedio_adopcion', e.dias_promedio_adopcion ?? ''],
      ['reportes', e.reportes],
      [],
      [e.agrupado, 'ingresos', 'adopciones', 'solicitudes'],
      ...e.serie.claves.map((k, i) => [k, e.serie.ingresos[i], e.serie.adopciones[i], e.serie.solicitudes[i]]),
    ];
    const csv = `﻿${filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n')}\r\n`;
    return { __raw: csv, tipo: 'text/csv; charset=utf-8', nombre: `estadisticas_dopta_${ahora().slice(0, 10)}.csv` };
  });

  /* ======================= Despachador ======================= */
  async function procesar(metodo, ruta, { cuerpo, rawBody, auto, ip }) {
    const url = new URL(ruta, 'http://local');
    const path = url.pathname.replace(/^\/api/, '');
    const query = Object.fromEntries(url.searchParams.entries());
    const r = RUTAS.find((x) => x.metodo === metodo && x.re.test(path));
    if (!r) {
      return respuesta(404, { error: 'Recurso no encontrado.' });
    }
    const m = path.match(r.re);
    const params = Object.fromEntries(r.nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    // Cada petición trabaja sobre una copia: si algo falla, los datos quedan como estaban
    const trabajo = aPlano(structuredClone(db));
    const c = { params, query, body: cuerpo, rawBody, auto: !!auto, ip, status: 200, usuario: null };
    try {
      await cargarSesion(trabajo, c);
      const resultado = await r.fn(c, trabajo);
      if (c.nuevoToken) guardarToken(c.nuevoToken);
      if (c.borrarToken) quitarToken();
      db = aDb(trabajo);
      guardar();
      if (resultado && resultado.__raw !== undefined) {
        return new Response(resultado.__raw, { status: 200, headers: { 'Content-Type': resultado.tipo, 'Content-Disposition': `attachment; filename="${resultado.nombre}"` } });
      }
      return respuesta(c.status, resultado === undefined ? { ok: true } : resultado);
    } catch (e) {
      if (e instanceof ErrorApp) {
        if (c.borrarToken) quitarToken();
        return respuesta(e.status, { error: e.message, ...(e.extra || {}) });
      }
      console.error('Dopta:', e);
      return respuesta(500, { error: 'Ocurrió un error inesperado. Intente de nuevo.' });
    }
  }
  const respuesta = (status, cuerpo) => new Response(JSON.stringify(cuerpo), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

  /* ======================= Persistencia ======================= */
  let guardadoPendiente = false;
  function guardar() {
    try {
      root.localStorage.setItem(CLAVE_DATOS, JSON.stringify(db));
    } catch (e) {
      console.error('Dopta: no se pudo guardar en el navegador (¿almacenamiento lleno?).', e);
    }
    guardadoPendiente = false;
  }
  function cargarDatos() {
    try {
      const txt = root.localStorage.getItem(CLAVE_DATOS);
      if (txt) {
        const d = JSON.parse(txt);
        if (d && d.t) return d;
      }
    } catch { /* datos dañados: se empieza de nuevo */ }
    return { seq: {}, t: Object.fromEntries(TABLAS.map((t) => [t, []])) };
  }

  /* Tablas en forma de propiedades directas (db.t.x → w.x) para que las rutas sean legibles */
  function aPlano(d) {
    const w = { seq: d.seq || {} };
    TABLAS.forEach((t) => { w[t] = d.t[t] || []; });
    return w;
  }
  function aDb(w) {
    const t = {};
    TABLAS.forEach((n) => { t[n] = w[n]; });
    return { seq: w.seq, t };
  }
  /* Sustituye el uso de db.t por el espacio plano en procesar() */
  const estado = { w: null };
  void estado;

  /* ======================= Mantenimiento e inicio ======================= */
  function mantenimientoPeriodico() {
    const trabajo = aPlano(structuredClone(db));
    mantenimiento(trabajo);
    db = aDb(trabajo);
    guardar();
  }

  async function inicializar() {
    db = cargarDatos();
    if (!db.t.catalogo_valores.length) {
      db.t.catalogo_valores = (await (await fetch('data/catalogos.json')).json());
      TABLAS.forEach((t) => { if (!db.t[t]) db.t[t] = []; });
    }
    ESTATICO.razas = await (await fetch('data/razas.json')).json();
    ESTATICO.cp = await (await fetch('data/cp_cdmx.json')).json();
    mantenimientoPeriodico();
    setInterval(mantenimientoPeriodico, 15 * 60 * 1000);
  }

  const listo = inicializar().catch((e) => console.error('Dopta: no se pudieron cargar los datos.', e));

  /* ======================= Puente de fetch ======================= */
  const fetchOriginal = root.fetch ? root.fetch.bind(root) : null;
  if (fetchOriginal && typeof root.location !== 'undefined') {
    root.fetch = async (entrada, opciones = {}) => {
      const url = typeof entrada === 'string' ? entrada : entrada.url;
      if (!/^\/api\//.test(url) && !/^https?:\/\/[^/]+\/api\//.test(url)) return fetchOriginal(entrada, opciones);
      await listo;
      const metodo = String(opciones.method || 'GET').toUpperCase();
      const ruta = url.replace(/^https?:\/\/[^/]+/, '');
      let cuerpo; let rawBody;
      if (opciones.body instanceof Blob) rawBody = await opciones.body.arrayBuffer();
      else if (typeof opciones.body === 'string') {
        try { cuerpo = JSON.parse(opciones.body); } catch { return respuesta(400, { error: 'Solicitud inválida.' }); }
      }
      const auto = !!(opciones.headers && (opciones.headers['X-Dopta-Auto'] === '1' || opciones.headers.get?.('X-Dopta-Auto') === '1'));
      // Las solicitudes se procesan una por una: así no se mezclan los cambios de dos acciones a la vez
      const turno = cola.then(() => procesar(metodo, ruta, { cuerpo, rawBody, auto, ip: 'local' }));
      cola = turno.catch(() => {});
      return turno;
    };
  }
  let cola = Promise.resolve();

  /* ======================= Uso desde la consola / funciones de administración ======================= */
  async function crearAdministrador(correo, nombre, clave) {
    await listo;
    if (db.t.usuarios.some((u) => u.tipo === 'admin')) return 'Ya existe un Administrador. Solo puede haber uno.';
    const mail = limpiar(correo).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail)) return 'Correo no válido.';
    if (!entre(limpiar(nombre), 2, 100)) return 'Nombre no válido.';
    V.contrasena(clave);
    const t = ahora();
    const w = aPlano(db);
    insertar(w, 'usuarios', {
      tipo: 'admin', nombre: limpiar(nombre), correo: mail, telefono: null, hash: await hashClave(clave), estado: 'activa',
      aviso_version: AVISO_VERSION, aviso_fecha: `${t.slice(0, 16)}:00`, creado: t, verificado_en: null, rechazado_en: null, baja_en: null,
      purgar_en: null, purgado: 0, eliminado_motivo: null, eliminado_en: null, mayor_edad_en: null, avatar_v: 0,
    });
    db = aDb(w);
    guardar();
    return 'Administrador creado. Inicie sesión con ese correo.';
  }

  function urlAvatar(usuarioId) {
    const a = db.t.avatares.find((x) => x.usuario_id === Number(usuarioId));
    return a ? a.datos : '';
  }

  function exportarRespaldo() {
    return JSON.stringify(db, null, 1);
  }
  async function importarRespaldo(texto) {
    await listo;
    const d = JSON.parse(texto);
    if (!d || !d.t || !Array.isArray(d.t.usuarios)) throw new Error('El archivo no es un respaldo de Dopta.');
    db = { seq: d.seq || {}, t: Object.fromEntries(TABLAS.map((t) => [t, d.t[t] || []])) };
    guardar();
    return 'Respaldo restaurado.';
  }

  root.DoptaServidor = { listo, crearAdministrador, urlAvatar, exportarRespaldo, importarRespaldo };
  // Compatibilidad con el código de la aplicación: las rutas de catálogo usan estos mismos datos
  void aSolicitud; void guardadoPendiente; void tarjeta; void usuarioPorId;
})();
