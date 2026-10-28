/* ==========================================================================
   Dopta · Aplicación web de una sola página
   Secciones: tema · seguridad · API · estado · razas · componentes · vistas · router · efectos
   ========================================================================== */
(() => {
  'use strict';

  /* ======================= 1. Tema (antes de pintar) ======================= */
  const CLAVE_TEMA = 'dopta-tema';
  const raizDoc = document.documentElement;
  const leerLS = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
  const guardarLS = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } };
  const aplicarTema = (t) => (t === 'oscuro' ? raizDoc.setAttribute('data-theme', 'oscuro') : raizDoc.removeAttribute('data-theme'));
  aplicarTema(leerLS(CLAVE_TEMA));

  /* Si alguien incrusta Dopta en un iframe ajeno, se sale de él (además de frame-ancestors del servidor) */
  if (window.top !== window.self) {
    try { window.top.location = window.self.location; } catch { document.documentElement.hidden = true; }
  }

  /* ======================= 2. Seguridad del lado del cliente ======================= */
  /* Todo texto que viene del usuario o del servidor se convierte a entidades HTML antes de mostrarse */
  const ENTIDADES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;', '=': '&#61;', '/': '&#47;' };
  const esc = (v) => String(v ?? '').replace(/[&<>"'`=/]/g, (c) => ENTIDADES[c]);

  class Seguro { constructor(s) { this.s = s; } toString() { return this.s; } }
  const seguro = (s) => new Seguro(String(s));
  const fmt = (v) => {
    if (v instanceof Seguro) return v.s;
    if (Array.isArray(v)) return v.map(fmt).join('');
    if (v === null || v === undefined || v === false) return '';
    return esc(v);
  };
  /* Plantilla que escapa automáticamente cada valor interpolado */
  const html = (partes, ...valores) => seguro(partes.reduce((acc, p, i) => acc + p + (i < valores.length ? fmt(valores[i]) : ''), ''));
  const si = (cond, attr) => seguro(cond ? ` ${attr}` : '');

  /* Mientras se escribe, se eliminan los símbolos < > y caracteres invisibles de control */
  const RE_SIMBOLOS_PRUEBA = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/;
  const RE_SIMBOLOS = /[<>\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮]/g;
  const SIN_LIMPIEZA = ['password', 'file', 'date', 'time', 'checkbox', 'radio', 'number', 'range', 'color'];
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) || SIN_LIMPIEZA.includes(el.type)) return;
    if (!RE_SIMBOLOS_PRUEBA.test(el.value)) return;
    const pos = el.selectionStart ?? el.value.length;
    const antes = el.value.length;
    el.value = el.value.replace(RE_SIMBOLOS, '');
    const nueva = Math.max(0, pos - (antes - el.value.length));
    try { el.setSelectionRange(nueva, nueva); } catch { /* tipos sin selección */ }
  }, true);

  /* Solo se aceptan destinos internos conocidos para redirigir (evita redirecciones abiertas) */
  const rutaSegura = (destino) => {
    if (typeof destino !== 'string' || destino.length > 200) return null;
    if (!/^#\/[A-Za-z0-9\-/]*(\?[A-Za-z0-9=&_\-]*)?$/.test(destino) || destino.includes('//')) return null;
    const ruta = destino.slice(1).split('?')[0].replace(/\/+$/, '') || '/';
    return RUTAS.some((r) => r.re.test(ruta)) ? destino : null;
  };

  const idValido = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 4294967295 ? n : null; };

  /* Aviso en consola contra el "self-XSS" (pegar código que alguien te pasó) */
  console.log('%c¡Alto!', 'color:#c9553a;font-size:28px;font-weight:bold');
  console.log('%cNo pegues aquí código que alguien te haya enviado: podría robar tu cuenta de Dopta.', 'font-size:14px');

  /* ======================= 3. Cliente de la API ======================= */
  /* Debe coincidir con "version" de package.json: si no, el navegador tiene una copia vieja en caché */
  const VERSION_APP = '1.4.0';
  let versionAvisada = false;
  class ErrorApi extends Error {
    constructor(status, mensaje, datos) { super(mensaje || ''); this.status = status; this.datos = datos || {}; }
  }
  /* Mensaje para el usuario: los fallos de red o del servidor muestran el texto del caso de uso */
  const textoError = (e, porDefecto = 'No se pudo completar la operación. Intente de nuevo.') => {
    if (e && e.datos && e.datos.codigo === 'BD' && e.message) return e.message; // causa exacta (MySQL apagado, .env, etc.)
    return !e || e.status === 0 || e.status >= 500 || !e.message ? porDefecto : e.message;
  };

  let ultimaServidor = Date.now();
  async function api(ruta, { metodo = 'GET', datos, form, auto = false } = {}) {
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), 20000);
    const headers = { 'X-Dopta': '1', Accept: 'application/json' };
    if (auto) headers['X-Dopta-Auto'] = '1';
    let body;
    if (form) body = form;
    else if (datos !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(datos); }
    let res;
    try {
      res = await fetch(`/api${ruta}`, { method: metodo, headers, body, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: ctrl.signal });
    } catch {
      throw new ErrorApi(0, '');
    } finally {
      clearTimeout(reloj);
    }
    if (!auto) ultimaServidor = Date.now();
    const vServidor = res.headers.get('X-Dopta-Version');
    if (vServidor && vServidor !== VERSION_APP && !versionAvisada) {
      versionAvisada = true;
      setTimeout(() => aviso(`Hay una versión distinta de Dopta en el servidor (${vServidor}). Recarga la página con Ctrl + F5.`, 'error'), 0);
    }
    let j = null;
    try { j = await res.json(); } catch { /* respuesta sin JSON */ }
    if (!res.ok) {
      if (res.status === 401 && j && j.codigo === 'SESION' && estado.usuario) sesionTerminada(j.error);
      throw new ErrorApi(res.status, j && j.error, j);
    }
    return j;
  }

  /* ======================= 4. Estado de la aplicación ======================= */
  const estado = { usuario: null, panel: '#/', noLeidas: 0, catalogos: null, flash: null, rechazado: null, perfil: null };

  async function catalogos(refrescar = false) {
    if (!estado.catalogos || refrescar) estado.catalogos = await api('/catalogos');
    return estado.catalogos;
  }
  const activos = (lista) => lista.filter((x) => x.activo);

  /* Fecha de hoy y operaciones en hora de la Ciudad de México */
  const hoyCDMX = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
  const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const diaSemana = (f) => (new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7;
  const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  /* Nacimiento más antiguo posible según la edad ("3 meses", "2 años"), con margen de una unidad */
  const nacimientoMinimo = (edadNombre, base) => {
    const m = String(edadNombre || '').match(/(\d+)\s*(mes|año|ano)/i);
    if (!m) return null;
    const n = Number(m[1]) + 1;
    const d = new Date(`${base}T12:00:00Z`);
    if (/^mes/i.test(m[2])) d.setUTCMonth(d.getUTCMonth() - n); else d.setUTCFullYear(d.getUTCFullYear() - n);
    return d.toISOString().slice(0, 10);
  };
  const fechaBonita = (f) => {
    if (!f) return '';
    const d = new Date(`${String(f).slice(0, 10)}T12:00:00Z`);
    return `${DIAS[(d.getUTCDay() + 6) % 7]} ${new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(d)}`;
  };

  /* ======================= 5. Razas e ilustraciones ======================= */
  const RAZAS = Array.isArray(window.DOPTA_RAZAS) ? window.DOPTA_RAZAS : [];
  const RAZA = Object.fromEntries(RAZAS.map((r) => [r.id, r]));
  const SVG_MESTIZO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="M15 34C5 12 20 3 35 19L28 40Z" fill="#8B6A58"/><path d="M85 34C95 12 80 3 65 19L72 40Z" fill="#311501"/><rect x="16" y="17" width="68" height="72" rx="26" fill="#EAD7C4"/><path d="M42 17H50V89H42C28 89 16 77 16 63V43C16 29 28 17 42 17Z" fill="#C59870"/><circle cx="68" cy="31" r="8" fill="#8B6A58"/><circle cx="36" cy="47" r="5" fill="#311501"/><circle cx="64" cy="47" r="5" fill="#311501"/><rect x="33" y="58" width="34" height="23" rx="11.5" fill="#F6EEE6"/><rect x="43" y="60" width="14" height="9" rx="4.5" fill="#311501"/><path d="M50 69V75" stroke="#311501" stroke-width="2.5" stroke-linecap="round"/></svg>';
  const SVG_HUELLA = '<svg class="tarjeta__foto-vacia" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="10" r="2"/><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="19" cy="10" r="2"/><path d="M12 11c-3 0-6 4-6 7 0 1.5 1.2 2.5 2.6 2.5 1.3 0 2.2-.7 3.4-.7s2.1.7 3.4.7c1.4 0 2.6-1 2.6-2.5 0-3-3-7-6-7z"/></svg>';

  /* Un mestizo se muestra con el dibujo de la raza a la que más se parece */
  const dibujo = (a) => {
    if (a.raza !== 'mestizo' && RAZA[a.raza]) return seguro(RAZA[a.raza].svg);
    if (a.raza_aprox && RAZA[a.raza_aprox]) return seguro(RAZA[a.raza_aprox].svg);
    return seguro(a.raza === 'mestizo' ? SVG_MESTIZO : SVG_HUELLA);
  };
  const nombreRaza = (a) => {
    if (a.raza === 'mestizo') return a.raza_aprox && RAZA[a.raza_aprox] ? `Mestizo · parecido a ${RAZA[a.raza_aprox].nombre}` : 'Mestizo';
    return RAZA[a.raza] ? RAZA[a.raza].nombre : 'Raza no indicada';
  };
  const razaCorta = (a) => (a.raza === 'mestizo' ? 'Mestizo' : (RAZA[a.raza] ? RAZA[a.raza].nombre : 'Raza'));
  const imagenAnimal = (a) => dibujo(a); // sin fotos: siempre la ilustración de la raza

  /* ======================= 6. Iconos ======================= */
  const ICONO = {
    ojo: seguro('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'),
    ojoCerrado: seguro('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.9 17.9A10.4 10.4 0 0 1 12 19c-6.4 0-10-7-10-7a18.4 18.4 0 0 1 5.1-5.9M9.9 5.2A9.6 9.6 0 0 1 12 5c6.4 0 10 7 10 7a18.6 18.6 0 0 1-2.2 3.2M14.1 14.2a3 3 0 0 1-4.2-4.2"/><path d="M2 2l20 20"/></svg>'),
    ubicacion: seguro('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="7"/></svg>'),
    casa: seguro('<svg class="boton-pastilla__icono" viewBox="0 0 97 126" fill="currentColor" aria-hidden="true"><path d="M45.46 1.23828C47.0357 -0.412501 49.6713 -0.412501 51.2471 1.23828L95.5928 47.6953C98.0221 50.2408 96.218 54.457 92.6992 54.457H88.3535V123.207C88.3534 124.312 87.458 125.207 86.3535 125.207H70.3535C69.249 125.207 68.3536 124.311 68.3535 123.207V90.207C68.3535 89.1025 67.4581 88.207 66.3535 88.207H31.3535C30.249 88.2071 29.3535 89.1025 29.3535 90.207V123.207C29.3534 124.312 28.458 125.207 27.3535 125.207H9.35352C8.80132 125.207 8.35362 124.759 8.35352 124.207V54.457H4.00781C0.489148 54.4569 -1.31494 50.2408 1.11426 47.6953L45.46 1.23828ZM33.3535 61.207C30.5921 61.2071 28.3535 63.2218 28.3535 65.707C28.3535 66.1746 28.433 66.6259 28.5801 67.0498C29.0247 68.3317 29.0248 70.0824 28.5801 71.3643C28.433 71.7883 28.3535 72.2394 28.3535 72.707C28.3536 75.1922 30.5922 77.207 33.3535 77.207C35.2463 77.207 36.8934 76.2601 37.7422 74.8643C38.2671 74.0011 39.0816 73.207 40.0918 73.207H58.8838C59.15 73.2072 59.3535 73.4408 59.3535 73.707C59.3536 76.1922 61.5922 78.207 64.3535 78.207C67.1149 78.207 69.3534 76.1922 69.3535 73.707C69.3535 73.2395 69.274 72.7881 69.127 72.3643C68.6821 71.0821 68.682 69.3309 69.127 68.0488C69.274 67.6251 69.3535 67.1745 69.3535 66.707C69.3535 64.2217 67.1149 62.207 64.3535 62.207C62.4607 62.207 60.8136 63.1539 59.9648 64.5498C59.44 65.4128 58.6253 66.207 57.6152 66.207H38.8232C38.5571 66.2068 38.3536 65.9732 38.3535 65.707C38.3535 63.2217 36.1149 61.207 33.3535 61.207Z"/></svg>'),
    campana: seguro('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>'),
    atras: seguro('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'),
    quitar: seguro('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>'),
    lupa: seguro('<svg class="buscador__icono" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'),
    subir: seguro('<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 20h16"/></svg>'),
  };

  /* ======================= 7. Utilidades de interfaz ======================= */
  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];
  let app;

  function aviso(texto, tipo = 'exito') {
    const caja = $('#avisos');
    if (!caja) return;
    const p = document.createElement('p');
    p.className = `mensaje mensaje--${tipo}`;
    p.textContent = texto;
    caja.appendChild(p);
    setTimeout(() => p.remove(), 4800);
  }

  const ocupado = (boton, si = true) => {
    if (!boton) return;
    boton.disabled = si;
    boton.setAttribute('aria-busy', String(si));
  };

  const errorEn = (raiz, texto = '') => {
    const caja = $('[data-error]', raiz);
    if (caja) caja.textContent = texto;
    if (texto && caja) caja.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const datosForm = (form) => {
    const o = {};
    new FormData(form).forEach((v, k) => { if (typeof v === 'string') o[k] = v.trim(); });
    return o;
  };

  /* Contadores de caracteres para campos con maxlength */
  function montarContadores(raiz) {
    $$('textarea[maxlength]', raiz).forEach((t) => {
      const c = document.createElement('span');
      c.className = 'contador';
      const max = Number(t.maxLength);
      const pintar = () => { c.textContent = `${[...t.value].length} / ${max}`; c.classList.toggle('contador--limite', [...t.value].length >= max); };
      t.after(c);
      t.addEventListener('input', pintar);
      pintar();
    });
  }

  /* Diálogo modal reutilizable. "accion" recibe el formulario; si lanza error, se muestra dentro. */
  function dialogo({ titulo, texto = '', cuerpo = '', confirmar = 'Confirmar', cancelar = 'Cancelar', peligro = false, accion, montar, ancho = false }) {
    return new Promise((resolver) => {
      const d = document.createElement('dialog');
      d.className = ancho ? 'dialogo dialogo--ancho' : 'dialogo';
      d.setAttribute('aria-labelledby', 'dialogo-titulo');
      d.innerHTML = String(html`
        <form class="dialogo__contenido" novalidate>
          <h2 class="dialogo__titulo" id="dialogo-titulo">${titulo}</h2>
          ${texto ? html`<p class="dialogo__texto">${texto}</p>` : ''}
          ${cuerpo}
          <p class="mensaje mensaje--error" data-error role="alert"></p>
          <div class="acciones acciones--fin">
            ${cancelar ? html`<button class="boton-contorno boton-contorno--chico" type="button" data-cancelar>${cancelar}</button>` : ''}
            <button class="boton-contorno boton-contorno--chico ${peligro ? 'boton-contorno--peligro' : 'boton-contorno--relleno'}" type="submit">${confirmar}</button>
          </div>
        </form>`);
      document.body.appendChild(d);
      const form = $('form', d);
      let listo = false;
      const cerrar = (valor) => { if (listo) return; listo = true; d.close(); d.remove(); resolver(valor); };
      d.addEventListener('cancel', (e) => { e.preventDefault(); cerrar(false); });
      d.addEventListener('click', (e) => { if (e.target === d) cerrar(false); });
      const btnCancelar = $('[data-cancelar]', d);
      if (btnCancelar) btnCancelar.addEventListener('click', () => cerrar(false));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!accion) return cerrar(true);
        const boton = $('button[type="submit"]', form);
        ocupado(boton);
        errorEn(form, '');
        try {
          const r = await accion(form);
          cerrar(r === undefined ? true : r);
        } catch (err) {
          errorEn(form, err instanceof ErrorApi ? textoError(err) : err.message);
          ocupado(boton, false);
        }
      });
      montarContadores(d);
      montarOjitos(d);
      if (montar) montar(d);
      d.showModal();
      const primero = $('input, select, textarea', d);
      if (primero) primero.focus();
    });
  }

  /* ======================= 8. Validaciones (mismos mensajes que el servidor) ======================= */
  const RE_CORREO = /^[^\s@"'<>()\\,;:]+@[^\s@"'<>()\\,;:]+\.[A-Za-z]{2,}$/;
  const largo = (v) => [...String(v || '')].length;
  const M = {
    vacios: 'Complete todos los campos obligatorios.',
    correo: 'Ingrese un correo electrónico válido.',
    contrasena: 'La contraseña debe tener de 8 a 64 caracteres, con al menos una letra y un número.',
    nombre: 'El nombre debe tener entre 2 y 100 caracteres y solo letras y espacios.',
    refugio: 'El nombre del refugio debe tener de 3 a 120 caracteres.',
    institucion: 'El nombre de la institución debe tener de 3 a 120 caracteres.',
    calle: 'La calle debe tener de 3 a 100 caracteres, con letras (puede incluir números y . , - #).',
    numExt: 'El número exterior debe ser un número (ej. 1200, 15-B o 12A) o S/N si no tiene.',
    numInt: 'El número interior puede tener hasta 10 letras o números (ej. 3, B, Depto 4).',
    colonia: 'La colonia debe tener de 3 a 80 caracteres, con letras.',
    cp: 'El código postal debe tener exactamente 5 dígitos.',
    cpCdmx: 'El código postal no pertenece a la Ciudad de México (debe estar entre 01000 y 16999).',
    telefono: 'El teléfono debe tener exactamente 10 dígitos numéricos.',
    telefonoReal: 'Ingrese un teléfono real: no puede empezar con 0 o 1 ni ser una serie como 0000000000 o 1234567890.',
    letras: 'El nombre debe incluir letras, no solo números o símbolos.',
    horario: 'El horario de apertura debe ser menor que el horario de cierre, en formato HH:MM de 24 horas.',
    aviso: 'Debe aceptar el aviso de privacidad para crear una cuenta.',
    coinciden: 'Las contraseñas no coinciden.',
    alcaldia: 'Seleccione una alcaldía de la lista.',
  };
  const V = {
    correo: (v) => !!v && v.length <= 254 && RE_CORREO.test(v),
    contrasena: (v) => typeof v === 'string' && v.length >= 8 && v.length <= 64 && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(v) && /\d/.test(v),
    nombre: (v) => largo(v) >= 2 && largo(v) <= 100 && /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+$/.test(v),
    entre: (v, a, b) => largo(v) >= a && largo(v) <= b,
    telefono: (v) => /^\d{10}$/.test(v),
    // Mismas reglas de coherencia que el servidor (server/util.js)
    telefonoReal: (t) => /^[2-9]\d{9}$/.test(t) && !/^(\d)\1{9}$/.test(t)
      && !'01234567890123456789'.includes(t) && !'98765432109876543210'.includes(t),
    letras: (t, n = 2) => (String(t).match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length >= n,
  };
  const fallo = (m) => { throw new Error(m); };

  /* Reglas de nombres: idénticas a problemaNombre() en server/util.js */
  const sinAcentos = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const GROSERIAS = new Set(['puta', 'puto', 'putas', 'putos', 'pendejo', 'pendeja', 'pendejos', 'pendejas', 'verga', 'vergas',
    'chinga', 'chingada', 'chingado', 'chingar', 'culero', 'culera', 'culo', 'mierda', 'cabron', 'cabrona', 'mamada', 'mamadas',
    'joto', 'zorra', 'estupido', 'estupida', 'idiota', 'imbecil', 'pinche', 'marica', 'maricon', 'ojete', 'nazi', 'hitler', 'naco', 'naca']);
  const GENERICOS = new Set(['perro', 'perra', 'perrito', 'perrita', 'can', 'mascota', 'animal', 'sin nombre', 'ninguno', 'ninguna',
    'nombre', 'test', 'prueba', 'asdf', 'qwerty', 'xxx', 'na', 'no', 'si', 'desconocido', 'desconocida', 'callejero', 'callejera']);
  function problemaNombre(texto, tipo) {
    const n = String(texto || '').trim().replace(/\s+/g, ' ');
    const plano = sinAcentos(n);
    if (tipo === 'refugio' && !/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,&()\-]+$/.test(n)) return 'El nombre solo puede tener letras, números, espacios y . , & ( ) -';
    if (/(.)\1\1/.test(plano.replace(/\s/g, ''))) return 'El nombre no puede repetir la misma letra 3 o más veces seguidas.';
    if (!/[aeiouy]/.test(plano)) return 'El nombre debe incluir al menos una vocal.';
    if (plano.split(/[^a-z]+/).some((x) => GROSERIAS.has(x))) return 'El nombre contiene palabras no permitidas.';
    if (tipo === 'perro') {
      if (GENERICOS.has(plano) || RAZAS.some((x) => sinAcentos(x.nombre) === plano)) return 'Escriba el nombre del perro, no un término genérico o el nombre de su raza.';
      if (plano.split(' ').length > 3) return 'El nombre del perro puede tener máximo 3 palabras.';
    }
    if (tipo === 'persona' && plano.split(' ').length > 6) return 'El nombre puede tener máximo 6 palabras.';
    if (tipo === 'persona' && plano.split(' ').every((x) => x.length === 1)) return 'Escriba el nombre completo, no solo iniciales.';
    return null;
  }
  const revisarNombre = (n, tipo) => { const p = problemaNombre(n, tipo); if (p) fallo(p); };

  /* ======================= 9. Componentes ======================= */
  const botonRegresar = (destino, etiqueta = 'Regresar') => html`
    <a class="boton-contorno boton-contorno--icono" href="${destino}" aria-label="${etiqueta}" data-regresar>${ICONO.atras}</a>`;

  const insignia = (estadoTxt, texto) => html`<span class="insignia insignia--${estadoTxt}">${texto || estadoTxt}</span>`;
  const ETQ = {
    pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada', disponible: 'Disponible', adoptado: 'Adoptado',
    abierto: 'Abierto', resuelto: 'Resuelto', descartado: 'Descartado', activa: 'Activa', baja: 'Dada de baja', eliminada: 'Eliminada',
    adoptante: 'Adoptante', refugio: 'Refugio', admin: 'Administrador',
  };

  /* Tarjeta del catálogo con la ilustración de la raza */
  const tarjetaAnimal = (a, { enlace = true, pie = '' } = {}) => {
    const interior = html`
      <p class="tarjeta__raza">${razaCorta(a)}</p>
      <div class="tarjeta__foto">${imagenAnimal(a)}</div>
      <p class="tarjeta__datos">${a.nombre}<span>${[a.edad, a.tamano].filter(Boolean).join(' · ')}</span></p>
      ${pie}`;
    return enlace
      ? html`<li><a class="tarjeta" href="#/animal/${a.id}" aria-label="${a.nombre}, ${nombreRaza(a)}">${interior}</a></li>`
      : html`<li><article class="tarjeta ${a.estado === 'adoptado' ? 'tarjeta--adoptado' : ''}">${interior}</article></li>`;
  };

  const opciones = (lista, seleccionado, vacio) => html`
    ${vacio ? html`<option value="">${vacio}</option>` : ''}
    ${lista.filter((x) => x.activo || x.id === Number(seleccionado)).map((x) => html`<option value="${x.id}"${si(x.id === Number(seleccionado), 'selected')}>${x.nombre}${x.activo ? '' : ' (inactivo)'}</option>`)}`;

  /* Selector visual de raza. Si se elige "Mestizo" aparece un segundo selector para la raza más parecida. */
  const tileRaza = (nombre, id, etiqueta, svg, marcado, clase = '') => html`
    <label class="raza ${clase}" data-nombre="${etiqueta.toLowerCase()}">
      <input type="radio" name="${nombre}" value="${id}"${si(marcado, 'checked')}>
      <span class="raza__cuerpo">${seguro(svg)}<span class="raza__nombre">${etiqueta}</span></span>
    </label>`;

  const selectorRazas = (raza = '', aprox = '') => html`
    <fieldset class="campo campo--ancho razas" data-razas>
      <legend class="campo__etiqueta">Raza del perro</legend>
      <div class="razas__cabecera">
        <span class="campo__ayuda">Toca la ilustración que corresponda. Si es una cruza, elige “Mestizo”.</span>
        <input class="campo__entrada razas__buscar" type="search" placeholder="Buscar raza" aria-label="Buscar raza" data-filtro="principal">
      </div>
      <div class="razas__grid" role="radiogroup" aria-label="Razas" data-grid="principal">
        ${tileRaza('raza', 'mestizo', 'Mestizo', SVG_MESTIZO, raza === 'mestizo', 'raza--mestizo')}
        ${RAZAS.map((r) => tileRaza('raza', r.id, r.nombre, r.svg, raza === r.id))}
      </div>
      <div class="razas__aprox" data-aprox${si(raza !== 'mestizo', 'hidden')}>
        <div class="razas__cabecera">
          <div>
            <p class="razas__aprox-titulo">¿A qué raza se parece más?</p>
            <p class="campo__ayuda">Se usará su ilustración en el catálogo y ayudará a quien busque esa raza.</p>
          </div>
          <input class="campo__entrada razas__buscar" type="search" placeholder="Buscar raza" aria-label="Buscar raza parecida" data-filtro="aprox">
        </div>
        <div class="razas__grid" role="radiogroup" aria-label="Raza más parecida" data-grid="aprox">
          ${tileRaza('raza_aprox', '', 'No estoy seguro', SVG_MESTIZO, raza === 'mestizo' && !aprox, 'raza--mestizo')}
          ${RAZAS.map((r) => tileRaza('raza_aprox', r.id, r.nombre, r.svg, aprox === r.id))}
        </div>
      </div>
      <div class="razas__vista" data-vista aria-live="polite"></div>
    </fieldset>`;

  function montarRazas(raiz) {
    const caja = $('[data-razas]', raiz);
    if (!caja) return;
    const aproxCaja = $('[data-aprox]', caja);
    const vista = $('[data-vista]', caja);
    const norm = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    $$('[data-filtro]', caja).forEach((inp) => inp.addEventListener('input', () => {
      const t = norm(inp.value.trim());
      $$('.raza', $(`[data-grid="${inp.dataset.filtro}"]`, caja)).forEach((l) => { l.hidden = !!t && !norm(l.dataset.nombre).includes(t); });
    }));
    const pintar = () => {
      const r = ($('input[name="raza"]:checked', caja) || {}).value || '';
      const ap = ($('input[name="raza_aprox"]:checked', caja) || {}).value || '';
      aproxCaja.hidden = r !== 'mestizo';
      if (r === 'mestizo' && !$('input[name="raza_aprox"]:checked', caja)) $('input[name="raza_aprox"][value=""]', caja).checked = true;
      if (!r) { vista.innerHTML = String(html`<p>Elige la raza o “Mestizo” si es una cruza.</p>`); return; }
      const a = { raza: r, raza_aprox: r === 'mestizo' ? ap : '' };
      vista.innerHTML = String(html`${dibujo(a)}<p>Así se verá en el catálogo<strong>${nombreRaza(a)}</strong></p>`);
    };
    caja.addEventListener('change', (e) => {
      if (e.target.name === 'raza' && e.target.value === 'mestizo') aproxCaja.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      pintar();
    });
    pintar();
    // Lleva a la vista la raza ya elegida (al editar)
    const marcada = $('input[name="raza"]:checked', caja);
    if (marcada) marcada.closest('.raza').scrollIntoView({ block: 'nearest' });
  }

  /* Editor del horario de atención por día (RF-04) */
  const editorHorario = (horario = []) => html`
    <div class="horario" data-horario>
      ${DIAS.map((d, i) => {
    const h = horario.find((x) => Number(x.dia) === i) || { cerrado: i >= 5 ? 1 : 0, abre: '09:00', cierra: '17:00' };
    const cerrado = !!Number(h.cerrado);
    return html`
        <div class="horario__dia ${cerrado ? 'esta-cerrado' : ''}" data-dia="${i}">
          <span class="horario__nombre">${d}</span>
          <label class="horario__cerrado"><input type="checkbox" data-cerrado${si(cerrado, 'checked')}> Cerrado</label>
          <input class="campo__entrada" type="time" aria-label="${d}: apertura" data-abre value="${h.abre || '09:00'}">
          <input class="campo__entrada" type="time" aria-label="${d}: cierre" data-cierra value="${h.cierra || '17:00'}">
        </div>`;
  })}
    </div>`;

  function montarHorario(raiz) {
    $$('[data-horario] [data-cerrado]', raiz).forEach((c) => c.addEventListener('change', () => {
      c.closest('.horario__dia').classList.toggle('esta-cerrado', c.checked);
    }));
  }
  function leerHorario(raiz) {
    const aMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    const lista = $$('[data-horario] .horario__dia', raiz).map((f) => {
      if ($('[data-cerrado]', f).checked) return { cerrado: true };
      const abre = $('[data-abre]', f).value;
      const cierra = $('[data-cierra]', f).value;
      const dia = DIAS[Number(f.dataset.dia)];
      if (!/^\d{2}:\d{2}$/.test(abre) || !/^\d{2}:\d{2}$/.test(cierra) || abre >= cierra) fallo(`${M.horario} (${dia})`);
      if (aMin(cierra) - aMin(abre) < 60) fallo(`Cada día abierto debe tener al menos 1 hora de atención (${dia}).`);
      return { abre, cierra };
    });
    if (lista.every((d) => d.cerrado)) fallo('Indique al menos un día abierto para poder agendar citas.');
    return lista;
  }

  /* Tarjeta de refugio para búsquedas y listado */
  const tarjetaRefugio = (r) => html`
    <li><a class="tarjeta-refugio" href="#/refugios/${r.id}">
      <img src="img/logo-dopta.svg" alt="" width="48" height="43">
      <span class="tarjeta-refugio__texto"><strong>${r.nombre}</strong><span>${r.alcaldia || 'Ciudad de México'}${r.km != null ? html` · <b class="distancia">${r.aprox ? '≈ ' : ''}${r.km < 1 ? `${Math.round(r.km * 1000)} m` : `${r.km.toFixed(1)} km`}</b>` : ''}</span></span>
      <span class="insignia insignia--disponible">${r.disponibles} ${r.disponibles === 1 ? 'perro' : 'perros'}</span>
    </a></li>`;

  /* Ubicación actual del navegador (pide permiso al usuario). Solo funciona en https o localhost. */
  function ubicacionActual() {
    return new Promise((ok, mal) => {
      if (!window.isSecureContext || !navigator.geolocation) return mal(new Error('Tu navegador no permite usar la ubicación aquí (se necesita https o localhost).'));
      navigator.geolocation.getCurrentPosition(
        (p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) => mal(new Error(e.code === 1 ? 'No diste permiso para usar tu ubicación. Actívalo en el candado de la barra de direcciones.' : 'No se pudo obtener tu ubicación. Intenta de nuevo.')),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
      );
    });
  }
  /* Distancia en línea recta (km) entre dos puntos */
  const distanciaKm = (a, b) => {
    const rad = (x) => (x * Math.PI) / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };

  /* ¿Está abierto ahora? (hora de la CDMX) */
  const abiertoAhora = (horario) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Mexico_City', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).map((x) => [x.type, x.value]));
    const ahora = `${p.hour}:${p.minute}`;
    const h = horario.find((x) => Number(x.dia) === diaSemana(hoyCDMX()));
    return !!h && !Number(h.cerrado) && ahora >= h.abre && ahora < h.cierra;
  };

  /* Opciones cerradas de salud y temperamento (definidas en el servidor, llegan con /api/catalogos) */
  const CAMPOS_SALUD = ['salud_general', 'tratamiento'];
  const CAMPOS_TEMP = ['temp_general', 'temp_perros', 'temp_desconocidos', 'temp_comida'];
  const etiquetaOpcion = (cat, campo, valor) => (cat && cat.animal && cat.animal[campo] && cat.animal[campo].opciones[valor]) || '';
  const grupoCerrado = (cat, campo, valor) => {
    const def = cat.animal[campo];
    return html`
      <fieldset class="pregunta pregunta--compacta" data-cerrado="${campo}">
        <legend class="pregunta__titulo">${def.titulo}</legend>
        <div class="pregunta__opciones">
          ${Object.entries(def.opciones).map(([k, t]) => html`<label class="opcion"><input type="radio" name="${campo}" value="${k}"${si(k === valor, 'checked')}><span class="opcion__texto">${t}</span></label>`)}
        </div>
      </fieldset>`;
  };
  /* Lista de salud y temperamento para mostrar en fichas (con respaldo al texto libre de versiones anteriores) */
  const listaRasgos = (cat, a, campos, textoAnterior) => {
    const filas = campos.filter((c) => a[c]).map((c) => html`<li><span>${cat.animal[c].titulo}</span><strong>${etiquetaOpcion(cat, c, a[c])}</strong></li>`);
    if (filas.length) return html`<ul class="lista-simple">${filas}</ul>`;
    return textoAnterior ? html`<p>${textoAnterior}</p>` : html`<p>Sin información registrada.</p>`;
  };

  /* Paginación simple */
  const paginacion = (pagina, total, porPagina) => {
    const paginas = Math.max(1, Math.ceil(total / porPagina));
    if (paginas <= 1) return '';
    return html`<nav class="paginacion" aria-label="Paginación">
      <button class="boton-contorno boton-contorno--chico" type="button" data-pagina="${pagina - 1}"${si(pagina <= 1, 'disabled')}>Anterior</button>
      <span>Página ${pagina} de ${paginas}</span>
      <button class="boton-contorno boton-contorno--chico" type="button" data-pagina="${pagina + 1}"${si(pagina >= paginas, 'disabled')}>Siguiente</button>
    </nav>`;
  };
  const conQuery = (base, params) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };

  /* Periodo de estadísticas (RF-35 / RF-36) */
  const selectorPeriodo = () => html`
    <form class="periodo" data-periodo novalidate>
      <div class="pestanas" role="group" aria-label="Periodo">
        <button class="pestana" type="button" data-p="7" aria-pressed="true">Últimos 7 días</button>
        <button class="pestana" type="button" data-p="30" aria-pressed="false">Últimos 30 días</button>
        <button class="pestana" type="button" data-p="personalizado" aria-pressed="false">Personalizado</button>
      </div>
      <div class="periodo__fechas" data-fechas hidden>
        <label class="campo"><span class="campo__etiqueta">Inicio</span><input class="campo__entrada" type="date" name="inicio" max="${hoyCDMX()}"></label>
        <label class="campo"><span class="campo__etiqueta">Fin</span><input class="campo__entrada" type="date" name="fin" max="${hoyCDMX()}" value="${hoyCDMX()}"></label>
      </div>
      <button class="boton-contorno" type="submit">Consultar</button>
      <p class="mensaje mensaje--error" data-error role="alert"></p>
    </form>`;

  function montarPeriodo(raiz, alConsultar) {
    const f = $('[data-periodo]', raiz);
    let p = '7';
    $$('[data-p]', f).forEach((b) => b.addEventListener('click', () => {
      p = b.dataset.p;
      $$('[data-p]', f).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('[data-fechas]', f).hidden = p !== 'personalizado';
    }));
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEn(f, '');
      const boton = $('button[type="submit"]', f);
      const params = p === 'personalizado' ? { inicio: f.inicio.value, fin: f.fin.value } : { periodo: p };
      if (p === 'personalizado') {
        if (!params.inicio || !params.fin) return errorEn(f, 'Ingrese la fecha de inicio y la fecha de fin en formato AAAA-MM-DD.');
        if (params.inicio < '2000-01-01') return errorEn(f, 'La fecha de inicio no puede ser anterior al año 2000.');
        if (params.inicio > params.fin) return errorEn(f, 'La fecha de inicio debe ser anterior o igual a la fecha de fin.');
        if (params.fin > hoyCDMX()) return errorEn(f, 'La fecha de fin debe ser igual o anterior a hoy.');
        const dias = Math.round((new Date(params.fin) - new Date(params.inicio)) / 864e5) + 1;
        if (dias > 365) return errorEn(f, 'El periodo máximo es de 365 días.');
      }
      ocupado(boton);
      try { await alConsultar(params); } catch (err) { errorEn(f, textoError(err)); } finally { ocupado(boton, false); }
    });
  }

  const AVISO_PRIVACIDAD = html`
    <div class="aviso-texto">
      <p><strong>Aviso de privacidad v1.0</strong> · Dopta, plataforma gratuita de apoyo a la adopción de perros en la Ciudad de México.</p>
      <h3>Datos que recabamos</h3>
      <p>Adoptantes: nombre completo y correo electrónico. Refugios: nombre del refugio e institución, correo, dirección, teléfono, alcaldía y horario de atención.</p>
      <h3>Para qué los usamos</h3>
      <p>Crear tu cuenta, enviar y gestionar solicitudes de adopción, agendar citas, enviarte notificaciones dentro de la plataforma, moderar el contenido y generar estadísticas sin datos personales.</p>
      <h3>Quién puede verlos</h3>
      <p>Tu correo como adoptante solo lo ven el refugio al que enviaste una solicitud y el equipo de administración. Los datos de contacto del refugio se muestran públicamente en sus fichas.</p>
      <h3>Seguridad</h3>
      <p>Las contraseñas se guardan cifradas con una función de hash y sal; el tráfico viaja cifrado por HTTPS.</p>
      <h3>Tus derechos</h3>
      <p>Puedes corregir tus datos desde tu cuenta o darla de baja; al hacerlo, tus datos personales se eliminan después de 30 días.</p>
    </div>`;

  /* ======================= 10. Vistas públicas ======================= */

  /* ---------- Catálogo (RNF-01) ---------- */
  async function vistaCatalogo(ctx) {
    const cat = await catalogos().catch(() => ({ tamano: [] }));
    const q = (ctx.query.get('q') || '').slice(0, 60);
    const tamano = idValido(ctx.query.get('tamano'));
    const raza = RAZA[ctx.query.get('raza')] ? ctx.query.get('raza') : '';
    const titulo = estado.usuario && estado.usuario.tipo === 'adoptante' ? `Hola, ${estado.usuario.nombre.split(' ')[0]}` : 'Catálogo de mascotas';
    return {
      html: html`
      <section class="principal">
        <h1 class="titulo-pagina">${titulo}</h1>
        <form class="buscador" role="search" data-buscador>
          <label class="sr-only" for="buscar">Buscar mascota</label>
          <input class="buscador__campo" id="buscar" name="q" type="search" placeholder="Buscar por raza o nombre" value="${q || (raza ? RAZA[raza].nombre : '')}" maxlength="60" autocomplete="off">
          ${ICONO.lupa}
        </form>
        <div class="filtros" role="group" aria-label="Filtrar por tamaño">
          <button class="pestana" type="button" data-tamano="" aria-pressed="${!tamano}">Todos</button>
          ${activos(cat.tamano).map((t) => html`<button class="pestana" type="button" data-tamano="${t.id}" aria-pressed="${t.id === tamano}">${t.nombre}</button>`)}
          <a class="pestana pestana--refugios" href="#/refugios">Ver refugios</a>
        </div>
        <section class="refugios-busqueda" data-refugios hidden>
          <h2 class="subtitulo-seccion">Refugios</h2>
          <ul class="refugios" data-lista-refugios></ul>
          <h2 class="subtitulo-seccion">Perros</h2>
        </section>
        <ul class="catalogo" data-lista aria-busy="true"></ul>
        <p class="buscador__vacio" data-vacio hidden>No encontramos mascotas con esa búsqueda. Prueba con otra raza o nombre.</p>
        <div class="mas" data-mas hidden><button class="boton-contorno" type="button">Ver más mascotas</button></div>
        <section class="test" aria-labelledby="titulo-test">
          <div><h2 class="test__texto" id="titulo-test">¿Quieres saber cuál sería tu mascota indicada?<span class="test__subtexto">¡Haz este test!</span></h2></div>
          <a class="boton-contorno" href="#/cuestionario">Haz el test</a>
        </section>
        <div class="croquetas" aria-hidden="true">${[1, 2, 3, 4, 5].map(() => html`<img class="croqueta-pieza" src="img/hueso.svg" alt="">`)}</div>
      </section>`,
      montar(raiz) {
        const lista = $('[data-lista]', raiz);
        const vacio = $('[data-vacio]', raiz);
        const mas = $('[data-mas]', raiz);
        const campo = $('#buscar', raiz);
        let filtroTamano = tamano || '';
        let pagina = 1;
        let pedido = 0;
        let hayRefugios = false;
        const cargar = async (agregar = false) => {
          const n = ++pedido;
          lista.setAttribute('aria-busy', 'true');
          const texto = campo.value.trim();
          try {
            const [r, refs] = await Promise.all([
              api(conQuery('/animales', { q: texto, tamano: filtroTamano, pagina })),
              texto.length >= 2 && !agregar ? api(conQuery('/refugios', { q: texto })).catch(() => []) : Promise.resolve(null),
            ]);
            if (n !== pedido) return;
            if (refs !== null) {
              const caja = $('[data-refugios]', raiz);
              caja.hidden = !refs.length;
              $('[data-lista-refugios]', raiz).innerHTML = String(html`${refs.slice(0, 6).map(tarjetaRefugio)}`);
              hayRefugios = refs.length > 0;
            } else if (!agregar) { $('[data-refugios]', raiz).hidden = true; hayRefugios = false; }
            const tarjetas = r.animales.map((a) => tarjetaAnimal(a));
            if (agregar) lista.insertAdjacentHTML('beforeend', String(html`${tarjetas}`));
            else lista.innerHTML = String(html`${tarjetas}`);
            $$('.tarjeta', lista).forEach((t, i) => t.style.setProperty('--i', i));
            vacio.hidden = r.total > 0;
            vacio.textContent = hayRefugios ? 'Ningún perro coincide con esa búsqueda, pero encontramos refugios.' : 'No encontramos mascotas con esa búsqueda. Prueba con otra raza o nombre.';
            mas.hidden = r.pagina * r.porPagina >= r.total;
          } catch (e) {
            if (n !== pedido) return;
            lista.innerHTML = '';
            vacio.hidden = false;
            vacio.textContent = textoError(e, 'No se pudo cargar el catálogo. Intente de nuevo.');
          } finally {
            lista.setAttribute('aria-busy', 'false');
          }
        };
        let espera;
        campo.addEventListener('input', () => { clearTimeout(espera); espera = setTimeout(() => { pagina = 1; cargar(); }, 280); });
        $('[data-buscador]', raiz).addEventListener('submit', (e) => { e.preventDefault(); pagina = 1; cargar(); });
        $$('[data-tamano]', raiz).forEach((b) => b.addEventListener('click', () => {
          filtroTamano = b.dataset.tamano;
          $$('[data-tamano]', raiz).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
          pagina = 1;
          cargar();
        }));
        $('button', mas).addEventListener('click', () => { pagina += 1; cargar(true); });
        cargar();
      },
    };
  }

  /* ---------- Ficha de detalle del animal ---------- */
  async function vistaAnimal(ctx) {
    const id = idValido(ctx.params.id);
    if (!id) return vista404();
    let a;
    const catFicha = await catalogos().catch(() => ({ animal: {} }));
    try { a = await api(`/animales/${id}`); } catch (e) {
      if (e.status === 404) {
        return html`<section class="error"><img src="img/error-404.svg" alt="" width="150" height="157"><p class="error__codigo">Ya no disponible</p><p class="error__texto">${e.message}</p><a class="boton-contorno" href="#/">Ver el catálogo</a></section>`;
      }
      throw e;
    }
    const u = estado.usuario;
    const textos = a.requisitos.filter((r) => r.tipo !== 'Documental');
    const docs = a.requisitos.filter((r) => r.tipo === 'Documental');
    const adoptado = a.estado === 'adoptado';
    let accion;
    if (adoptado) accion = html`<p class="mensaje mensaje--exito">¡${a.nombre} ya encontró un hogar!${a.adoptado_en ? ` Adoptado el ${a.adoptado_en}.` : ''} <a class="enlace" href="#/">Conoce a otros perros</a></p>`;
    else if (!u) accion = html`<a class="boton-contorno boton-contorno--relleno" href="#/login?next=${encodeURIComponent(`#/animal/${a.id}`)}">Inicia sesión para adoptar</a>`;
    else if (u.tipo !== 'adoptante') accion = '';
    else if (a.miSolicitud) accion = html`${insignia(a.miSolicitud.estado, `Tu solicitud: ${ETQ[a.miSolicitud.estado]}`)} <a class="enlace" href="#/solicitudes">Ver mis solicitudes</a>`;
    else accion = html`<button class="boton-contorno boton-contorno--relleno" type="button" data-adoptar>Quiero adoptarlo</button>`;

    return {
      html: html`
      <section class="principal">
        <div class="contenedor">
          ${botonRegresar('#/')}
          <div class="ficha">
            <div class="ficha__imagen">${imagenAnimal(a)}</div>
            <article class="panel">
              <h1 class="ficha__titulo">${a.nombre}</h1>
              <p class="ficha__raza">${nombreRaza(a)} · en <a class="enlace" href="#/refugios/${a.refugio_id}">${a.refugio}</a></p>
              <div class="ficha__chips">
                ${insignia(a.estado, ETQ[a.estado])}
                <span class="insignia">${a.edad}</span>
                <span class="insignia">${a.tamano}</span>
                ${a.peso_kg ? html`<span class="insignia">⚖️ ${Number(a.peso_kg)} kg</span>` : ''}
                ${a.altura_cm ? html`<span class="insignia">📏 ${a.altura_cm} cm</span>` : ''}
                <span class="insignia">${Number(a.esterilizado) ? `Esterilizado · ${a.fecha_esterilizacion}` : 'Sin esterilizar'}</span>
                <span class="insignia">Ingreso · ${a.fecha_ingreso}</span>
              </div>
              <div class="acciones">${accion}</div>
              <div class="ficha__bloque"><h2>Temperamento</h2>${listaRasgos(catFicha, a, CAMPOS_TEMP, a.temperamento)}</div>
              <div class="ficha__bloque"><h2>Estado de salud</h2>${listaRasgos(catFicha, a, CAMPOS_SALUD, a.salud)}</div>
              <div class="ficha__bloque"><h2>Vacunas</h2>
                ${a.vacunas.length ? html`<ul class="lista-simple">${a.vacunas.map((v) => html`<li><span>${v.nombre}</span><span>${v.fecha}</span></li>`)}</ul>` : html`<p>Sin vacunas registradas.</p>`}
              </div>
              <div class="ficha__bloque"><h2>Requisitos de adopción</h2>
                ${a.requisitos.length ? html`
                  <p class="nota">Todos se entregan en persona durante la cita en el refugio.</p>
                  ${textos.length ? html`<p><strong>Datos personales</strong></p><ul class="lista-simple">${textos.map((r) => html`<li>${r.nombre}</li>`)}</ul>` : ''}
                  ${docs.length ? html`<p><strong>Documentos</strong></p><ul class="lista-simple">${docs.map((r) => html`<li>${r.nombre}</li>`)}</ul>` : ''}`
    : html`<p>El refugio no solicita requisitos adicionales.</p>`}
              </div>
              <div class="ficha__bloque refugio-caja">
                <h3><a class="enlace" href="#/refugios/${a.refugio_id}">${a.refugio}</a></h3>
                <p>${a.institucion}</p>
                <p>${a.direccion}${a.alcaldia ? `, ${a.alcaldia}` : ''}</p>
                <p>Tel. ${a.telefono}</p>
                <p class="acciones"><a class="boton-contorno boton-contorno--chico" href="${mapaUrl(a, true)}" target="_blank" rel="noopener noreferrer">📍 Cómo llegar</a>
                  <a class="boton-contorno boton-contorno--chico" href="#/refugios/${a.refugio_id}">Ver refugio</a></p>
                <ul class="horario-lista">${a.horario.map((h) => html`<li><span>${DIAS[h.dia]}</span><span>${Number(h.cerrado) ? 'Cerrado' : `${h.abre}–${h.cierra}`}</span></li>`)}</ul>
              </div>
              ${u && u.tipo === 'adoptante' && !adoptado ? html`<p class="acciones ficha__bloque"><button class="enlace" type="button" data-reportar="animal">Reportar publicación</button> · <button class="enlace" type="button" data-reportar="refugio">Reportar refugio</button></p>` : ''}
            </article>
          </div>
        </div>
      </section>`,
      montar(raiz) {
        const b = $('[data-adoptar]', raiz);
        if (b) {
          b.addEventListener('click', async () => {
            let tel = '';
            try { tel = (await api('/cuenta')).telefono || ''; } catch { /* se pide en el formulario */ }
            const ok = await dialogo({
              titulo: `¿Enviar solicitud para ${a.nombre}?`,
              texto: `El refugio ${a.refugio} revisará tu solicitud. Si la aprueba, agendará una cita para que entregues los requisitos en persona.`,
              cuerpo: html`<label class="campo"><span class="campo__etiqueta">Tu teléfono de contacto</span>
                <input class="campo__entrada" name="telefono" type="tel" inputmode="numeric" maxlength="10" value="${tel}" placeholder="10 dígitos" required>
                <span class="campo__ayuda">${tel ? 'Confírmalo o actualízalo: el refugio lo usará para coordinar la cita.' : 'Tu cuenta aún no tiene teléfono: el refugio lo necesita para coordinar la cita.'}</span></label>
                <label class="campo"><span class="campo__etiqueta">Mensaje para el refugio <span class="opcional">(opcional)</span></span>
                <textarea class="campo__textarea" name="mensaje" maxlength="500" placeholder="Cuéntale al refugio sobre ti y tu hogar: con quién vives, si tienes otras mascotas, por qué quieres adoptar a ${a.nombre}…"></textarea></label>`,
              confirmar: 'Confirmar solicitud',
              montar: (d) => soloDigitos(d),
              accion: async (f) => {
                const d = datosForm(f);
                if (!V.telefono(d.telefono)) fallo(M.telefono);
                if (!V.telefonoReal(d.telefono)) fallo(M.telefonoReal);
                const mensaje = validarMensaje(d.mensaje);
                await api('/solicitudes', { metodo: 'POST', datos: { animal_id: a.id, mensaje, telefono: d.telefono } })
                  .catch((e) => { throw new Error(textoError(e, 'No se pudo enviar la solicitud. Intente de nuevo.')); });
              },
            });
            if (ok) { aviso('Solicitud enviada. Te avisaremos cuando el refugio responda.'); navegar(); }
          });
        }
        $$('[data-reportar]', raiz).forEach((btn) => btn.addEventListener('click', () => reportar(btn.dataset.reportar === 'animal' ? 'animal' : 'refugio', btn.dataset.reportar === 'animal' ? a.id : a.refugio_id)));
      },
    };
  }

  /* Mensaje opcional de la solicitud: mismas reglas que V.mensajeSolicitud() en server/util.js */
  function validarMensaje(texto) {
    const m = String(texto || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!m) return null;
    if (!V.entre(m, 10, 500)) fallo('El mensaje debe tener de 10 a 500 caracteres (o déjelo vacío).');
    if (!V.letras(m, 5)) fallo('El mensaje debe incluir texto, no solo números o símbolos.');
    if (/(https?:\/\/|www\.|\.(com|mx|net|org|io|ly)\b)/i.test(m)) fallo('El mensaje no puede incluir enlaces.');
    if (/(.)\1{5,}/.test(m)) fallo('El mensaje no puede repetir el mismo carácter tantas veces seguidas.');
    if (sinAcentos(m).split(/[^a-z]+/).some((p) => GROSERIAS.has(p))) fallo('El mensaje contiene palabras no permitidas.');
    return m;
  }

  const MOTIVOS = ['Animal no doméstico', 'Contenido inapropiado', 'Información falsa', 'Otro'];
  async function reportar(tipo, id) {
    const ok = await dialogo({
      titulo: tipo === 'animal' ? 'Reportar publicación' : 'Reportar refugio',
      cuerpo: html`
        <label class="campo"><span class="campo__etiqueta">Motivo</span>
          <select class="campo__entrada" name="motivo"><option value="">Selecciona un motivo</option>${MOTIVOS.map((m) => html`<option>${m}</option>`)}</select></label>
        <label class="campo"><span class="campo__etiqueta">Descripción</span>
          <textarea class="campo__textarea" name="descripcion" minlength="10" maxlength="300" placeholder="Cuéntanos qué pasa (10 a 300 caracteres)"></textarea></label>`,
      confirmar: 'Enviar reporte',
      accion: async (f) => {
        const d = datosForm(f);
        if (!MOTIVOS.includes(d.motivo)) fallo('Seleccione un motivo.');
        if (!V.entre(d.descripcion, 10, 300)) fallo('La descripción debe tener de 10 a 300 caracteres.');
        await api('/reportes', { metodo: 'POST', datos: { objetivo_tipo: tipo, objetivo_id: id, motivo: d.motivo, descripcion: d.descripcion } });
      },
    });
    if (ok) aviso('Reporte enviado. Un Administrador lo revisará.');
  }

  /* ---------- Cuestionario de compatibilidad ---------- */
  function recomendar(r) {
    let tamano;
    if (r.jardin === 'no') tamano = r.tiempo === 'mucho' && r.energia === 'activos' ? 'Mediano' : 'Pequeño';
    else tamano = r.tiempo === 'mucho' ? 'Grande' : 'Mediano';
    let energia;
    if (r.energia === 'activos') energia = r.tiempo === 'poco' ? 'media' : 'alta';
    else energia = r.tiempo === 'mucho' ? 'media' : 'baja';
    const ordenT = ['Pequeño', 'Mediano', 'Grande'];
    const ordenE = ['baja', 'media', 'alta'];
    const puntos = (raza) => {
      let p = 0;
      const dt = Math.abs(ordenT.indexOf(raza.tamano) - ordenT.indexOf(tamano));
      const de = Math.abs(ordenE.indexOf(raza.energia) - ordenE.indexOf(energia));
      p += dt === 0 ? 3 : dt === 1 ? 1 : -2;
      p += de === 0 ? 3 : de === 1 ? 1 : -2;
      if (raza.exigente && r.experiencia === 'no') p -= 3;
      return p;
    };
    const razas = [...RAZAS].sort((x, y) => puntos(y) - puntos(x) || x.nombre.localeCompare(y.nombre)).slice(0, 3);
    return { tamano, energia, razas };
  }

  function vistaCuestionario() {
    const pregunta = (nombre, titulo, ops, def) => html`
      <fieldset class="pregunta">
        <legend class="pregunta__titulo">${titulo}</legend>
        <div class="pregunta__opciones">
          ${ops.map(([v, t]) => html`<label class="opcion"><input type="radio" name="${nombre}" value="${v}"${si(v === def, 'checked')}><span class="opcion__texto">${t}</span></label>`)}
        </div>
      </fieldset>`;
    return {
      html: html`
      <section class="cuenta">
        ${botonRegresar('#/', 'Atrás')}
        <section class="cuenta__tarjeta cuestionario__tarjeta" aria-labelledby="titulo-cuestionario">
          <h1 class="cuenta__titulo" id="titulo-cuestionario">¿Cuál es tu mascota ideal?</h1>
          <p class="cuenta__subtitulo">Responde estas preguntas y descubre qué compañero de hogar es perfecto para ti.</p>
          <form class="cuestionario" data-cuestionario>
            <div class="cuestionario__preguntas">
              ${pregunta('jardin', '¿Tienes jardín o patio?', [['si', 'Sí'], ['no', 'No']], 'si')}
              ${pregunta('tiempo', '¿Cuánto tiempo puedes dedicar al cuidado?', [['poco', 'Poco'], ['medio', 'Medio'], ['mucho', 'Mucho']], 'medio')}
              ${pregunta('experiencia', '¿Tienes experiencia con mascotas?', [['si', 'Sí'], ['no', 'No']], 'si')}
              ${pregunta('energia', '¿Prefieres animales activos o tranquilos?', [['activos', 'Activos'], ['tranquilos', 'Tranquilos']], 'tranquilos')}
            </div>
            <div class="cuestionario__accion"><button class="boton-pastilla" type="submit">Descubrir mi mascota ideal</button></div>
          </form>
          <div data-resultado></div>
        </section>
      </section>`,
      montar(raiz) {
        const form = $('[data-cuestionario]', raiz);
        form.addEventListener('submit', async (e) => {
          e.preventDefault();
          const r = recomendar(datosForm(form));
          const caja = $('[data-resultado]', raiz);
          const energiaTxt = { baja: 'tranquila', media: 'moderada', alta: 'alta' }[r.energia];
          caja.innerHTML = String(html`
            <div class="resultado" role="status">
              <h2>Tu perfil ideal</h2>
              <p>Un perro de tamaño <strong data-tam>${r.tamano.toLowerCase()}</strong> con energía <strong>${energiaTxt}</strong>. Estas razas suelen encajar contigo:</p>
              <div class="resultado__razas">${r.razas.map((x) => html`<a class="resultado__raza" href="#/?raza=${x.id}">${seguro(x.svg)}<span>${x.nombre}</span></a>`)}</div>
              <p class="nota">Sugerencia orientativa: cada perro es único y muchos mestizos encajan con este perfil. Conócelo en el refugio antes de decidir.</p>
              <div data-sugeridos></div>
            </div>`);
          caja.scrollIntoView({ behavior: 'smooth', block: 'start' });
          try {
            const cat = await catalogos();
            // Se busca por posición (1.º, 2.º, 3.º tamaño del catálogo) y no por nombre, por si el admin lo renombra
            const pos = ['Pequeño', 'Mediano', 'Grande'].indexOf(r.tamano);
            const t = [...cat.tamano].sort((x, y) => x.orden - y.orden || x.id - y.id)[pos];
            if (t) $('[data-tam]', caja).textContent = t.nombre.toLowerCase();
            const res = await api(conQuery('/animales', { tamano: t && t.id }));
            const lista = res.animales.slice(0, 4);
            if (lista.length) {
              $('[data-sugeridos]', caja).innerHTML = String(html`<p><strong>Perros disponibles con ese tamaño:</strong></p><ul class="catalogo">${lista.map((a) => tarjetaAnimal(a))}</ul>`);
            }
          } catch { /* las sugerencias son opcionales */ }
        });
      },
    };
  }

  /* ---------- Refugios: listado público ---------- */
  async function vistaRefugios(ctx) {
    const q = (ctx.query.get('q') || '').slice(0, 60);
    return {
      html: html`
      <section class="principal">
        <h1 class="titulo-pagina">Refugios</h1>
        <form class="buscador" role="search" data-buscador>
          <label class="sr-only" for="buscar-refugio">Buscar refugio</label>
          <input class="buscador__campo" id="buscar-refugio" type="search" placeholder="Buscar por nombre o alcaldía" value="${q}" maxlength="60" autocomplete="off">
          ${ICONO.lupa}
        </form>
        <div class="acciones acciones--centro"><button class="boton-contorno boton-contorno--chico" type="button" data-cercanos aria-pressed="false">${ICONO.ubicacion} Más cercanos a mí</button></div>
        <p class="campo__ayuda centrado" data-cerca-estado aria-live="polite"></p>
        <ul class="refugios contenedor" data-lista aria-busy="true"></ul>
        <p class="buscador__vacio" data-vacio hidden>No encontramos refugios con esa búsqueda.</p>
      </section>`,
      montar(raiz) {
        const campo = $('#buscar-refugio', raiz);
        let n = 0;
        let reloj;
        let yo = null; // ubicación del usuario cuando pide "Más cercanos"
        const cargar = async () => {
          const k = ++n;
          try {
            let lista = await api(conQuery('/refugios', { q: campo.value.trim() }));
            if (k !== n) return;
            if (yo) {
              lista = lista.map((r) => ({ ...r, km: r.lat != null ? distanciaKm(yo, r) : null }))
                .sort((x, y) => (x.km ?? 1e9) - (y.km ?? 1e9));
            }
            $('[data-lista]', raiz).innerHTML = String(html`${lista.map(tarjetaRefugio)}`);
            $('[data-vacio]', raiz).hidden = lista.length > 0;
          } catch (e) { $('[data-vacio]', raiz).hidden = false; $('[data-vacio]', raiz).textContent = textoError(e, 'No se pudo cargar la lista. Intente de nuevo.'); }
          $('[data-lista]', raiz).setAttribute('aria-busy', 'false');
        };
        campo.addEventListener('input', () => { clearTimeout(reloj); reloj = setTimeout(cargar, 280); });
        $('[data-buscador]', raiz).addEventListener('submit', (e) => { e.preventDefault(); cargar(); });
        const bc = $('[data-cercanos]', raiz);
        const est = $('[data-cerca-estado]', raiz);
        bc.addEventListener('click', async () => {
          if (yo) { yo = null; bc.setAttribute('aria-pressed', 'false'); est.textContent = ''; cargar(); return; }
          est.textContent = 'Obteniendo tu ubicación…';
          try {
            yo = await ubicacionActual();
            bc.setAttribute('aria-pressed', 'true');
            est.textContent = 'Ordenados por distancia en línea recta desde tu ubicación (≈ = aproximada por alcaldía). Tu ubicación no se guarda.';
            cargar();
          } catch (e) { est.textContent = e.message; }
        });
        cargar();
      },
    };
  }

  /* ---------- Perfil público del refugio ---------- */
  async function vistaPerfilRefugio(ctx) {
    const id = idValido(ctx.params.id);
    if (!id) return vista404();
    let r;
    try { r = await api(`/refugios/${id}`); } catch (e) {
      if (e.status === 404) return html`<section class="error"><img src="img/error-404.svg" alt="" width="150" height="157"><p class="error__codigo">Refugio no disponible</p><p class="error__texto">${e.message}</p><a class="boton-contorno" href="#/refugios">Ver refugios</a></section>`;
      throw e;
    }
    const u = estado.usuario;
    const abierto = abiertoAhora(r.horario);
    const hoyDia = diaSemana(hoyCDMX());
    return {
      html: html`
      <section class="principal">
        <div class="contenedor">
          ${botonRegresar('#/refugios')}
          <div class="perfil-refugio">
            <article class="panel perfil-refugio__info">
              <img class="perfil-refugio__logo" src="img/logo-dopta.svg" alt="" width="72" height="65">
              <h1 class="ficha__titulo">${r.nombre}</h1>
              <p class="ficha__raza">${r.institucion}</p>
              <div class="ficha__chips">
                ${insignia(abierto ? 'disponible' : 'rechazada', abierto ? 'Abierto ahora' : 'Cerrado ahora')}
                <span class="insignia">✔ Refugio verificado</span>
              </div>
              <div class="ficha__bloque">
                <h2>Ubicación</h2>
                <p>${r.direccion}${r.alcaldia ? `, ${r.alcaldia}` : ''}</p>
                <p class="acciones"><a class="boton-contorno boton-contorno--chico" href="${mapaUrl(r, true)}" target="_blank" rel="noopener noreferrer">📍 Cómo llegar</a>
                  <a class="boton-contorno boton-contorno--chico" href="tel:${r.telefono}">📞 ${r.telefono}</a></p>
              </div>
              <div class="ficha__bloque">
                <h2>Horario de atención</h2>
                <ul class="lista-simple horario-hoy">${r.horario.map((h) => html`
                  <li class="${Number(h.dia) === hoyDia ? 'es-hoy' : ''}"><span>${DIAS[h.dia]}${Number(h.dia) === hoyDia ? ' (hoy)' : ''}</span><strong>${Number(h.cerrado) ? 'Cerrado' : `${h.abre} – ${h.cierra}`}</strong></li>`)}</ul>
              </div>
              ${u && u.tipo === 'adoptante' ? html`<p class="ficha__bloque"><button class="enlace" type="button" data-reportar-refugio>Reportar refugio</button></p>` : ''}
            </article>
            <div>
              <div class="cifras perfil-refugio__cifras">
                <article class="cifra cifra--durazno"><span class="cifra__numero">${r.animales.length}</span><span class="cifra__texto">perros en adopción</span></article>
                <article class="cifra cifra--azul"><span class="cifra__numero">${r.adoptados}</span><span class="cifra__texto">adopciones logradas</span></article>
              </div>
              <h2 class="subtitulo-seccion">Perros en adopción</h2>
              ${r.animales.length ? html`<ul class="catalogo perfil-refugio__catalogo">${r.animales.map((a) => tarjetaAnimal(a))}</ul>`
    : html`<div class="vacio">${seguro(SVG_HUELLA)}Este refugio no tiene perros publicados por ahora.</div>`}
            </div>
          </div>
        </div>
      </section>`,
      montar(raiz) {
        const b = $('[data-reportar-refugio]', raiz);
        if (b) b.addEventListener('click', () => reportar('refugio', r.id));
      },
    };
  }

  /* ---------- Sobre nosotros ---------- */
  const vistaNosotros = () => html`
    <div class="nosotros">
      <section class="nosotros__seccion nosotros__heroe">
        <div class="nosotros__contenedor">
          <p class="nosotros__eyebrow">Sobre Dopta</p>
          <h1 class="nosotros__titulo">Cada perrito merece una casa, y Dopta ayuda a encontrarla</h1>
          <p class="nosotros__texto">Somos un catálogo digital gratuito de animales en adopción. Reunimos a los refugios de perros y a las personas que quieren adoptar en un solo lugar, sin intermediarios.</p>
          <a class="boton-contorno" href="#/">Explorar mascotas</a>
        </div>
        <div class="nosotros__ilustracion" aria-hidden="true"><img src="img/logo-dopta.svg" alt="" width="180" height="162"></div>
      </section>
      <section class="nosotros__seccion">
        <div class="nosotros__contenedor">
          <div class="nosotros__cifras">
            <article class="cifra cifra--azul"><span class="cifra__numero">Gratis</span><span class="cifra__texto">para refugios y adoptantes</span></article>
            <article class="cifra cifra--durazno"><span class="cifra__numero">0%</span><span class="cifra__texto">de comisión por adopción</span></article>
            <article class="cifra cifra--blanco"><span class="cifra__numero">Verificados</span><span class="cifra__texto">refugios revisados antes de publicar</span></article>
          </div>
        </div>
      </section>
      <section class="nosotros__seccion">
        <div class="nosotros__contenedor">
          <p class="nosotros__eyebrow">Cómo funciona</p>
          <h2 class="nosotros__titulo">Tres pasos para conocer a tu compañero</h2>
          <p class="nosotros__texto">No necesitas experiencia previa ni un plan complicado. El proceso empieza con una pregunta honesta sobre tu vida diaria y termina con una cita en el refugio, donde conoces al animal cara a cara.</p>
          <ol class="nosotros__pasos">
            <li class="paso"><span class="paso__numero">1</span><h3 class="paso__titulo">Explora el catálogo</h3><p class="paso__texto">Revisa las fichas de los animales y responde el test para saber qué mascota encaja contigo.</p></li>
            <li class="paso"><span class="paso__numero">2</span><h3 class="paso__titulo">Crea tu cuenta</h3><p class="paso__texto">Regístrate como adoptante para enviar solicitudes y agendar tu cita en el refugio.</p></li>
            <li class="paso"><span class="paso__numero">3</span><h3 class="paso__titulo">Conoce en persona</h3><p class="paso__texto">Los requisitos de adopción se entregan durante la cita, para que conozcas al animal cara a cara.</p></li>
          </ol>
        </div>
      </section>
      <section class="nosotros__seccion">
        <div class="nosotros__contenedor">
          <p class="nosotros__eyebrow">Nuestra historia</p>
          <h2 class="nosotros__titulo">Por qué nace Dopta</h2>
          <div class="nosotros__parrafos">
            <p>Dopta nace de una idea sencilla: muchos perros esperan en refugios a que alguien los vea. Queremos que encontrarlos sea tan fácil como buscar cualquier otra cosa en internet, sin costos ocultos ni intermediarios.</p>
            <p>Creemos que una adopción funciona mejor cuando la información es clara desde el primer momento: cómo es el animal, qué salud tiene, qué vacunas y esterilización le corresponden y qué requisitos pide el refugio. Por eso cada ficha reúne esos datos y cada refugio pasa por una verificación antes de publicar.</p>
            <p>No vendemos animales ni cobramos comisiones. Dopta es un catálogo gratuito: el vínculo se construye entre el refugio y la persona, en la cita y no en la plataforma.</p>
          </div>
          <p class="nosotros__eyebrow">Lo que nos guía</p>
          <h2 class="nosotros__titulo">Tres principios para cada adopción</h2>
          <ol class="nosotros__pasos">
            <li class="paso"><span class="paso__numero">1</span><h3 class="paso__titulo">Transparencia</h3><p class="paso__texto">Cada animal se muestra con su edad, tamaño, salud, vacunas y esterilización, para que decidas con información completa.</p></li>
            <li class="paso"><span class="paso__numero">2</span><h3 class="paso__titulo">Gratuidad</h3><p class="paso__texto">Ni refugios ni adoptantes pagan por usar Dopta. No hay comisiones por adopción ni cobros ocultos.</p></li>
            <li class="paso"><span class="paso__numero">3</span><h3 class="paso__titulo">Privacidad</h3><p class="paso__texto">Las contraseñas se guardan cifradas y tu correo solo lo ven el refugio de tu solicitud y el equipo de moderación.</p></li>
          </ol>
        </div>
      </section>
      <section class="nosotros__seccion">
        <div class="nosotros__contenedor"><div class="nosotros__cta"><h2>¿Listo para encontrar a tu compañero?</h2><a class="boton-contorno" href="#/">Ver el catálogo</a></div></div>
      </section>
    </div>`;

  /* ---------- Errores ---------- */
  const vista404 = () => html`
    <section class="error">
      <img src="img/error-404.svg" alt="" width="150" height="157">
      <p class="error__codigo">ERROR 404</p>
      <p class="error__texto">Página no encontrada. Puede que la dirección esté mal escrita o que la página ya no exista.</p>
      <a class="boton-contorno" href="${estado.panel}">Volver al inicio</a>
    </section>`;
  const vista500 = (detalle = 'Algo salió mal en nuestro servidor. Intenta de nuevo en unos minutos.', codigo = 'ERROR 500') => html`
    <section class="error">
      <img src="img/error-500.svg" alt="" width="150" height="231">
      <p class="error__codigo">${codigo}</p>
      <p class="error__texto">${detalle}</p>
      <button class="boton-contorno" type="button" data-reintentar>Reintentar</button>
    </section>`;

  /* ======================= 11. Acceso y cuenta ======================= */
  const tarjetaCuenta = (id, titulo, subtitulo, contenido, ancho = false) => html`
    <section class="cuenta">
      ${botonRegresar('#/')}
      <section class="cuenta__tarjeta ${ancho ? 'cuestionario__tarjeta' : ''}" aria-labelledby="${id}">
        <h1 class="cuenta__titulo" id="${id}">${titulo}</h1>
        ${subtitulo ? html`<p class="cuenta__subtitulo">${subtitulo}</p>` : ''}
        ${contenido}
      </section>
    </section>`;

  const mensajeFlash = () => {
    const f = estado.flash;
    estado.flash = null;
    return f ? html`<p class="mensaje ${f.tipo === 'error' ? 'mensaje--error' : ''}" role="status">${f.texto}</p>` : '';
  };

  /* ---------- RF-05: iniciar sesión ---------- */
  function vistaLogin(ctx) {
    return {
      html: tarjetaCuenta('titulo-login', 'Iniciar Sesión', 'Ingresa a tu cuenta para adoptar o publicar mascotas', html`
        <form class="formulario" novalidate data-login>
          ${mensajeFlash()}
          <div class="campo"><label class="campo__etiqueta" for="correo">Email</label>
            <input class="campo__entrada" id="correo" name="correo" type="email" placeholder="tu@email.com" autocomplete="email" maxlength="254" required></div>
          <div class="campo"><label class="campo__etiqueta" for="contrasena">Contraseña</label>
            <input class="campo__entrada" id="contrasena" name="contrasena" type="password" placeholder="••••••••" autocomplete="current-password" maxlength="64" required></div>
          <p class="mensaje mensaje--error" data-error role="alert"></p>
          <button class="boton-contorno" type="submit">Ingresar</button>
        </form>
        <p class="cuenta__pie"><a href="#/recuperar">Olvidé mi contraseña</a></p>
        <p class="cuenta__pie">¿No tienes cuenta? <a href="#/registro">Registrarse</a></p>`),
      montar(raiz) {
        const f = $('[data-login]', raiz);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const d = datosForm(f);
          d.contrasena = f.contrasena.value;
          if (!V.correo(d.correo) || d.contrasena.length < 8 || d.contrasena.length > 64) return errorEn(f, 'Complete los campos con un formato válido.');
          const b = $('button[type="submit"]', f);
          ocupado(b);
          try {
            const r = await api('/auth/login', { metodo: 'POST', datos: d });
            estado.usuario = r.usuario;
            estado.panel = r.panel;
            estado.perfil = null;
            f.reset();
            await actualizarYo();
            const destino = rutaSegura(ctx.query.get('next'));
            const permitido = destino && rutaPermitida(destino, r.usuario);
            location.hash = permitido ? destino : r.panel;
          } catch (err) {
            ocupado(b, false);
            f.contrasena.value = '';
            if (err.datos && err.datos.codigo === 'RECHAZADA') {
              estado.rechazado = d.correo;
              location.hash = '#/verificacion-rechazada';
              return;
            }
            errorEn(f, textoError(err, 'No se pudo iniciar sesión. Intente de nuevo en unos minutos.'));
          }
        });
      },
    };
  }

  /* Campos institucionales del Refugio (RF-04) compartidos por registro, revalidación y perfil */
  const camposRefugio = (cat, d = {}, conInstitucion = true) => html`
    ${conInstitucion ? html`<div class="campo"><label class="campo__etiqueta" for="institucion">Nombre de la institución</label>
      <input class="campo__entrada" id="institucion" name="institucion" type="text" maxlength="120" value="${d.institucion || ''}" placeholder="Ej. Asociación Patitas A.C." required></div>` : ''}
    <fieldset class="ubicacion campo--ancho" data-direccion>
      <legend class="campo__etiqueta">Ubicación del refugio</legend>
      <div class="campo direccion" data-buscador hidden><label class="campo__etiqueta" for="buscar-dir">Buscar dirección <span class="opcional">(llena los campos por ti)</span></label>
        <div class="direccion__control">
          <input class="campo__entrada" id="buscar-dir" type="search" maxlength="200" placeholder="Ej. Av. Universidad 1200" autocomplete="off"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="direccion-lista">
          <ul class="direccion__lista" id="direccion-lista" role="listbox" aria-label="Sugerencias de dirección" hidden></ul>
        </div>
        <button class="boton-contorno boton-contorno--chico ubicacion__actual" type="button" data-mi-ubicacion>${ICONO.ubicacion} Usar mi ubicación actual</button></div>
      <div class="ubicacion__rejilla">
        <div class="campo ubicacion__calle"><label class="campo__etiqueta" for="calle">Calle</label>
          <input class="campo__entrada" id="calle" name="calle" type="text" maxlength="100" value="${d.calle || ''}" placeholder="Ej. Av. Universidad" autocomplete="address-line1" required></div>
        <div class="campo"><label class="campo__etiqueta" for="num_ext">Núm. exterior</label>
          <input class="campo__entrada" id="num_ext" name="num_ext" type="text" maxlength="10" value="${d.num_ext || ''}" placeholder="1200 o S/N" required></div>
        <div class="campo"><label class="campo__etiqueta" for="num_int">Núm. interior <span class="opcional">(opcional)</span></label>
          <input class="campo__entrada" id="num_int" name="num_int" type="text" maxlength="10" value="${d.num_int || ''}" placeholder="Ej. 3 o B"></div>
        <div class="campo ubicacion__colonia"><label class="campo__etiqueta" for="colonia">Colonia</label>
          <input class="campo__entrada" id="colonia" name="colonia" type="text" maxlength="80" value="${d.colonia || ''}" placeholder="Ej. Xoco" required></div>
        <div class="campo"><label class="campo__etiqueta" for="cp">Código postal</label>
          <input class="campo__entrada" id="cp" name="cp" type="text" inputmode="numeric" maxlength="5" pattern="\\d{5}" value="${d.cp || ''}" placeholder="03330" autocomplete="postal-code" required></div>
        <div class="campo"><label class="campo__etiqueta" for="alcaldia">Alcaldía</label>
          <select class="campo__entrada" id="alcaldia" name="alcaldia_id" required>${opciones(cat.alcaldia, d.alcaldia_id, 'Selecciona tu alcaldía')}</select></div>
      </div>
      <input type="hidden" name="lat" value="${d.lat ?? ''}"><input type="hidden" name="lng" value="${d.lng ?? ''}"><input type="hidden" name="place_id" value="${d.place_id || ''}">
      <span class="campo__ayuda" data-dir-estado>${d.lat ? html`📍 Ubicación verificada · <a href="${mapaUrl(d)}" target="_blank" rel="noopener noreferrer">Ver en el mapa</a>`
        : d.direccion && !d.calle ? `Dirección registrada: ${d.direccion}. Complétala por partes.` : 'Al escribir el código postal, la alcaldía se elige sola.'}</span>
    </fieldset>
    <div class="campo"><label class="campo__etiqueta" for="telefono">Teléfono</label>
      <input class="campo__entrada" id="telefono" name="telefono" type="tel" inputmode="numeric" maxlength="10" pattern="\\d{10}" value="${d.telefono || ''}" placeholder="10 dígitos" required></div>
    <div class="campo campo--ancho"><span class="campo__etiqueta">Horario de atención</span>${editorHorario(d.horario)}</div>`;

  /* Ubicación atomizada: mismas reglas que V.ubicacion() en server/util.js */
  const RE_CALLE = /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9 .,#°\-]+$/;
  function validarUbicacion(d, cat) {
    const t = (v) => String(v || '').trim().replace(/\s+/g, ' ');
    const u = {
      calle: t(d.calle), num_ext: t(d.num_ext).toUpperCase().replace(/^S\/?N$/, 'S/N'), num_int: t(d.num_int).toUpperCase(),
      colonia: t(d.colonia).replace(/^col(onia)?\.?\s+/i, ''), cp: t(d.cp), alcaldia_id: Number(d.alcaldia_id) || null,
    };
    if (!V.entre(u.calle, 3, 100) || !RE_CALLE.test(u.calle) || !V.letras(u.calle, 3)) fallo(M.calle);
    if (!/^(S\/N|\d{1,5}[A-Z]?(-[A-Z0-9]{1,3})?)$/.test(u.num_ext) || /^0+\D*$/.test(u.num_ext)) fallo(M.numExt);
    if (u.num_int && !/^[A-Z0-9][A-Z0-9 .\-]{0,9}$/.test(u.num_int)) fallo(M.numInt);
    if (!V.entre(u.colonia, 3, 80) || !RE_CALLE.test(u.colonia) || !V.letras(u.colonia, 3)) fallo(M.colonia);
    if (!/^\d{5}$/.test(u.cp)) fallo(M.cp);
    const esperada = cat.alcaldia.find((a) => a.cp === u.cp.slice(0, 2));
    if (Number(u.cp.slice(0, 2)) < 1 || Number(u.cp.slice(0, 2)) > 16) fallo(M.cpCdmx);
    if (!u.alcaldia_id) fallo(M.alcaldia);
    if (esperada && esperada.id !== u.alcaldia_id) {
      const elegida = cat.alcaldia.find((a) => a.id === u.alcaldia_id);
      fallo(`El código postal ${u.cp} corresponde a ${esperada.nombre}, no a ${elegida ? elegida.nombre : 'la alcaldía elegida'}. Revise el C.P. o la alcaldía.`);
    }
    return u;
  }

  function validarCamposRefugio(f, cat, conInstitucion = true) {
    const d = datosForm(f);
    if (conInstitucion && !V.entre(d.institucion, 3, 120)) fallo(M.institucion);
    if (conInstitucion && !V.letras(d.institucion)) fallo(M.letras);
    if (conInstitucion) revisarNombre(d.institucion, 'refugio');
    const u = validarUbicacion(d, cat);
    if (!V.telefono(d.telefono)) fallo(M.telefono);
    if (!V.telefonoReal(d.telefono)) fallo(M.telefonoReal);
    return {
      institucion: d.institucion, ...u, telefono: d.telefono, horario: leerHorario(f),
      lat: d.lat ? Number(d.lat) : null, lng: d.lng ? Number(d.lng) : null, place_id: d.place_id || null,
    };
  }

  /* Enlace a Google Maps (no consume API): por coordenadas o, si no hay, por texto de la dirección */
  function mapaUrl(r, ruta = false) {
    const p = new URLSearchParams({ api: '1' });
    const destino = r.lat && r.lng ? `${r.lat},${r.lng}` : [r.direccion, r.alcaldia, 'Ciudad de México'].filter(Boolean).join(', ');
    p.set(ruta ? 'destination' : 'query', destino);
    if (r.place_id) p.set(ruta ? 'destination_place_id' : 'query_place_id', r.place_id);
    return `https://www.google.com/maps/${ruta ? 'dir' : 'search'}/?${p}`;
  }

  /* Autocompletado de la dirección con Google Places (vía nuestro servidor). Si no está configurado, el campo es manual. */
  const nuevaSesion = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
  async function montarDireccion(raiz) {
    const caja = $('[data-direccion]', raiz);
    if (!caja) return;
    const ayuda = $('[data-dir-estado]', caja);
    const oculto = (n) => $(`input[name="${n}"]`, caja);
    const alcaldia = $('select[name="alcaldia_id"]', caja);
    const campoDe = (n) => $(`[name="${n}"]`, caja);
    const cat = await catalogos();

    // C.P.: solo dígitos y, al completar 5, la alcaldía se elige sola (los 2 primeros dígitos la indican)
    const cp = campoDe('cp');
    const alcaldiaPorCp = () => {
      if (!/^\d{5}$/.test(cp.value)) return;
      const a = cat.alcaldia.find((x) => x.activo && x.cp === cp.value.slice(0, 2));
      if (a) { alcaldia.value = String(a.id); ayuda.textContent = `C.P. ${cp.value}: alcaldía ${a.nombre}.`; }
      else ayuda.textContent = M.cpCdmx;
    };
    cp.addEventListener('input', () => { cp.value = cp.value.replace(/\D/g, '').slice(0, 5); alcaldiaPorCp(); });
    // Números en mayúsculas (15-B, S/N) y sin símbolos raros
    ['num_ext', 'num_int'].forEach((n) => campoDe(n).addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9 ./\-]/g, '');
    }));
    // Si se edita a mano cualquier parte, las coordenadas anteriores ya no corresponden
    ['calle', 'num_ext', 'num_int', 'colonia', 'cp', 'alcaldia_id'].forEach((n) => campoDe(n).addEventListener('input', () => {
      if (!oculto('lat').value) return;
      oculto('lat').value = ''; oculto('lng').value = ''; oculto('place_id').value = '';
    }));

    if (estado.lugares === undefined) {
      try { estado.lugares = (await api('/lugares/estado', { auto: true })).activo; } catch { estado.lugares = false; }
    }
    if (!estado.lugares) return;
    $('[data-buscador]', caja).hidden = false;
    const campo = $('#buscar-dir', caja);
    const lista = $('.direccion__lista', caja);
    let sesion = nuevaSesion();
    let opciones = [];
    let activa = -1;
    let reloj;
    let pedido = 0;
    const cerrar = () => { lista.hidden = true; campo.setAttribute('aria-expanded', 'false'); campo.removeAttribute('aria-activedescendant'); activa = -1; };
    const marcar = (i) => {
      activa = i;
      $$('[role="option"]', lista).forEach((li, k) => li.setAttribute('aria-selected', String(k === i)));
      if (i >= 0) campo.setAttribute('aria-activedescendant', `dir-op-${i}`);
    };
    const pintar = () => {
      if (!opciones.length) return cerrar();
      lista.innerHTML = String(html`${opciones.map((o, i) => html`
        <li role="option" id="dir-op-${i}" data-i="${i}" aria-selected="false"><strong>${o.principal}</strong><span>${o.secundario}</span></li>`)}
        <li class="direccion__google" aria-hidden="true">con tecnología de Google</li>`);
      lista.hidden = false;
      campo.setAttribute('aria-expanded', 'true');
    };
    const elegir = async (o) => {
      cerrar();
      ayuda.textContent = 'Verificando dirección…';
      try {
        rellenar(await api('/lugares/detalle', { metodo: 'POST', datos: { id: o.id, sesion } }));
      } catch (e) {
        ayuda.textContent = textoError(e, 'No se pudo consultar la dirección. Escríbala manualmente.');
      }
      sesion = nuevaSesion(); // cada búsqueda con su detalle es una sesión de cobro de Google
    };
    // "Usar mi ubicación actual": coordenadas del navegador → dirección (Google Geocoding) → campos
    $('[data-mi-ubicacion]', caja).addEventListener('click', async (e) => {
      const b = e.currentTarget;
      ocupado(b);
      ayuda.textContent = 'Obteniendo tu ubicación…';
      try {
        const pos = await ubicacionActual();
        ayuda.textContent = 'Buscando la dirección…';
        rellenar(await api('/lugares/inversa', { metodo: 'POST', datos: pos }));
      } catch (err) {
        ayuda.textContent = err instanceof ErrorApi ? textoError(err) : err.message;
      } finally { ocupado(b, false); }
    });
    function rellenar(d) {
      {
        campo.value = '';
        // Cada parte va a su campo; lo que Google no trae queda vacío para completarlo a mano
        campoDe('calle').value = d.calle || '';
        campoDe('num_ext').value = d.num_ext || '';
        campoDe('colonia').value = d.colonia || '';
        campoDe('cp').value = d.cp || '';
        if (d.alcaldia_id) alcaldia.value = String(d.alcaldia_id);
        oculto('lat').value = d.lat; oculto('lng').value = d.lng; oculto('place_id').value = d.place_id;
        const faltan = [['calle', 'calle'], ['num_ext', 'número exterior'], ['colonia', 'colonia'], ['cp', 'código postal']]
          .filter(([n]) => !campoDe(n).value).map(([, t]) => t);
        if (!d.alcaldia_id) faltan.push('alcaldía');
        ayuda.innerHTML = String(html`📍 Ubicación verificada${faltan.length ? ` · completa: ${faltan.join(', ')}` : ''} · <a href="${mapaUrl(d)}" target="_blank" rel="noopener noreferrer">Ver en el mapa</a>`);
        const primero = faltan.length && campoDe({ calle: 'calle', 'número exterior': 'num_ext', colonia: 'colonia', 'código postal': 'cp', alcaldía: 'alcaldia_id' }[faltan[0]]);
        (primero || campoDe('num_int')).focus();
      }
    }

    campo.addEventListener('input', () => {
      clearTimeout(reloj);
      const texto = campo.value.trim();
      if (texto.length < 3) { opciones = []; return cerrar(); }
      reloj = setTimeout(async () => {
        const n = ++pedido;
        try {
          const r = await api('/lugares/sugerencias', { metodo: 'POST', datos: { texto, sesion } });
          if (n !== pedido) return;
          opciones = r.sugerencias || [];
          pintar();
        } catch { if (n === pedido) { opciones = []; cerrar(); } }
      }, 300);
    });
    campo.addEventListener('keydown', (e) => {
      if (lista.hidden) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); marcar((activa + 1) % opciones.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); marcar((activa - 1 + opciones.length) % opciones.length); }
      else if (e.key === 'Enter' && activa >= 0) { e.preventDefault(); elegir(opciones[activa]); }
      else if (e.key === 'Escape') cerrar();
    });
    lista.addEventListener('mousedown', (e) => {
      const li = e.target.closest('[role="option"]');
      if (!li) return;
      e.preventDefault(); // conserva el foco en el campo
      elegir(opciones[Number(li.dataset.i)]);
    });
    campo.addEventListener('blur', () => setTimeout(cerrar, 150));
  }

  /* Solo dígitos en los campos de teléfono */
  const soloDigitos = (raiz) => $$('input[type="tel"]', raiz).forEach((t) => t.addEventListener('input', () => { t.value = t.value.replace(/\D/g, '').slice(0, 10); }));

  /* ---------- RF-01 a RF-04: registro ---------- */
  async function vistaRegistro() {
    const cat = await catalogos();
    return {
      html: tarjetaCuenta('titulo-registro', 'Registro', '', html`
        <form class="formulario" novalidate data-registro>
          <fieldset class="campo campo--tipo">
            <legend class="campo__etiqueta">¿Cómo usarás Dopta?</legend>
            <div class="pregunta__opciones">
              <label class="opcion"><input type="radio" name="tipo" value="adoptante" checked><span class="opcion__texto">Quiero adoptar</span></label>
              <label class="opcion"><input type="radio" name="tipo" value="refugio"><span class="opcion__texto">Soy un refugio</span></label>
            </div>
          </fieldset>
          <div class="campo"><label class="campo__etiqueta" for="nombre" data-etq-nombre>Nombre completo</label>
            <input class="campo__entrada" id="nombre" name="nombre" type="text" placeholder="Tu nombre completo" autocomplete="name" maxlength="120" required></div>
          <div class="campo"><label class="campo__etiqueta" for="correo">Email</label>
            <input class="campo__entrada" id="correo" name="correo" type="email" placeholder="tu@email.com" autocomplete="email" maxlength="254" required></div>
          <div class="campo" data-solo-adoptante><label class="campo__etiqueta" for="telefono_adoptante">Teléfono celular</label>
            <input class="campo__entrada" id="telefono_adoptante" name="telefono_adoptante" type="tel" inputmode="numeric" maxlength="10" placeholder="10 dígitos" autocomplete="tel-national" required>
            <span class="campo__ayuda">Solo lo verá el refugio al que envíes una solicitud, para coordinar tu cita.</span></div>
          <div class="campo"><label class="campo__etiqueta" for="contrasena">Contraseña</label>
            <input class="campo__entrada" id="contrasena" name="contrasena" type="password" placeholder="••••••••" autocomplete="new-password" maxlength="64" required>
            <span class="campo__ayuda">De 8 a 64 caracteres, con al menos una letra y un número.</span></div>
          <div class="campo"><label class="campo__etiqueta" for="confirmar">Confirmar contraseña</label>
            <input class="campo__entrada" id="confirmar" name="confirmar" type="password" placeholder="••••••••" autocomplete="new-password" maxlength="64" required></div>
          <div class="formulario" data-solo-refugio hidden>
            <p class="seccion-form">Datos institucionales</p>
            ${camposRefugio(cat)}
          </div>
          <label class="campo campo--casilla"><input type="checkbox" name="aviso" value="si"><span>Acepto el <button class="enlace" type="button" data-ver-aviso>aviso de privacidad v1.0</button></span></label>
          <p class="mensaje mensaje--error" data-error role="alert"></p>
          <button class="boton-contorno" type="submit">Crear cuenta</button>
        </form>
        <p class="cuenta__pie">¿Ya tienes cuenta? <a href="#/login">Iniciar Sesión</a></p>`, true),
      montar(raiz) {
        const f = $('[data-registro]', raiz);
        const bloque = $('[data-solo-refugio]', f);
        const etq = $('[data-etq-nombre]', f);
        montarHorario(f);
        soloDigitos(f);
        montarDireccion(f);
        f.addEventListener('change', (e) => {
          if (e.target.name !== 'tipo') return;
          const ref = e.target.value === 'refugio';
          bloque.hidden = !ref;
          $('[data-solo-adoptante]', f).hidden = ref;
          etq.textContent = ref ? 'Nombre del refugio' : 'Nombre completo';
          f.nombre.placeholder = ref ? 'Ej. Refugio Patitas' : 'Tu nombre completo';
        });
        $('[data-ver-aviso]', f).addEventListener('click', () => dialogo({ titulo: 'Aviso de privacidad', cuerpo: AVISO_PRIVACIDAD, confirmar: 'Entendido', cancelar: '' }));
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEn(f, '');
          const d = datosForm(f);
          const pass = f.contrasena.value;
          const tipo = d.tipo === 'refugio' ? 'refugio' : 'adoptante';
          let datos;
          try {
            if (!d.nombre || !d.correo || !pass) fallo(M.vacios);
            if (tipo === 'adoptante' && !V.nombre(d.nombre.replace(/\s+/g, ' '))) fallo(M.nombre);
            if (tipo === 'refugio' && !V.entre(d.nombre, 3, 120)) fallo(M.refugio);
            if (tipo === 'refugio' && !V.letras(d.nombre)) fallo(M.letras);
            revisarNombre(d.nombre, tipo === 'refugio' ? 'refugio' : 'persona');
            if (!V.correo(d.correo)) fallo(M.correo);
            if (!V.contrasena(pass)) fallo(M.contrasena);
            if (pass !== f.confirmar.value) fallo(M.coinciden);
            datos = { tipo, nombre: d.nombre, correo: d.correo, contrasena: pass, confirmar: f.confirmar.value, aviso: f.aviso.checked };
            if (tipo === 'adoptante') {
              if (!V.telefono(d.telefono_adoptante)) fallo(M.telefono);
              if (!V.telefonoReal(d.telefono_adoptante)) fallo(M.telefonoReal);
              datos.telefono = d.telefono_adoptante;
            }
            if (tipo === 'refugio') Object.assign(datos, validarCamposRefugio(f, cat));
            if (!f.aviso.checked) fallo(M.aviso);
          } catch (err) { return errorEn(f, err.message); }
          const b = $('button[type="submit"]', f);
          ocupado(b);
          try {
            const r = await api('/auth/registro', { metodo: 'POST', datos });
            estado.flash = { tipo: 'exito', texto: r.mensaje === 'Cuenta creada' ? 'Cuenta creada. Ya puedes iniciar sesión.' : r.mensaje };
            location.hash = '#/login';
          } catch (err) {
            ocupado(b, false);
            errorEn(f, textoError(err, 'No se pudo completar el registro. Intente de nuevo en unos minutos.'));
          }
        });
      },
    };
  }

  /* ---------- RF-25: verificación rechazada, el refugio reenvía todos sus datos ---------- */
  async function vistaRechazada() {
    const cat = await catalogos();
    return {
      html: tarjetaCuenta('titulo-rechazada', 'Verificación rechazada', 'Su cuenta no fue verificada. Vuelva a enviar su solicitud de validación.', html`
        <form class="formulario" novalidate data-revalidar>
          <div class="campo"><label class="campo__etiqueta" for="correo">Email de la cuenta</label>
            <input class="campo__entrada" id="correo" name="correo" type="email" value="${estado.rechazado || ''}" maxlength="254" required></div>
          <div class="campo"><label class="campo__etiqueta" for="contrasena">Contraseña</label>
            <input class="campo__entrada" id="contrasena" name="contrasena" type="password" autocomplete="current-password" maxlength="64" required></div>
          <div class="campo"><label class="campo__etiqueta" for="nombre">Nombre del refugio</label>
            <input class="campo__entrada" id="nombre" name="nombre" type="text" maxlength="120" required></div>
          ${camposRefugio(cat)}
          <p class="mensaje mensaje--error" data-error role="alert"></p>
          <button class="boton-contorno" type="submit">Enviar solicitud de validación</button>
        </form>`, true),
      montar(raiz) {
        const f = $('[data-revalidar]', raiz);
        montarHorario(f);
        soloDigitos(f);
        montarDireccion(f);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          let datos;
          try {
            const d = datosForm(f);
            if (!V.correo(d.correo)) fallo(M.correo);
            if (!V.entre(d.nombre, 3, 120)) fallo(M.refugio);
            if (!V.letras(d.nombre)) fallo(M.letras);
            revisarNombre(d.nombre, 'refugio');
            datos = { correo: d.correo, contrasena: f.contrasena.value, nombre: d.nombre, ...validarCamposRefugio(f, cat) };
          } catch (err) { return errorEn(f, err.message); }
          const b = $('button[type="submit"]', f);
          ocupado(b);
          try {
            const r = await api('/auth/revalidar', { metodo: 'POST', datos });
            estado.rechazado = null;
            estado.flash = { tipo: 'exito', texto: r.mensaje };
            location.hash = '#/login';
          } catch (err) { ocupado(b, false); errorEn(f, textoError(err)); }
        });
      },
    };
  }

  /* ---------- RF-08: recuperar contraseña ---------- */
  function vistaRecuperar() {
    return {
      html: tarjetaCuenta('titulo-recuperar', 'Recuperar contraseña', 'Te enviaremos un enlace de un solo uso, válido por 30 minutos.', html`
        <form class="formulario" novalidate data-recuperar>
          <div class="campo"><label class="campo__etiqueta" for="correo">Email de tu cuenta</label>
            <input class="campo__entrada" id="correo" name="correo" type="email" placeholder="tu@email.com" autocomplete="email" maxlength="254" required></div>
          <p class="mensaje mensaje--error" data-error role="alert"></p>
          <p class="mensaje mensaje--exito" data-ok role="status"></p>
          <button class="boton-contorno" type="submit">Enviar enlace</button>
        </form>
        <p class="cuenta__pie"><a href="#/login">Volver a iniciar sesión</a></p>`),
      montar(raiz) {
        const f = $('[data-recuperar]', raiz);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEn(f, '');
          $('[data-ok]', f).textContent = '';
          const correo = f.correo.value.trim();
          if (!V.correo(correo)) return errorEn(f, M.correo);
          const b = $('button[type="submit"]', f);
          ocupado(b);
          try {
            const r = await api('/auth/recuperar', { metodo: 'POST', datos: { correo } });
            $('[data-ok]', f).textContent = r.mensaje;
          } catch (err) { errorEn(f, textoError(err)); } finally { ocupado(b, false); }
        });
      },
    };
  }

  async function vistaRestablecer(ctx) {
    const token = ctx.query.get('token') || '';
    let problema = '';
    try { await api('/auth/recuperar/verificar', { metodo: 'POST', datos: { token } }); } catch (e) { problema = textoError(e); }
    if (problema) {
      return tarjetaCuenta('titulo-rest', 'Restablecer contraseña', '', html`
        <p class="mensaje mensaje--error" role="alert">${problema}</p>
        <p class="cuenta__pie"><a href="#/recuperar">Solicitar un enlace nuevo</a></p>`);
    }
    return {
      html: tarjetaCuenta('titulo-rest', 'Nueva contraseña', 'Elige una contraseña que no uses en otros sitios.', html`
        <form class="formulario" novalidate data-rest>
          <div class="campo"><label class="campo__etiqueta" for="nueva">Nueva contraseña</label>
            <input class="campo__entrada" id="nueva" name="nueva" type="password" autocomplete="new-password" maxlength="64" required>
            <span class="campo__ayuda">De 8 a 64 caracteres, con al menos una letra y un número.</span></div>
          <div class="campo"><label class="campo__etiqueta" for="confirmar">Confirmar contraseña</label>
            <input class="campo__entrada" id="confirmar" name="confirmar" type="password" autocomplete="new-password" maxlength="64" required></div>
          <p class="mensaje mensaje--error" data-error role="alert"></p>
          <button class="boton-contorno" type="submit">Guardar contraseña</button>
        </form>`),
      montar(raiz) {
        const f = $('[data-rest]', raiz);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!V.contrasena(f.nueva.value)) return errorEn(f, M.contrasena);
          if (f.nueva.value !== f.confirmar.value) return errorEn(f, M.coinciden);
          const b = $('button[type="submit"]', f);
          ocupado(b);
          try {
            const r = await api('/auth/restablecer', { metodo: 'POST', datos: { token, contrasena: f.nueva.value } });
            history.replaceState(null, '', '#/login'); // quita el token de la barra de direcciones
            estado.flash = { tipo: 'exito', texto: r.mensaje };
            navegar();
          } catch (err) { ocupado(b, false); errorEn(f, textoError(err)); }
        });
      },
    };
  }

  /* ---------- RF-07, RF-09, RF-10: mi cuenta ---------- */
  /* Silueta del usuario con sus iniciales y color propio (cambia según el tipo de cuenta) */
  function siluetaUsuario(nombre, tipo, grande = false) {
    const ini = String(nombre || '?').trim().split(/\s+/).filter((p) => /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(p)).slice(0, 2).map((p) => p[0].toUpperCase()).join('') || '?';
    let tono = 0;
    for (const ch of String(nombre)) tono = (tono * 31 + ch.codePointAt(0)) % 997;
    const forma = tipo === 'refugio'
      ? '<path d="M14 54h36M18 54V30l14-10 14 10v24" stroke-width="3.2" fill="none"/><path d="M27 54v-9a5 5 0 0 1 10 0v9" stroke-width="3.2" fill="none"/>'
      : tipo === 'admin'
        ? '<path d="M32 12l17 6v11c0 11-7.5 19-17 23-9.5-4-17-12-17-23V18z" stroke-width="3.2" fill="none"/>'
        : '<circle cx="32" cy="25" r="10" stroke-width="3.2" fill="none"/><path d="M14 54c2-10 9.5-15 18-15s16 5 18 15" stroke-width="3.2" fill="none"/>';
    return html`<span class="silueta silueta--t${tono % 8}${grande ? ' silueta--grande' : ''}" aria-hidden="true">
      ${seguro(`<svg viewBox="0 0 64 64" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">${forma}</svg>`)}
      <span class="silueta__iniciales">${ini}</span></span>`;
  }
  const tarjetaPerfil = (c) => html`
    <section class="panel perfil-tarjeta">
      ${siluetaUsuario(c.nombre, c.tipo, true)}
      <div class="perfil-tarjeta__datos">
        <p class="perfil-tarjeta__nombre">${c.nombre}</p>
        <p class="perfil-tarjeta__rol">${{ adoptante: 'Adoptante', refugio: 'Refugio', admin: 'Administrador' }[c.tipo]}${c.refugio ? ` · ${c.refugio.institucion}` : ''}</p>
        <p class="perfil-tarjeta__meta">${c.correo}${c.telefono ? ` · Tel. ${c.telefono}` : ''} · Miembro desde ${new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${String(c.creado).slice(0, 10)}T12:00:00Z`))}</p>
      </div>
    </section>`;

  async function vistaCuenta() {
    const c = await api('/cuenta');
    const u = estado.usuario;
    const tema = raizDoc.getAttribute('data-theme') === 'oscuro' ? 'oscuro' : 'claro';
    return {
      html: html`
      <section class="principal principal--cuenta">
        <div class="contenedor contenedor--estrecho formulario">
          <h1 class="titulo-pagina">Mi cuenta</h1>
          ${tarjetaPerfil(c)}
          ${u.tipo !== 'admin' ? html`
          <section class="panel">
            <h2 class="panel__titulo">Datos de la cuenta</h2>
            <form class="formulario" novalidate data-nombre>
              <div class="campo"><label class="campo__etiqueta" for="nombre">${u.tipo === 'refugio' ? 'Nombre del refugio' : 'Nombre completo'}</label>
                <input class="campo__entrada" id="nombre" name="nombre" type="text" maxlength="120" value="${c.nombre}" required></div>
              ${u.tipo === 'refugio' ? html`<div class="campo"><label class="campo__etiqueta" for="institucion">Nombre de la institución</label>
                <input class="campo__entrada" id="institucion" name="institucion" type="text" maxlength="120" value="${c.refugio ? c.refugio.institucion : ''}" required></div>` : ''}
              <div class="campo"><span class="campo__etiqueta">Correo</span><p class="dato__valor">${c.correo}</p></div>
              <p class="mensaje mensaje--error" data-error role="alert"></p>
              <button class="boton-contorno" type="submit">Guardar cambios</button>
            </form>
            ${u.tipo === 'adoptante' ? html`
            <form class="formulario formulario--linea" novalidate data-telefono>
              <div class="campo"><label class="campo__etiqueta" for="tel">Teléfono celular</label>
                <input class="campo__entrada" id="tel" name="telefono" type="tel" inputmode="numeric" maxlength="10" value="${c.telefono || ''}" placeholder="10 dígitos" required>
                <span class="campo__ayuda">${c.telefono ? 'Solo lo ven los refugios a los que envías una solicitud.' : 'Agrégalo: los refugios lo necesitan para coordinar tu cita.'}</span></div>
              <p class="mensaje mensaje--error" data-error role="alert"></p>
              <button class="boton-contorno" type="submit">Guardar teléfono</button>
            </form>` : ''}
            ${u.tipo === 'refugio' ? html`<p class="cuenta__pie"><a href="#/refugio/perfil">Editar teléfono, dirección y horario</a></p>` : ''}
          </section>` : ''}
          <section class="panel">
            <h2 class="panel__titulo">Cambiar contraseña</h2>
            <form class="formulario" novalidate data-pass>
              <div class="campo"><label class="campo__etiqueta" for="actual">Contraseña actual</label>
                <input class="campo__entrada" id="actual" name="actual" type="password" autocomplete="current-password" maxlength="64" required></div>
              <div class="campo"><label class="campo__etiqueta" for="nueva">Nueva contraseña</label>
                <input class="campo__entrada" id="nueva" name="nueva" type="password" autocomplete="new-password" maxlength="64" required>
                <span class="campo__ayuda">De 8 a 64 caracteres, con al menos una letra y un número.</span></div>
              <p class="mensaje mensaje--error" data-error role="alert"></p>
              <button class="boton-contorno" type="submit">Guardar cambios</button>
            </form>
          </section>
          <section class="panel">
            <h2 class="panel__titulo">Ajustes</h2>
            <div class="ajustes__fila">
              <label class="ajustes__etiqueta" for="tema">Tema</label>
              <select class="ajustes__select" id="tema" data-tema><option value="claro"${si(tema === 'claro', 'selected')}>Claro</option><option value="oscuro"${si(tema === 'oscuro', 'selected')}>Oscuro</option></select>
            </div>
            <div class="ajustes__fila"><span class="ajustes__etiqueta">Aviso de privacidad aceptado</span><span>${c.aviso_version} · cuenta creada el ${String(c.creado).slice(0, 10)}</span></div>
          </section>
          ${u.tipo !== 'admin' ? html`
          <section class="panel">
            <h2 class="panel__titulo">Dar de baja la cuenta</h2>
            <p>Tu cuenta dejará de funcionar de inmediato y tus datos personales se eliminarán después de 30 días.</p>
            <div class="panel__acciones"><button class="boton-contorno boton-contorno--peligro" type="button" data-baja>Dar de baja cuenta</button></div>
          </section>` : ''}
        </div>
      </section>`,
      montar(raiz) {
        const fn = $('[data-nombre]', raiz);
        if (fn) {
          fn.addEventListener('submit', async (e) => {
            e.preventDefault();
            const d = datosForm(fn);
            const msg = 'El nombre debe tener de 2 a 100 caracteres, o de 3 a 120 caracteres para una institución.';
            if (u.tipo === 'adoptante' && !V.nombre(d.nombre)) return errorEn(fn, msg);
            if (u.tipo === 'refugio' && (!V.entre(d.nombre, 3, 120) || !V.entre(d.institucion, 3, 120))) return errorEn(fn, msg);
            const prob = u.tipo === 'refugio'
              ? problemaNombre(d.nombre, 'refugio') || problemaNombre(d.institucion, 'refugio')
              : problemaNombre(d.nombre, 'persona');
            if (prob) return errorEn(fn, prob);
            const b = $('button[type="submit"]', fn);
            ocupado(b);
            try {
              const r = await api('/cuenta/nombre', { metodo: 'PUT', datos: d });
              estado.usuario.nombre = d.nombre;
              errorEn(fn, '');
              aviso(r.mensaje);
            } catch (err) { errorEn(fn, textoError(err)); } finally { ocupado(b, false); }
          });
        }
        const ft = $('[data-telefono]', raiz);
        if (ft) {
          soloDigitos(ft);
          ft.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tel = ft.telefono.value.trim();
            if (!V.telefono(tel)) return errorEn(ft, M.telefono);
            if (!V.telefonoReal(tel)) return errorEn(ft, M.telefonoReal);
            const b = $('button[type="submit"]', ft);
            ocupado(b);
            try { aviso((await api('/cuenta/telefono', { metodo: 'PUT', datos: { telefono: tel } })).mensaje); errorEn(ft, ''); }
            catch (err) { errorEn(ft, textoError(err)); } finally { ocupado(b, false); }
          });
        }
        const fp = $('[data-pass]', raiz);
        fp.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!V.contrasena(fp.nueva.value)) return errorEn(fp, M.contrasena);
          const b = $('button[type="submit"]', fp);
          ocupado(b);
          try {
            const r = await api('/cuenta/contrasena', { metodo: 'PUT', datos: { actual: fp.actual.value, nueva: fp.nueva.value } });
            fp.reset();
            errorEn(fp, '');
            aviso(r.mensaje);
          } catch (err) { errorEn(fp, textoError(err)); } finally { ocupado(b, false); }
        });
        $('[data-tema]', raiz).addEventListener('change', (e) => { aplicarTema(e.target.value); guardarLS(CLAVE_TEMA, e.target.value); actualizarBotonTema(); });
        const bb = $('[data-baja]', raiz);
        if (bb) {
          bb.addEventListener('click', async () => {
            const ok = await dialogo({
              titulo: '¿Dar de baja tu cuenta?',
              texto: 'Esta acción cierra tu sesión. Confirma con tu contraseña actual.',
              cuerpo: html`<label class="campo"><span class="campo__etiqueta">Contraseña actual</span><input class="campo__entrada" name="contrasena" type="password" autocomplete="current-password" maxlength="64"></label>`,
              confirmar: 'Dar de baja',
              peligro: true,
              accion: (f) => api('/cuenta/baja', { metodo: 'POST', datos: { contrasena: f.contrasena.value } }),
            });
            if (ok) { limpiarSesionLocal(); aviso('Tu cuenta fue dada de baja.'); location.hash = '#/'; }
          });
        }
      },
    };
  }

  /* ---------- RF-24: notificaciones ---------- */
  async function vistaNotificaciones() {
    let lista;
    try { lista = await api('/notificaciones'); } catch (e) { lista = null; }
    return {
      html: html`
      <section class="principal">
        <div class="contenedor contenedor--estrecho">
          <h1 class="titulo-pagina">Notificaciones</h1>
          ${lista === null ? html`<p class="mensaje mensaje--error">No se pudo cargar la lista. Intente de nuevo.</p>`
    : !lista.length ? html`<div class="vacio">${seguro(SVG_HUELLA)}No tienes notificaciones.</div>`
      : html`
            <div class="acciones acciones--fin"><button class="boton-contorno boton-contorno--chico" type="button" data-todas${si(!lista.some((n) => !n.leida), 'disabled')}>Marcar todas como leídas</button></div>
            <ul class="filas">${lista.map((n) => html`
              <li class="fila fila--sin-imagen ${n.leida ? '' : 'fila--no-leida'}" data-id="${n.id}" tabindex="${n.leida ? '-1' : '0'}">
                <div><p class="fila__titulo">${n.texto}</p><p class="fila__meta">${String(n.creada_en).slice(0, 16)}</p></div>
                <div class="fila__lado">${n.leida ? insignia('', 'Leída') : insignia('pendiente', 'No leída')}</div>
              </li>`)}</ul>`}
        </div>
      </section>`,
      montar(raiz) {
        const marcar = async (li) => {
          if (!li.classList.contains('fila--no-leida')) return;
          li.classList.remove('fila--no-leida');
          $('.fila__lado', li).innerHTML = String(insignia('', 'Leída'));
          await api(`/notificaciones/${li.dataset.id}/leida`, { metodo: 'POST' }).catch(() => {});
          actualizarYo();
        };
        $$('.fila', raiz).forEach((li) => {
          li.addEventListener('click', () => marcar(li));
          li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); marcar(li); } });
        });
        const t = $('[data-todas]', raiz);
        if (t) t.addEventListener('click', async () => { await api('/notificaciones/leidas', { metodo: 'POST' }).catch(() => {}); await actualizarYo(); navegar(); });
      },
    };
  }

  /* ---------- RF-17: mis solicitudes ---------- */
  /* Aviso corto del refugio dentro de la solicitud */
  const notaRefugio = (s) => (s.nota_refugio
    ? html`<blockquote class="mensaje-solicitud mensaje-solicitud--refugio"><span class="mensaje-solicitud__etiqueta">Nota del refugio · ${s.nota_en}</span>${s.nota_refugio}</blockquote>` : '');

  /* Cita de adopción en tabla: qué día, a qué hora, dónde y qué llevar */
  function tablaCita(s, para) {
    const filas = para === 'adoptante'
      ? [
        ['Día', fechaBonita(s.cita_fecha)],
        ['Hora', `${s.cita_hora} h`],
        ['Refugio', s.refugio],
        ['Dirección', html`${s.direccion} · <a class="enlace" href="${mapaUrl(s, true)}" target="_blank" rel="noopener noreferrer">Cómo llegar</a>`],
        ['Teléfono', html`<a class="enlace" href="tel:${s.telefono}">${s.telefono}</a>`],
        ['Qué llevar', s.requisitos && s.requisitos.length ? html`<ul class="tabla-cita__lista">${s.requisitos.map((r) => html`<li>${r}</li>`)}</ul>` : 'Identificación oficial'],
      ]
      : [
        ['Día', fechaBonita(s.cita_fecha)],
        ['Hora', `${s.cita_hora} h`],
        ['Adoptante', s.adoptante],
        ['Teléfono', s.adoptante_telefono ? html`<a class="enlace" href="tel:${s.adoptante_telefono}">${s.adoptante_telefono}</a>` : 'Sin teléfono'],
        ['Mascota', s.animal],
      ];
    return html`<table class="tabla-cita"><caption>📅 Cita de adopción</caption>
      <tbody>${filas.map(([k, v]) => html`<tr><th scope="row">${k}</th><td>${v}</td></tr>`)}</tbody></table>`;
  }

  async function vistaMisSolicitudes() {
    let lista = null;
    try { lista = await api('/solicitudes/mias'); } catch { /* se muestra el mensaje */ }
    return html`
      <section class="principal">
        <div class="contenedor contenedor--estrecho">
          <h1 class="titulo-pagina">Mis solicitudes</h1>
          ${lista === null ? html`<p class="mensaje mensaje--error">No se pudo cargar la lista. Intente de nuevo.</p>`
    : !lista.length ? html`<div class="vacio">${seguro(SVG_HUELLA)}No tiene solicitudes registradas.<p><a class="boton-contorno" href="#/">Ver el catálogo</a></p></div>`
      : html`<ul class="filas">${lista.map((s) => html`
            <li class="fila">
              <div class="fila__imagen">${imagenAnimal(s)}</div>
              <div>
                <p class="fila__titulo"><a class="enlace" href="#/animal/${s.animal_id}">${s.animal}</a></p>
                <p class="fila__meta">${s.refugio} · Enviada ${s.enviada}</p>
                ${s.mensaje ? html`<blockquote class="mensaje-solicitud"><span class="mensaje-solicitud__etiqueta">Tu mensaje</span>${s.mensaje}</blockquote>` : ''}
                ${notaRefugio(s)}
                ${s.estado === 'rechazada' && s.motivo_rechazo ? html`<p class="fila__detalle">Motivo: ${s.motivo_rechazo}</p>` : ''}
                ${s.concretada_en ? html`<p class="fila__detalle">🎉 Adopción concretada el ${s.concretada_en}</p>`
    : s.cita_fecha ? tablaCita(s, 'adoptante')
      : s.estado === 'aprobada' ? html`<p class="fila__detalle">El refugio agendará tu cita pronto.</p>` : ''}
              </div>
              <div class="fila__lado">${insignia(s.estado, ETQ[s.estado])}</div>
            </li>`)}</ul>`}
        </div>
      </section>`;
  }

  /* ======================= 12. Vistas del Refugio ======================= */
  const subnavRefugio = (actual) => html`
    <nav class="pestanas" aria-label="Secciones del refugio">
      ${[['#/refugio', 'Mis animales'], ['#/refugio/solicitudes', 'Solicitudes'], ['#/refugio/estadisticas', 'Estadísticas'], ['#/refugio/perfil', 'Perfil']]
    .map(([h, t]) => html`<a class="pestana" href="${h}"${si(h === actual, 'aria-current="page"')}>${t}</a>`)}
    </nav>`;

  /* ---------- Mis animales (RF-13, RF-14, RF-15, RF-23) ---------- */
  /* Ficha de la mascota con todas sus solicitudes de adopción (vista del refugio) */
  async function verMascota(animalId) {
    let a; let sols; let cat;
    try {
      [a, sols, cat] = await Promise.all([
        api(`/refugio/animales/${animalId}`),
        api(`/refugio/solicitudes?animal_id=${animalId}`),
        catalogos(),
      ]);
    } catch (e) { aviso(textoError(e, 'No se pudo cargar la ficha. Intente de nuevo.'), 'error'); return; }
    const nombreCat = (lista, id) => (lista.find((x) => x.id === Number(id)) || {}).nombre || '';
    const pendientes = sols.filter((x) => x.estado === 'pendiente').length;
    const ir = await dialogo({
      titulo: a.nombre,
      ancho: true,
      cuerpo: html`
        <div class="mini-ficha">
          <div class="tarjeta__foto">${imagenAnimal(a)}</div>
          <div>
            <p class="ficha__raza">${nombreRaza(a)}</p>
            <div class="ficha__chips">
              ${insignia(a.estado, ETQ[a.estado])}
              <span class="insignia">${nombreCat(cat.edad, a.edad_id)}</span>
              <span class="insignia">${nombreCat(cat.tamano, a.tamano_id)}</span>
              ${a.peso_kg ? html`<span class="insignia">${Number(a.peso_kg)} kg · ${a.altura_cm} cm</span>` : ''}
              <span class="insignia">${Number(a.esterilizado) ? 'Esterilizado' : 'Sin esterilizar'}</span>
            </div>
            <p><strong>Ingreso:</strong> ${a.fecha_ingreso} · <strong>Publicado:</strong> ${String(a.publicado_en).slice(0, 10)}</p>
            <p><strong>Salud:</strong> ${CAMPOS_SALUD.filter((c) => a[c]).map((c) => etiquetaOpcion(cat, c, a[c])).join(' · ') || a.salud || 'Sin información.'}</p>
            <p><strong>Temperamento:</strong> ${CAMPOS_TEMP.filter((c) => a[c]).map((c) => `${cat.animal[c].titulo}: ${etiquetaOpcion(cat, c, a[c]).toLowerCase()}`).join(' · ') || a.temperamento || 'Sin información.'}</p>
            <p><strong>Vacunas:</strong> ${a.vacunas.length ? a.vacunas.map((v) => `${v.nombre} (${v.fecha})`).join(', ') : 'Ninguna registrada'}</p>
            <p><strong>Requisitos:</strong> ${a.requisitos.length ? a.requisitos.map((r) => r.nombre).join(', ') : 'Ninguno'}</p>
          </div>
        </div>
        <h3 class="fila__titulo">Solicitudes de adopción (${sols.length})</h3>
        ${!sols.length ? html`<p class="vacio">Esta mascota aún no tiene solicitudes.</p>` : html`
        <ul class="filas">${sols.map((x) => html`
          <li class="fila fila--sin-imagen">
            <div>
              <p class="fila__titulo">${x.adoptante}</p>
              <p class="fila__meta">${x.adoptante_correo}${x.adoptante_telefono ? ` · Tel. ${x.adoptante_telefono}` : ''} · Enviada ${x.enviada}</p>
              ${x.mensaje ? html`<blockquote class="mensaje-solicitud"><span class="mensaje-solicitud__etiqueta">Mensaje del adoptante</span>${x.mensaje}</blockquote>` : ''}
              ${x.motivo_rechazo ? html`<p class="fila__detalle">Motivo: ${x.motivo_rechazo}</p>` : ''}
              ${x.concretada_en ? html`<p class="fila__detalle">Adopción concretada el ${x.concretada_en}</p>`
    : x.cita_fecha ? tablaCita(x, 'refugio') : ''}
              ${notaRefugio(x)}
            </div>
            <div class="fila__lado">${insignia(x.estado, ETQ[x.estado])}</div>
          </li>`)}</ul>`}`,
      confirmar: pendientes ? `Responder pendientes (${pendientes})` : 'Ir a solicitudes',
      cancelar: 'Cerrar',
    });
    if (ir) location.hash = `#/refugio/solicitudes?estado=${pendientes ? 'pendiente' : 'aprobada'}`;
  }

  async function vistaRefugio(ctx) {
    const lista = await api('/refugio/animales');
    const ver = ctx.query.get('ver') === 'adoptados' ? 'adoptado' : 'disponible';
    const filtrados = lista.filter((a) => a.estado === ver);
    const pie = (a) => html`
      <div class="tarjeta__pie">
        ${insignia(a.estado, ETQ[a.estado])}
        ${Number(a.activas) ? html`<span class="insignia">${a.activas} activas</span>` : ''}
      </div>
      <div class="tarjeta__editar acciones acciones--centro">
        <button class="boton-contorno boton-contorno--chico boton-contorno--relleno" type="button" data-ver="${a.id}">Ver ficha y solicitudes</button>
        ${a.estado === 'disponible' ? html`<a class="boton-contorno boton-contorno--chico" href="#/refugio/animal/${a.id}">Editar</a>` : ''}
        <button class="boton-contorno boton-contorno--chico" type="button" data-estado="${a.id}">${a.estado === 'disponible' ? 'Adoptado' : 'Disponible'}</button>
        ${a.estado === 'disponible' ? html`<button class="boton-contorno boton-contorno--chico boton-contorno--peligro" type="button" data-eliminar="${a.id}">Eliminar</button>`
    : html`<button class="boton-contorno boton-contorno--chico" type="button" data-cerrar="${a.id}">Cerrar solicitudes</button>`}
      </div>`;
    return {
      html: html`
      <section class="principal">
        <h1 class="titulo-pagina">Mis animales</h1>
        ${subnavRefugio('#/refugio')}
        <div class="acciones acciones--centro">
          <a class="pestana" href="#/refugio"${si(ver === 'disponible', 'aria-current="page"')}>Disponibles (${lista.filter((a) => a.estado === 'disponible').length})</a>
          <a class="pestana" href="#/refugio?ver=adoptados"${si(ver === 'adoptado', 'aria-current="page"')}>Adoptados (${lista.filter((a) => a.estado === 'adoptado').length})</a>
          <a class="boton-contorno boton-contorno--relleno" href="#/refugio/animal/nuevo">Registrar un perro</a>
        </div>
        <br>
        ${filtrados.length ? html`<ul class="catalogo">${filtrados.map((a) => tarjetaAnimal(a, { enlace: false, pie: pie(a) }))}</ul>`
    : html`<div class="vacio contenedor contenedor--estrecho">${seguro(SVG_MESTIZO)}${ver === 'disponible' ? 'Aún no tienes animales disponibles. ¡Publica el primero!' : 'Todavía no hay adopciones registradas.'}</div>`}
      </section>`,
      montar(raiz) {
        const buscar = (id) => lista.find((a) => a.id === Number(id));
        $$('[data-ver]', raiz).forEach((b) => b.addEventListener('click', () => verMascota(b.dataset.ver)));
        $$('[data-estado]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const a = buscar(b.dataset.estado);
          const nuevo = a.estado === 'disponible' ? 'adoptado' : 'disponible';
          const ok = await dialogo({
            titulo: `Cambiar a ${ETQ[nuevo]}`,
            texto: nuevo === 'adoptado'
              ? `Se concreta la adopción con la solicitud aprobada de ${a.nombre}. Saldrá del catálogo y las demás solicitudes se rechazarán con el motivo “El animal ya fue adoptado”.`
              : `${a.nombre} volverá a aparecer en el catálogo y la adopción registrada se revertirá.`,
            cuerpo: nuevo === 'adoptado'
              ? html`<label class="campo"><span class="campo__etiqueta">Fecha de concreción</span><input class="campo__entrada" type="date" name="fecha" max="${hoyCDMX()}" value="${hoyCDMX()}"></label>`
              : '',
            confirmar: 'Guardar',
            accion: (f) => {
              if (nuevo === 'adoptado' && (!f.fecha.value || f.fecha.value > hoyCDMX())) fallo('La fecha de concreción debe estar entre la fecha de aprobación y hoy.');
              return api(`/refugio/animales/${a.id}/estado`, { metodo: 'POST', datos: { estado: nuevo, fecha: nuevo === 'adoptado' ? f.fecha.value : undefined } });
            },
          });
          if (ok) { aviso('Estado actualizado.'); navegar(); }
        }));
        $$('[data-eliminar]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const a = buscar(b.dataset.eliminar);
          const ok = await dialogo({
            titulo: `¿Eliminar a ${a.nombre}?`, texto: 'La publicación saldrá del catálogo. Su registro se conserva para tus estadísticas.',
            confirmar: 'Eliminar', peligro: true,
            accion: () => api(`/refugio/animales/${a.id}`, { metodo: 'DELETE' }),
          });
          if (ok) { aviso('Publicación eliminada.'); navegar(); }
        }));
        $$('[data-cerrar]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const a = buscar(b.dataset.cerrar);
          const ok = await dialogo({
            titulo: 'Cerrar solicitudes', texto: `Las solicitudes pendientes de ${a.nombre} pasarán a Rechazada con el motivo “El animal ya fue adoptado”.`,
            accion: async () => { const r = await api(`/refugio/animales/${a.id}/cerrar-solicitudes`, { metodo: 'POST' }); aviso(r.mensaje); },
          });
          if (ok) navegar();
        }));
      },
    };
  }

  /* ---------- RF-12 / RF-13: publicar o editar un animal ---------- */
  const filaRequisito = (cat, r = {}) => html`
    <div class="repetible__fila">
      <input class="campo__entrada" name="req_nombre" type="text" maxlength="100" placeholder="Ej. Copia de INE" value="${r.nombre || ''}" aria-label="Nombre del requisito">
      <select class="campo__entrada" name="req_tipo" aria-label="Tipo de requisito">${opciones(cat.tipo_requisito, r.tipo_id, 'Tipo')}</select>
      <button class="boton-icono" type="button" data-quitar aria-label="Quitar">${ICONO.quitar}</button>
    </div>`;
  /* Documentos de la lista cerrada (catálogo "documento"): el refugio solo marca los que pide */
  const listaDocumentos = (cat, actuales = []) => {
    const elegidos = actuales.filter((r) => !Number(r.otro)).map((r) => r.nombre);
    const activos_ = activos(cat.documento || []).map((d) => d.nombre);
    const extra = elegidos.filter((n) => !activos_.includes(n)); // ya elegidos aunque el admin los haya desactivado
    return html`<div class="documentos" data-documentos>${[...activos_, ...extra].map((n) => html`
      <label class="documento"><input type="checkbox" data-doc value="${n}"${si(elegidos.includes(n), 'checked')}><span>${n}</span></label>`)}</div>`;
  };

  /* Dimensiones sugeridas: rango adulto de la raza (o del tamaño en mestizos), ajustado a la edad. Mismas reglas que util.js */
  const mesesDeEdad = (nombre) => {
    const m = String(nombre || '').match(/(\d+)\s*(mes|año|ano)/i);
    return m ? (/^mes/i.test(m[2]) ? Number(m[1]) : Number(m[1]) * 12) : null;
  };
  function rangoDims(cat, raza, aprox, tamanoNombre) {
    const pura = raza && raza !== 'mestizo' && cat.dims.razas[raza];
    if (pura) return { ...pura, base: `un ${RAZA[raza].nombre}` };
    const t = cat.dims.tamano[sinAcentos(tamanoNombre || '')];
    if (!t) return null;
    const parecido = aprox && cat.dims.razas[aprox];
    return { ...t, sugerido: parecido || t, base: `un perro de tamaño ${String(tamanoNombre).toLowerCase()}` };
  }
  function limitesDims(r, meses) {
    const r1 = (n) => Math.round(n * 10) / 10;
    const adulto = meses == null || meses >= 12;
    return {
      adulto,
      peso: [adulto ? r1(r.peso[0] * 0.75) : 0.3, r1(r.peso[1] * (adulto ? 1.3 : 1.1))],
      altura: [adulto ? Math.floor(r.altura[0] * 0.85) : 8, Math.ceil(r.altura[1] * (adulto ? 1.15 : 1.1))],
    };
  }
  function sugerirDims(r, meses) {
    const s = r.sugerido || r;
    const f = meses == null || meses >= 12 ? 1 : Math.max(0.15, meses / 12);
    const peso = Math.round(((s.peso[0] + s.peso[1]) / 2) * f * 10) / 10;
    const altura = Math.round(((s.altura[0] + s.altura[1]) / 2) * (0.5 + 0.5 * f));
    const lim = limitesDims(r, meses);
    const entre = (v, [a, b]) => Math.min(b, Math.max(a, v));
    return { peso: entre(peso, lim.peso), altura: entre(altura, lim.altura) };
  }

  /* Vacunas del catálogo con casilla y fecha de aplicación (opción múltiple, máx. 10) */
  const listaVacunas = (cat, actuales = []) => {
    const activas = activos(cat.vacuna || []).map((v) => v.nombre);
    const extra = actuales.map((v) => v.nombre).filter((n) => !activas.includes(n)); // vacunas antiguas o desactivadas ya registradas
    return html`<div class="vacunas" data-vacunas>${[...activas, ...extra].map((n) => {
      const v = actuales.find((x) => x.nombre === n);
      return html`
        <div class="vacuna ${v ? 'vacuna--activa' : ''}">
          <label class="vacuna__nombre"><input type="checkbox" data-vac value="${n}"${si(v, 'checked')}><span>${n}</span></label>
          <input class="campo__entrada" type="date" data-vac-fecha min="2000-01-01" max="${hoyCDMX()}" value="${v ? v.fecha : ''}" aria-label="Fecha de aplicación: ${n}"${si(!v, 'disabled')}>
        </div>`;
    })}</div>`;
  };

  async function vistaFormAnimal(ctx) {
    const cat = await catalogos(true);
    if (!cat.animal || !cat.vacuna) throw new ErrorApi(500, 'El servidor no tiene la versión más reciente de Dopta. Detén el servidor (Ctrl + C) y vuelve a ejecutar npm start.');
    const id = ctx.params.id ? idValido(ctx.params.id) : null;
    let a = {};
    if (ctx.params.id && !id) return vista404();
    if (id) {
      try { a = await api(`/refugio/animales/${id}?editar=1`); } catch (e) {
        if ([403, 404, 409].includes(e.status)) { aviso(e.message, 'error'); location.replace('#/refugio'); return ''; }
        throw e;
      }
    }
    const hoy = hoyCDMX();
    return {
      html: html`
      <section class="principal principal--cuenta">
        <div class="contenedor">
          ${botonRegresar('#/refugio')}
          <section class="panel panel--ancho">
            <h1 class="panel__titulo">${id ? `Editar a ${a.nombre}` : 'Agregar mascota al catálogo'}</h1>
            <form class="formulario formulario--dos" novalidate data-animal>
              <div class="campo"><label class="campo__etiqueta" for="nombre">Nombre de la mascota</label>
                <input class="campo__entrada" id="nombre" name="nombre" type="text" maxlength="30" placeholder="Ej. Luna" value="${a.nombre || ''}" required></div>
              <div class="campo"><label class="campo__etiqueta" for="fecha_ingreso">Fecha de ingreso al refugio</label>
                <input class="campo__entrada" id="fecha_ingreso" name="fecha_ingreso" type="date" min="2000-01-01" max="${hoy}" value="${a.fecha_ingreso || hoy}" required></div>
              ${selectorRazas(a.raza || '', a.raza_aprox || '')}
              <div class="campo"><label class="campo__etiqueta" for="edad">Edad</label>
                <select class="campo__entrada" id="edad" name="edad_id">${opciones(cat.edad, a.edad_id, 'Selecciona la edad')}</select></div>
              <div class="campo"><label class="campo__etiqueta" for="tamano">Tamaño</label>
                <select class="campo__entrada" id="tamano" name="tamano_id">${opciones(cat.tamano, a.tamano_id, 'Selecciona el tamaño')}</select>
                <span class="campo__ayuda" data-tamano-ayuda aria-live="polite"></span></div>
              <div class="campo"><label class="campo__etiqueta" for="peso">Peso (kg)</label>
                <input class="campo__entrada campo__entrada--numero" id="peso" name="peso_kg" type="number" inputmode="decimal" min="0.3" max="100" step="0.1" value="${a.peso_kg ?? ''}" placeholder="Ej. 12.5" required></div>
              <div class="campo"><label class="campo__etiqueta" for="altura">Altura a la cruz (cm)</label>
                <input class="campo__entrada campo__entrada--numero" id="altura" name="altura_cm" type="number" inputmode="numeric" min="8" max="110" step="1" value="${a.altura_cm ?? ''}" placeholder="Ej. 45" required></div>
              <p class="campo__ayuda campo--ancho dims-ayuda" data-dims-ayuda aria-live="polite">Elige la raza y la edad para sugerir el peso y la altura.</p>
              <p class="seccion-form">Estado de salud</p>
              ${CAMPOS_SALUD.map((c) => html`<div class="campo campo--ancho">${grupoCerrado(cat, c, a[c])}</div>`)}
              <p class="seccion-form">Temperamento</p>
              ${CAMPOS_TEMP.map((c) => html`<div class="campo campo--ancho">${grupoCerrado(cat, c, a[c])}</div>`)}

              <p class="seccion-form">Esterilización</p>
              <div class="campo"><span class="campo__etiqueta">¿Está esterilizado?</span>
                <div class="pregunta__opciones">
                  <label class="opcion"><input type="radio" name="esterilizado" value="si"${si(Number(a.esterilizado) === 1, 'checked')}><span class="opcion__texto">Sí</span></label>
                  <label class="opcion"><input type="radio" name="esterilizado" value="no"${si(Number(a.esterilizado) !== 1, 'checked')}><span class="opcion__texto">No</span></label>
                </div></div>
              <div class="campo" data-fecha-est${si(Number(a.esterilizado) !== 1, 'hidden')}><label class="campo__etiqueta" for="fecha_est">Fecha de esterilización</label>
                <input class="campo__entrada" id="fecha_est" name="fecha_esterilizacion" type="date" min="2000-01-01" max="${hoy}" value="${a.fecha_esterilizacion || ''}"></div>

              <p class="seccion-form">Vacunas <span class="campo__ayuda">(marca las aplicadas y su fecha · hasta 10)</span></p>
              <div class="campo campo--ancho">${listaVacunas(cat, a.vacunas || [])}</div>

              <p class="seccion-form">Requisitos de adopción <span class="campo__ayuda">(marca los documentos que pides · hasta 10 · se entregan en persona en la cita)</span></p>
              <div class="campo campo--ancho">${listaDocumentos(cat, a.requisitos || [])}</div>
              <div class="campo campo--ancho"><span class="campo__etiqueta">Otro requisito <span class="opcional">(si no está en la lista · hasta 3)</span></span>
                <div class="repetible" data-requisitos>${(a.requisitos || []).filter((r) => Number(r.otro)).map((r) => filaRequisito(cat, r))}</div>
                <div class="acciones"><button class="boton-contorno boton-contorno--chico" type="button" data-agregar="requisitos">Agregar otro requisito</button></div>
                <span class="campo__ayuda">Texto: datos personales (nombre, dirección, teléfono). Documental: documentos o imágenes.</span></div>

              <p class="mensaje mensaje--error campo--ancho" data-error role="alert"></p>
              <div class="panel__acciones campo--ancho"><button class="boton-contorno boton-contorno--relleno" type="submit">${id ? 'Guardar cambios' : 'Publicar mascota'}</button></div>
            </form>
          </section>
        </div>
      </section>`,
      montar(raiz) {
        const f = $('[data-animal]', raiz);
        montarRazas(f);
        montarContadores(f);
        const limite = 'Solo se permiten hasta 10 requisitos o hasta 10 vacunas.';
        /* Tamaño según la raza: en raza pura se asigna solo y se bloquea; en mestizo se sugiere el de la raza parecida */
        const selTam = $('#tamano', f);
        const ayudaTam = $('[data-tamano-ayuda]', f);
        let tamanoManual = !!a.tamano_id && a.raza === 'mestizo';
        const tamanoDe = (razaId) => {
          const r = RAZA[razaId];
          const t = r && activos(cat.tamano).find((x) => sinAcentos(x.nombre) === sinAcentos(r.tamano));
          return t ? String(t.id) : '';
        };
        const sincronizarTamano = () => {
          const raza = ($('input[name="raza"]:checked', f) || {}).value || '';
          const aprox = ($('input[name="raza_aprox"]:checked', f) || {}).value || '';
          const fijo = raza && raza !== 'mestizo' ? tamanoDe(raza) : '';
          selTam.disabled = !!fijo;
          selTam.classList.toggle('campo__entrada--fijo', !!fijo);
          if (fijo) {
            selTam.value = fijo;
            ayudaTam.textContent = `Asignado automáticamente: un ${RAZA[raza].nombre} siempre es de tamaño ${selTam.selectedOptions[0].textContent}.`;
          } else if (raza === 'mestizo') {
            const sug = tamanoDe(aprox);
            if (sug && !tamanoManual) selTam.value = sug;
            ayudaTam.textContent = sug ? `Sugerido por su parecido a ${RAZA[aprox].nombre}. Puedes cambiarlo.` : 'Elige el tamaño según su peso y altura.';
          } else ayudaTam.textContent = '';
        };
        selTam.addEventListener('change', () => { tamanoManual = true; });
        f.addEventListener('change', (e) => { if (e.target.name === 'raza' || e.target.name === 'raza_aprox') { if (e.target.name === 'raza') tamanoManual = false; sincronizarTamano(); } });
        sincronizarTamano();

        /* Peso y altura: se sugieren según raza, edad y tamaño hasta que el refugio los cambie a mano */
        const inPeso = $('#peso', f);
        const inAltura = $('#altura', f);
        const ayudaDims = $('[data-dims-ayuda]', f);
        let dimsManual = !!(a.peso_kg && a.altura_cm);
        const contexto = () => {
          const raza = ($('input[name="raza"]:checked', f) || {}).value || '';
          const aprox = ($('input[name="raza_aprox"]:checked', f) || {}).value || '';
          const tam = selTam.value ? selTam.selectedOptions[0].textContent : '';
          const edad = $('#edad', f).value ? $('#edad', f).selectedOptions[0].textContent : '';
          return { r: rangoDims(cat, raza, aprox, tam), meses: mesesDeEdad(edad) };
        };
        const sincronizarDims = (forzar = false) => {
          const { r, meses } = contexto();
          if (!r) { ayudaDims.textContent = 'Elige la raza (y el tamaño si es mestizo) para sugerir el peso y la altura.'; return; }
          const l = limitesDims(r, meses);
          const sug = sugerirDims(r, meses);
          if (!dimsManual || forzar) { inPeso.value = sug.peso; inAltura.value = sug.altura; }
          ayudaDims.innerHTML = String(html`📏 Típico de ${r.base} adulto: <strong>${r.peso[0]}–${r.peso[1]} kg</strong> y <strong>${r.altura[0]}–${r.altura[1]} cm</strong>.
            ${l.adulto ? '' : `Como es cachorro, se aceptan valores menores (máx. ${l.peso[1]} kg y ${l.altura[1]} cm). `}
            ${dimsManual ? html`<button class="enlace" type="button" data-dims-sugerir>Usar ${sug.peso} kg y ${sug.altura} cm</button>` : 'Valores sugeridos: ajústalos si lo pesaste o mediste.'}`);
        };
        [inPeso, inAltura].forEach((x) => x.addEventListener('input', () => { dimsManual = true; }));
        f.addEventListener('change', (e) => { if (['raza', 'raza_aprox', 'edad_id', 'tamano_id'].includes(e.target.name)) sincronizarDims(); });
        f.addEventListener('click', (e) => { if (e.target.closest('[data-dims-sugerir]')) { dimsManual = false; sincronizarDims(true); } });
        sincronizarDims();
        $$('[data-doc]', f).forEach((c) => c.addEventListener('change', () => {
          if (c.checked && $$('[data-doc]:checked', f).length + $('[data-requisitos]', f).children.length > 10) { c.checked = false; errorEn(f, limite); }
        }));
        $$('[data-agregar]', f).forEach((b) => b.addEventListener('click', () => {
          const caja = $(`[data-${b.dataset.agregar}]`, f);
          if (caja.children.length >= 3) return errorEn(f, 'Puede agregar hasta 3 requisitos en "Otro".');
          if (caja.children.length + $$('[data-doc]:checked', f).length >= 10) return errorEn(f, limite);
          caja.insertAdjacentHTML('beforeend', String(filaRequisito(cat)));
          $('input', caja.lastElementChild).focus();
        }));
        f.addEventListener('click', (e) => { const q = e.target.closest('[data-quitar]'); if (q) q.closest('.repetible__fila').remove(); });
        $$('[data-vac]', f).forEach((c) => c.addEventListener('change', () => {
          if (c.checked && $$('[data-vac]:checked', f).length > 10) { c.checked = false; return errorEn(f, limite); }
          const fila = c.closest('.vacuna');
          const fecha = $('[data-vac-fecha]', fila);
          fila.classList.toggle('vacuna--activa', c.checked);
          fecha.disabled = !c.checked;
          if (c.checked) fecha.focus(); else fecha.value = '';
        }));
        f.addEventListener('change', (e) => { if (e.target.name === 'esterilizado') $('[data-fecha-est]', f).hidden = e.target.value !== 'si'; });

        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          errorEn(f, '');
          let datos;
          try {
            const d = datosForm(f);
            const raza = ($('input[name="raza"]:checked', f) || {}).value;
            const aprox = ($('input[name="raza_aprox"]:checked', f) || {}).value || null;
            if (!V.entre(d.nombre, 2, 30) || !V.nombre(d.nombre)) fallo('El nombre del perro debe tener de 2 a 30 caracteres, solo letras y espacios.');
            revisarNombre(d.nombre, 'perro');
            if (!raza) fallo('Seleccione la raza del animal.');
            if (!d.edad_id) fallo('Seleccione la edad del animal.');
            d.tamano_id = $('#tamano', f).value; // puede estar bloqueado (raza pura): se lee directo del selector
            if (!d.tamano_id) fallo('Seleccione el tamaño del animal.');
            const cerrados = {};
            [...CAMPOS_SALUD, ...CAMPOS_TEMP].forEach((c) => {
              if (!d[c]) fallo(`Seleccione una opción en “${cat.animal[c].titulo}”.`);
              cerrados[c] = d[c];
            });
            // Coherencia: fechas no futuras, no antes del 2000 ni antes del nacimiento estimado por la edad elegida
            const edadNombre = (cat.edad.find((x) => x.id === Number(d.edad_id)) || {}).nombre || '';
            const nacimiento = nacimientoMinimo(edadNombre, hoyCDMX());
            const pasada = (fecha, que) => {
              if (!fecha || fecha > hoyCDMX()) fallo('La fecha debe ser igual o anterior a la fecha de hoy.');
              if (fecha < '2000-01-01') fallo(`La fecha de ${que} no puede ser anterior al año 2000.`);
              if (nacimiento && fecha < nacimiento) fallo(`La fecha de ${que} (${fecha}) es anterior al nacimiento estimado por su edad (${edadNombre}). Revise la fecha o la edad.`);
            };
            pasada(d.fecha_ingreso, 'ingreso');
            // Peso y altura coherentes con la raza (o el tamaño) y la edad
            const peso = Number(d.peso_kg);
            const altura = Number(d.altura_cm);
            if (!d.peso_kg || !(peso >= 0.3 && peso <= 100)) fallo('Indique el peso en kilos (entre 0.3 y 100 kg).');
            if (!d.altura_cm || !(altura >= 8 && altura <= 110)) fallo('Indique la altura a la cruz en centímetros (entre 8 y 110 cm).');
            const { r: rd, meses } = contexto();
            if (rd) {
              const l = limitesDims(rd, meses);
              const quien = `${rd.base} ${l.adulto ? 'adulto' : 'cachorro'}`;
              if (peso < l.peso[0] || peso > l.peso[1]) fallo(`El peso no es coherente: para ${quien} se acepta de ${l.peso[0]} a ${l.peso[1]} kg. Revise el peso, la raza o la edad.`);
              if (altura < l.altura[0] || altura > l.altura[1]) fallo(`La altura no es coherente: para ${quien} se acepta de ${l.altura[0]} a ${l.altura[1]} cm. Revise la altura, la raza o la edad.`);
            }
            const documentos = $$('[data-doc]:checked', f).map((c) => ({ nombre: c.value, otro: false }));
            const otros = $$('[data-requisitos] .repetible__fila', f).map((r) => {
              const nombre = $('[name="req_nombre"]', r).value.trim().replace(/\s+/g, ' ');
              const tipo = Number($('[name="req_tipo"]', r).value);
              if (!V.entre(nombre, 3, 100) || !V.letras(nombre, 3) || !tipo) fallo('Cada requisito "Otro" debe tener de 3 a 100 caracteres, con letras, y un tipo Texto o Documental.');
              return { nombre, tipo_id: tipo, otro: true };
            });
            if (otros.length > 3) fallo('Puede agregar hasta 3 requisitos en "Otro".');
            const requisitos = [...documentos, ...otros];
            const nombresReq = requisitos.map((x) => x.nombre.toLowerCase());
            if (new Set(nombresReq).size !== nombresReq.length) fallo('Hay requisitos repetidos. Cada requisito debe aparecer una sola vez.');
            const vacunas = $$('[data-vac]:checked', f).map((c) => {
              const fecha = $('[data-vac-fecha]', c.closest('.vacuna')).value;
              if (!fecha) fallo(`Indique la fecha de aplicación de “${c.value}”.`);
              pasada(fecha, `la vacuna ${c.value}`);
              return { nombre: c.value, fecha };
            });
            if (requisitos.length > 10 || vacunas.length > 10) fallo(limite);
            const ester = d.esterilizado === 'si';
            if (ester) { if (!d.fecha_esterilizacion) fallo('Ingrese la fecha de esterilización.'); pasada(d.fecha_esterilizacion, 'esterilización'); }
            datos = {
              nombre: d.nombre, raza, raza_aprox: raza === 'mestizo' ? aprox : null, edad_id: Number(d.edad_id), tamano_id: Number(d.tamano_id),
              ...cerrados, fecha_ingreso: d.fecha_ingreso, requisitos, vacunas, peso_kg: peso, altura_cm: altura,
              esterilizado: ester, fecha_esterilizacion: ester ? d.fecha_esterilizacion : null,
            };
          } catch (err) { return errorEn(f, err.message); }
          const b = $('button[type="submit"]', f);
          ocupado(b);
          try {
            const r = await api(id ? `/refugio/animales/${id}` : '/refugio/animales', { metodo: id ? 'PUT' : 'POST', datos });
            aviso(r.mensaje);
            location.hash = '#/refugio';
          } catch (err) {
            ocupado(b, false);
            errorEn(f, textoError(err, 'No se pudo publicar el animal. Intente de nuevo.'));
          }
        });
      },
    };
  }

  /* ---------- RF-18 a RF-22: solicitudes recibidas ---------- */
  async function perfilRefugio(refrescar) {
    if (!estado.perfil || refrescar) estado.perfil = await api('/refugio/perfil');
    return estado.perfil;
  }

  /* Bloques de 30 minutos dentro del horario del día (RF-21) */
  const bloques = (abre, cierra) => {
    const aMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));
    const res = [];
    for (let m = Math.ceil(aMin(abre) / 30) * 30; m + 30 <= aMin(cierra); m += 30) res.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    return res;
  };

  async function agendarCita(s) {
    const p = await perfilRefugio();
    const hoy = hoyCDMX();
    const dias = [1, 2, 3, 4, 5, 6, 7].map((n) => sumarDias(hoy, n)).map((f) => {
      const h = p.horario.find((x) => x.dia === diaSemana(f));
      return { f, h, cerrado: !h || Number(h.cerrado) };
    });
    return dialogo({
      titulo: `Cita con ${s.adoptante}`,
      texto: `Para entregar los requisitos de adopción de ${s.animal}. Fechas disponibles: los próximos 7 días.`,
      cuerpo: html`
        <label class="campo"><span class="campo__etiqueta">Fecha</span>
          <select class="campo__entrada" name="fecha"><option value="">Selecciona una fecha</option>
            ${dias.map((d) => html`<option value="${d.f}"${si(d.cerrado, 'disabled')}>${fechaBonita(d.f)} · ${d.f}${d.cerrado ? ' (cerrado)' : ''}</option>`)}</select></label>
        <label class="campo"><span class="campo__etiqueta">Hora</span><select class="campo__entrada" name="hora" disabled><option value="">Primero elige la fecha</option></select></label>`,
      confirmar: s.cita_fecha ? 'Reprogramar cita' : 'Agendar cita',
      montar(d) {
        const sf = $('[name="fecha"]', d);
        const sh = $('[name="hora"]', d);
        sf.addEventListener('change', () => {
          const dia = dias.find((x) => x.f === sf.value);
          sh.disabled = !dia || dia.cerrado;
          sh.innerHTML = String(dia && !dia.cerrado
            ? html`<option value="">Selecciona la hora</option>${bloques(dia.h.abre, dia.h.cierra).map((b) => html`<option>${b}</option>`)}`
            : html`<option value="">Primero elige la fecha</option>`);
        });
      },
      accion: async (f) => {
        if (!f.fecha.value) fallo('La fecha debe estar dentro de los próximos 7 días.');
        if (!f.hora.value) fallo('Seleccione una hora en bloques de 30 minutos.');
        await api(`/refugio/solicitudes/${s.id}/cita`, { metodo: 'POST', datos: { fecha: f.fecha.value, hora: f.hora.value } });
      },
    });
  }

  async function vistaRefugioSolicitudes(ctx) {
    const filtro = ['pendiente', 'aprobada', 'rechazada'].includes(ctx.query.get('estado')) ? ctx.query.get('estado') : 'pendiente';
    const lista = await api(`/refugio/solicitudes?estado=${filtro}`);
    const acciones = (s) => {
      if (s.estado === 'pendiente') {
        return html`<button class="boton-contorno boton-contorno--chico boton-contorno--relleno" type="button" data-accion="aprobar" data-id="${s.id}">Aprobar</button>
          <button class="boton-contorno boton-contorno--chico boton-contorno--peligro" type="button" data-accion="rechazar" data-id="${s.id}">Rechazar</button>
          ${botonNota(s)}`;
      }
      if (s.estado === 'aprobada' && !s.concretada_en && s.animal_estado === 'disponible') {
        return html`<button class="boton-contorno boton-contorno--chico" type="button" data-accion="cita" data-id="${s.id}">${s.cita_fecha ? 'Reprogramar cita' : 'Agendar cita'}</button>
          <button class="boton-contorno boton-contorno--chico boton-contorno--relleno" type="button" data-accion="adopcion" data-id="${s.id}">Marcar adopción</button>
          <button class="boton-contorno boton-contorno--chico boton-contorno--peligro" type="button" data-accion="rechazar" data-id="${s.id}">Cancelar aprobación</button>
          ${botonNota(s)}`;
      }
      return '';
    };
    const botonNota = (s) => html`<button class="boton-contorno boton-contorno--chico" type="button" data-accion="nota" data-id="${s.id}">${s.nota_refugio ? 'Editar nota' : 'Dejar nota'}</button>`;
    return {
      html: html`
      <section class="principal">
        <h1 class="titulo-pagina">Solicitudes recibidas</h1>
        ${subnavRefugio('#/refugio/solicitudes')}
        <div class="contenedor contenedor--estrecho">
          <div class="pestanas" role="group" aria-label="Filtrar por estado">
            ${['pendiente', 'aprobada', 'rechazada'].map((e) => html`<a class="pestana" href="#/refugio/solicitudes?estado=${e}"${si(e === filtro, 'aria-current="page"')}>${ETQ[e]}s</a>`)}
          </div>
          ${!lista.length ? html`<div class="vacio">${seguro(SVG_HUELLA)}No hay solicitudes con el estado seleccionado.</div>`
    : html`<ul class="filas">${lista.map((s) => html`
            <li class="fila">
              <button class="boton-ficha" type="button" data-ver="${s.animal_id}" aria-label="Ver ficha de ${s.animal}"><span class="fila__imagen">${dibujo(s)}</span></button>
              <div>
                <p class="fila__titulo"><button class="enlace" type="button" data-ver="${s.animal_id}">${s.animal}</button></p>
                <p class="fila__meta">${s.adoptante} · ${s.adoptante_correo}${s.adoptante_telefono ? html` · <a class="enlace" href="tel:${s.adoptante_telefono}">Tel. ${s.adoptante_telefono}</a>` : ''} · Enviada ${s.enviada}</p>
                ${s.mensaje ? html`<blockquote class="mensaje-solicitud"><span class="mensaje-solicitud__etiqueta">Mensaje del adoptante</span>${s.mensaje}</blockquote>` : ''}
                ${notaRefugio(s)}
                ${s.motivo_rechazo ? html`<p class="fila__detalle">Motivo: ${s.motivo_rechazo}</p>` : ''}
                ${s.concretada_en ? html`<p class="fila__detalle">Adopción concretada el ${s.concretada_en}</p>`
    : s.cita_fecha ? tablaCita(s, 'refugio') : ''}
              </div>
              <div class="fila__lado">${insignia(s.estado, ETQ[s.estado])}<div class="acciones">${acciones(s)}</div></div>
            </li>`)}</ul>`}
        </div>
      </section>`,
      montar(raiz) {
        raiz.addEventListener('click', async (e) => {
          const ver = e.target.closest('[data-ver]');
          if (ver) { verMascota(ver.dataset.ver); return; }
          const b = e.target.closest('[data-accion]');
          if (!b) return;
          const s = lista.find((x) => x.id === Number(b.dataset.id));
          let ok = false;
          if (b.dataset.accion === 'aprobar') {
            ok = await dialogo({ titulo: 'Aprobar solicitud', texto: `Se notificará a ${s.adoptante} que su solicitud para ${s.animal} fue aprobada.`, confirmar: 'Aprobar', accion: () => api(`/refugio/solicitudes/${s.id}/aprobar`, { metodo: 'POST' }) });
          } else if (b.dataset.accion === 'rechazar') {
            ok = await dialogo({
              titulo: s.estado === 'aprobada' ? 'Cancelar aprobación' : 'Rechazar solicitud',
              texto: s.estado === 'aprobada' ? `La solicitud de ${s.adoptante} pasará a Rechazada y se cancelará su cita. Así podrás aprobar otra solicitud para ${s.animal}.` : '',
              confirmar: 'Rechazar', peligro: true,
              cuerpo: html`<label class="campo"><span class="campo__etiqueta">Motivo del rechazo</span><textarea class="campo__textarea" name="motivo" maxlength="300" placeholder="Explica brevemente el motivo (10 a 300 caracteres)"></textarea></label>`,
              accion: async (f) => {
                const m = f.motivo.value.trim();
                if (!m) fallo('Debe ingresar el motivo del rechazo.');
                if (!V.entre(m, 10, 300)) fallo('El motivo debe tener de 10 a 300 caracteres.');
                await api(`/refugio/solicitudes/${s.id}/rechazar`, { metodo: 'POST', datos: { motivo: m } });
              },
            });
          } else if (b.dataset.accion === 'nota') {
            ok = await dialogo({
              titulo: `Nota para ${s.adoptante}`,
              texto: 'Un aviso corto que el adoptante verá en su solicitud y recibirá como notificación (ej. "Trae a toda tu familia a la cita").',
              cuerpo: html`<label class="campo"><span class="campo__etiqueta">Nota</span><textarea class="campo__textarea" name="nota" maxlength="200" placeholder="De 5 a 200 caracteres. Déjala vacía para quitarla.">${s.nota_refugio || ''}</textarea></label>`,
              confirmar: 'Guardar nota',
              accion: async (f) => {
                const n = f.nota.value.trim().replace(/\s+/g, ' ');
                if (n && !V.entre(n, 5, 200)) fallo('La nota debe tener de 5 a 200 caracteres.');
                if (n && !V.letras(n, 3)) fallo('La nota debe incluir texto, no solo números o símbolos.');
                if (/(https?:\/\/|www\.)/i.test(n)) fallo('La nota no puede incluir enlaces.');
                if (sinAcentos(n).split(/[^a-z]+/).some((p) => GROSERIAS.has(p))) fallo('La nota contiene palabras no permitidas.');
                aviso((await api(`/refugio/solicitudes/${s.id}/nota`, { metodo: 'PUT', datos: { nota: n } })).mensaje);
              },
            });
            if (ok) { navegar(); return; }
          } else if (b.dataset.accion === 'cita') {
            ok = await agendarCita(s);
          } else if (b.dataset.accion === 'adopcion') {
            ok = await dialogo({
              titulo: `Marcar adopción de ${s.animal}`,
              texto: 'La publicación pasará a Adoptado, saldrá del catálogo y las demás solicitudes pendientes se cerrarán.',
              cuerpo: html`<label class="campo"><span class="campo__etiqueta">Fecha de concreción</span><input class="campo__entrada" type="date" name="fecha" min="${s.aprobada}" max="${hoyCDMX()}" value="${hoyCDMX()}"></label>`,
              confirmar: 'Confirmar adopción',
              accion: async (f) => {
                if (!f.fecha.value || f.fecha.value > hoyCDMX() || f.fecha.value < s.aprobada) fallo('La fecha de concreción debe estar entre la fecha de aprobación y hoy.');
                const r = await api(`/refugio/solicitudes/${s.id}/adopcion`, { metodo: 'POST', datos: { fecha: f.fecha.value } });
                aviso(r.mensaje);
              },
            });
          }
          if (ok) { if (b.dataset.accion !== 'adopcion') aviso('Listo.'); navegar(); }
        });
      },
    };
  }

  /* ---------- RF-11: perfil del Refugio ---------- */
  async function vistaRefugioPerfil() {
    const [cat, p] = await Promise.all([catalogos(), perfilRefugio(true)]);
    return {
      html: html`
      <section class="principal">
        <h1 class="titulo-pagina">Perfil del refugio</h1>
        ${subnavRefugio('#/refugio/perfil')}
        <section class="panel panel--ancho">
          <h2 class="panel__titulo">${p.nombre}</h2>
          <p class="cuenta__subtitulo">${p.institucion} · ${p.correo}</p>
          <form class="formulario formulario--dos" novalidate data-perfil>
            ${camposRefugio(cat, p, false)}
            <p class="mensaje mensaje--error campo--ancho" data-error role="alert"></p>
            <div class="panel__acciones campo--ancho acciones acciones--centro">
              <button class="boton-contorno boton-contorno--relleno" type="submit">Guardar cambios</button>
              <a class="boton-contorno" href="#/cuenta">Nombre y contraseña</a>
            </div>
          </form>
        </section>
      </section>`,
      montar(raiz) {
        const f = $('[data-perfil]', raiz);
        montarHorario(f);
        soloDigitos(f);
        montarDireccion(f);
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          let datos;
          try { datos = validarCamposRefugio(f, cat, false); } catch (err) { return errorEn(f, err.message); }
          const b = $('button[type="submit"]', f);
          ocupado(b);
          try {
            const r = await api('/refugio/perfil', { metodo: 'PUT', datos });
            estado.perfil = null;
            errorEn(f, '');
            aviso(r.mensaje);
          } catch (err) { errorEn(f, textoError(err)); } finally { ocupado(b, false); }
        });
      },
    };
  }

  /* ---------- RF-35: estadísticas propias ---------- */
  function vistaRefugioEstadisticas() {
    return {
      html: html`
      <section class="principal">
        <h1 class="titulo-pagina">Mis estadísticas</h1>
        ${subnavRefugio('#/refugio/estadisticas')}
        <section class="panel">${selectorPeriodo()}<div data-cifras></div></section>
      </section>`,
      montar(raiz) {
        const pintar = async (params) => {
          const r = await api(conQuery('/refugio/estadisticas', params));
          $('[data-cifras]', raiz).innerHTML = String(html`
            <div class="cifras">
              <article class="cifra cifra--azul"><span class="cifra__numero">${r.ingresos}</span><span class="cifra__texto">animales ingresaron</span></article>
              <article class="cifra cifra--durazno"><span class="cifra__numero">${r.adopciones}</span><span class="cifra__texto">adopciones concretadas</span></article>
            </div>
            <p class="nota">Periodo: ${r.inicio} a ${r.fin}</p>
            ${!r.ingresos && !r.adopciones ? html`<p class="mensaje">No hay animales ni adopciones en el periodo seleccionado.</p>` : ''}`);
        };
        montarPeriodo(raiz, pintar);
        pintar({ periodo: '7' }).catch(() => {});
      },
    };
  }

  /* ======================= 13. Vistas del Administrador ======================= */
  const SECCIONES_ADMIN = [['#/admin', 'Resumen'], ['#/admin/verificacion', 'Verificación'], ['#/admin/publicaciones', 'Publicaciones'], ['#/admin/reportes', 'Reportes'], ['#/admin/cuentas', 'Cuentas'], ['#/admin/catalogos', 'Catálogos'], ['#/admin/estadisticas', 'Estadísticas']];
  const marcoAdmin = (actual, titulo, contenido) => html`
    <section class="principal">
      <h1 class="titulo-pagina">${titulo}</h1>
      <nav class="pestanas" aria-label="Secciones de administración">
        ${SECCIONES_ADMIN.map(([h, t]) => html`<a class="pestana" href="${h}"${si(h === actual, 'aria-current="page"')}>${t}</a>`)}
      </nav>
      <div class="contenedor">${contenido}</div>
    </section>`;

  async function vistaAdmin() {
    const r = await api('/admin/resumen');
    return {
      html: marcoAdmin('#/admin', 'Panel de administración', html`
        ${r.erroresNotificacion.length ? html`
          <div class="mensaje mensaje--error">No se pudo notificar al usuario de la solicitud o del animal. (${r.erroresNotificacion.length})
            <button class="enlace" type="button" data-revisados>Marcar como revisado</button></div><br>` : ''}
        <div class="tablero">
          <a href="#/admin/verificacion"><article class="cifra cifra--durazno"><span class="cifra__numero">${r.refugiosPendientes}</span><span class="cifra__texto">refugios por verificar</span></article></a>
          <a href="#/admin/reportes"><article class="cifra cifra--azul"><span class="cifra__numero">${r.reportesAbiertos}</span><span class="cifra__texto">reportes abiertos</span></article></a>
          <a href="#/admin/estadisticas"><article class="cifra cifra--blanco"><span class="cifra__numero">CSV</span><span class="cifra__texto">estadísticas generales</span></article></a>
        </div>`),
      montar(raiz) {
        const b = $('[data-revisados]', raiz);
        if (b) b.addEventListener('click', async () => { await api('/admin/errores-notificacion/revisados', { metodo: 'POST' }).catch(() => {}); navegar(); });
      },
    };
  }

  /* RF-25 */
  async function vistaAdminVerificacion() {
    const lista = await api('/admin/refugios-pendientes');
    return {
      html: marcoAdmin('#/admin/verificacion', 'Verificar refugios', !lista.length
        ? html`<div class="vacio contenedor--estrecho contenedor">${seguro(SVG_HUELLA)}No hay refugios pendientes de verificación.</div>`
        : html`<ul class="filas contenedor contenedor--estrecho">${lista.map((x) => html`
          <li class="fila fila--sin-imagen">
            <div>
              <p class="fila__titulo">${x.nombre} ${x.plazo_vencido ? insignia('vencido', 'Plazo vencido') : ''}</p>
              <p class="fila__meta">${x.institucion} · ${x.correo}</p>
              <p class="fila__meta">Registro: ${String(x.creado).slice(0, 16)} · Aviso ${x.aviso_version} aceptado ${String(x.aviso_fecha).slice(0, 16)}</p>
              <p class="fila__detalle">${x.direccion}${x.alcaldia ? `, ${x.alcaldia}` : ''} · Tel. ${x.telefono}</p>
              <ul class="horario-lista">${x.horario.map((h) => html`<li><span>${DIAS[h.dia]}</span><span>${Number(h.cerrado) ? 'Cerrado' : `${h.abre}–${h.cierra}`}</span></li>`)}</ul>
            </div>
            <div class="fila__lado acciones">
              <button class="boton-contorno boton-contorno--chico boton-contorno--relleno" type="button" data-aceptar="${x.id}">Aceptar</button>
              <button class="boton-contorno boton-contorno--chico boton-contorno--peligro" type="button" data-rechazar="${x.id}">Rechazar</button>
            </div>
          </li>`)}</ul>`),
      montar(raiz) {
        raiz.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-aceptar], [data-rechazar]');
          if (!b) return;
          const aceptar = !!b.dataset.aceptar;
          const id = b.dataset.aceptar || b.dataset.rechazar;
          const x = lista.find((r) => r.id === Number(id));
          const ok = await dialogo({
            titulo: aceptar ? 'Aceptar refugio' : 'Rechazar refugio',
            texto: aceptar ? `${x.nombre} podrá iniciar sesión y publicar animales.` : `${x.nombre} verá la pantalla de verificación rechazada y podrá reenviar sus datos.`,
            confirmar: aceptar ? 'Aceptar' : 'Rechazar', peligro: !aceptar,
            accion: () => api(`/admin/refugios/${id}/${aceptar ? 'aceptar' : 'rechazar'}`, { metodo: 'POST' }),
          });
          if (ok) { aviso(aceptar ? 'Cuenta verificada.' : 'Cuenta rechazada.'); navegar(); }
        });
      },
    };
  }

  /* RF-26 / RF-27 */
  async function vistaAdminPublicaciones(ctx) {
    const pagina = idValido(ctx.query.get('pagina')) || 1;
    const r = await api(`/admin/publicaciones?pagina=${pagina}`);
    return {
      html: marcoAdmin('#/admin/publicaciones', 'Publicaciones', !r.publicaciones.length
        ? html`<div class="vacio">No hay publicaciones registradas.</div>`
        : html`
          <table class="tabla">
            <thead><tr><th>Publicada</th><th>Animal</th><th>Raza</th><th>Refugio</th><th>Estado</th><th></th></tr></thead>
            <tbody>${r.publicaciones.map((p) => html`
              <tr>
                <td data-col="Publicada">${p.publicado}</td>
                <td data-col="Animal"><strong>${p.nombre}</strong></td>
                <td data-col="Raza">${nombreRaza(p)}</td>
                <td data-col="Refugio">${p.refugio}</td>
                <td>${insignia(p.estado, ETQ[p.estado])}</td>
                <td><div class="acciones">${p.estado === 'disponible' ? html`<a class="boton-contorno boton-contorno--chico" href="#/animal/${p.id}">Ver</a>` : ''}
                  <button class="boton-contorno boton-contorno--chico boton-contorno--peligro" type="button" data-eliminar="${p.id}">Eliminar</button></div></td>
              </tr>`)}</tbody>
          </table>
          ${paginacion(r.pagina, r.total, r.porPagina)}`),
      montar(raiz) {
        $$('[data-pagina]', raiz).forEach((b) => b.addEventListener('click', () => { location.hash = `#/admin/publicaciones?pagina=${b.dataset.pagina}`; }));
        $$('[data-eliminar]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const p = r.publicaciones.find((x) => x.id === Number(b.dataset.eliminar));
          const ok = await dialogo({
            titulo: `Eliminar publicación de ${p.nombre}`, confirmar: 'Eliminar', peligro: true,
            texto: 'Se retirará del catálogo y se notificará al refugio.',
            cuerpo: html`
              <label class="campo"><span class="campo__etiqueta">Motivo</span><select class="campo__entrada" name="motivo"><option value="">Selecciona un motivo</option>${MOTIVOS.map((m) => html`<option>${m}</option>`)}</select></label>
              <label class="campo" data-otro hidden><span class="campo__etiqueta">Descripción</span><textarea class="campo__textarea" name="descripcion" maxlength="300" placeholder="10 a 300 caracteres"></textarea></label>`,
            montar: (d) => $('[name="motivo"]', d).addEventListener('change', (e) => { $('[data-otro]', d).hidden = e.target.value !== 'Otro'; }),
            accion: async (f) => {
              if (!MOTIVOS.includes(f.motivo.value)) fallo('Seleccione un motivo.');
              if (f.motivo.value === 'Otro' && !V.entre(f.descripcion.value.trim(), 10, 300)) fallo('La descripción debe tener de 10 a 300 caracteres.');
              await api(`/admin/publicaciones/${p.id}/eliminar`, { metodo: 'POST', datos: { motivo: f.motivo.value, descripcion: f.descripcion.value.trim() } });
            },
          });
          if (ok) { aviso('Publicación eliminada.'); navegar(); }
        }));
      },
    };
  }

  /* RF-34 */
  async function vistaAdminReportes(ctx) {
    const filtro = ['abierto', 'resuelto', 'descartado'].includes(ctx.query.get('estado')) ? ctx.query.get('estado') : 'abierto';
    const pagina = idValido(ctx.query.get('pagina')) || 1;
    const r = await api(`/admin/reportes?estado=${filtro}&pagina=${pagina}`);
    return {
      html: marcoAdmin('#/admin/reportes', 'Reportes de usuarios', html`
        <div class="pestanas">${['abierto', 'resuelto', 'descartado'].map((e) => html`<a class="pestana" href="#/admin/reportes?estado=${e}"${si(e === filtro, 'aria-current="page"')}>${ETQ[e]}s</a>`)}</div>
        ${!r.reportes.length ? html`<div class="vacio contenedor contenedor--estrecho">No hay reportes con este estado.</div>` : html`
        <ul class="filas contenedor contenedor--estrecho">${r.reportes.map((x) => html`
          <li class="fila fila--sin-imagen">
            <div>
              <p class="fila__titulo">${x.motivo} · ${x.objetivo_tipo === 'animal' ? 'Publicación' : 'Refugio'}: ${x.objetivo || 'ya no existe'}</p>
              <p class="fila__meta">${x.adoptante} · ${x.adoptante_correo} · ${x.creado}</p>
              <p class="fila__detalle">${x.descripcion}</p>
              ${x.nota ? html`<p class="fila__detalle"><strong>Nota:</strong> ${x.nota}</p>` : ''}
            </div>
            <div class="fila__lado">${insignia(x.estado, ETQ[x.estado])}
              ${x.estado === 'abierto' ? html`<div class="acciones">
                ${x.objetivo_tipo === 'animal' ? html`<a class="boton-contorno boton-contorno--chico" href="#/animal/${x.objetivo_id}">Ver</a>` : ''}
                <button class="boton-contorno boton-contorno--chico boton-contorno--relleno" type="button" data-cerrar="resolver" data-id="${x.id}">Resolver</button>
                <button class="boton-contorno boton-contorno--chico" type="button" data-cerrar="descartar" data-id="${x.id}">Descartar</button></div>` : ''}
            </div>
          </li>`)}</ul>
        ${paginacion(r.pagina, r.total, r.porPagina)}`}`),
      montar(raiz) {
        $$('[data-pagina]', raiz).forEach((b) => b.addEventListener('click', () => { location.hash = `#/admin/reportes?estado=${filtro}&pagina=${b.dataset.pagina}`; }));
        $$('[data-cerrar]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const accion = b.dataset.cerrar === 'resolver' ? 'resolver' : 'descartar';
          const ok = await dialogo({
            titulo: accion === 'resolver' ? 'Resolver reporte' : 'Descartar reporte', confirmar: accion === 'resolver' ? 'Resolver' : 'Descartar',
            texto: 'El adoptante recibirá una notificación con tu nota.',
            cuerpo: html`<label class="campo"><span class="campo__etiqueta">Nota</span><textarea class="campo__textarea" name="nota" maxlength="300" placeholder="10 a 300 caracteres"></textarea></label>`,
            accion: async (f) => {
              if (!V.entre(f.nota.value.trim(), 10, 300)) fallo('La nota debe tener de 10 a 300 caracteres.');
              await api(`/admin/reportes/${b.dataset.id}/${accion}`, { metodo: 'POST', datos: { nota: f.nota.value.trim() } });
            },
          });
          if (ok) { aviso('Reporte actualizado.'); navegar(); }
        }));
      },
    };
  }

  /* RF-28 / RF-32 */
  async function vistaAdminCuentas(ctx) {
    const q = (ctx.query.get('q') || '').slice(0, 60);
    const tipo = ['adoptante', 'refugio', 'admin'].includes(ctx.query.get('tipo')) ? ctx.query.get('tipo') : '';
    const pagina = idValido(ctx.query.get('pagina')) || 1;
    const r = await api(conQuery('/admin/cuentas', { q, tipo, pagina }));
    return {
      html: marcoAdmin('#/admin/cuentas', 'Cuentas', html`
        <form class="busqueda-admin" data-buscar>
          <input class="campo__entrada" name="q" type="search" placeholder="Buscar por nombre o correo" value="${q}" maxlength="60">
          <select class="campo__entrada" name="tipo"><option value="">Todos los tipos</option>${['adoptante', 'refugio', 'admin'].map((t) => html`<option value="${t}"${si(t === tipo, 'selected')}>${ETQ[t]}</option>`)}</select>
          <button class="boton-contorno boton-contorno--chico" type="submit">Buscar</button>
        </form>
        ${!r.cuentas.length ? html`<div class="vacio">No se encontraron cuentas.</div>` : html`
        <table class="tabla">
          <thead><tr><th>Nombre</th><th>Correo</th><th>Tipo</th><th>Estado</th><th>Alta</th><th></th></tr></thead>
          <tbody>${r.cuentas.map((c) => html`
            <tr>
              <td data-col="Nombre"><strong>${c.nombre}</strong></td>
              <td data-col="Correo">${c.correo}</td>
              <td data-col="Tipo">${ETQ[c.tipo]}</td>
              <td>${insignia(c.estado, ETQ[c.estado] || c.estado)}</td>
              <td data-col="Alta">${c.creado}</td>
              <td><div class="acciones">
                ${c.tipo === 'adoptante' && c.estado === 'activa' ? html`<button class="boton-contorno boton-contorno--chico" type="button" data-hacer-admin="${c.id}">Hacer admin</button>` : ''}
                ${c.tipo !== 'admin' && c.estado !== 'eliminada' ? html`<button class="boton-contorno boton-contorno--chico boton-contorno--peligro" type="button" data-eliminar="${c.id}">Eliminar</button>` : ''}
              </div></td>
            </tr>`)}</tbody>
        </table>
        ${paginacion(r.pagina, r.total, r.porPagina)}`}`),
      montar(raiz) {
        const f = $('[data-buscar]', raiz);
        f.addEventListener('submit', (e) => { e.preventDefault(); location.hash = conQuery('#/admin/cuentas', { q: f.q.value.trim(), tipo: f.tipo.value }); });
        $$('[data-pagina]', raiz).forEach((b) => b.addEventListener('click', () => { location.hash = conQuery('#/admin/cuentas', { q, tipo, pagina: b.dataset.pagina }); }));
        $$('[data-hacer-admin]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const c = r.cuentas.find((x) => x.id === Number(b.dataset.hacerAdmin));
          const ok = await dialogo({ titulo: 'Asignar rol de Administrador', texto: `${c.nombre} tendrá acceso al panel de administración en su siguiente inicio de sesión y dejará de tener funciones de adoptante.`, confirmar: 'Asignar', accion: () => api(`/admin/cuentas/${c.id}/admin`, { metodo: 'POST' }) });
          if (ok) { aviso('Rol de Administrador asignado.'); navegar(); }
        }));
        $$('[data-eliminar]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const c = r.cuentas.find((x) => x.id === Number(b.dataset.eliminar));
          const ok = await dialogo({
            titulo: `Eliminar la cuenta de ${c.nombre}`, confirmar: 'Eliminar cuenta', peligro: true,
            cuerpo: html`<label class="campo"><span class="campo__etiqueta">Motivo</span><textarea class="campo__textarea" name="motivo" maxlength="300" placeholder="10 a 300 caracteres"></textarea></label>`,
            accion: async (f) => {
              if (!V.entre(f.motivo.value.trim(), 10, 300)) fallo('El motivo debe tener de 10 a 300 caracteres.');
              await api(`/admin/cuentas/${c.id}/eliminar`, { metodo: 'POST', datos: { motivo: f.motivo.value.trim() } });
            },
          });
          if (ok) { aviso('Cuenta eliminada.'); navegar(); }
        }));
      },
    };
  }

  /* RF-29 a RF-31 */
  async function vistaAdminCatalogos() {
    const cat = await catalogos(true);
    const NOMBRES = { tamano: 'Tamaños', edad: 'Rangos de edad', tipo_requisito: 'Tipos de requisito', vacuna: 'Vacunas', documento: 'Documentos requeridos' };
    return {
      html: marcoAdmin('#/admin/catalogos', 'Catálogos', html`
        <div class="catalogos">${Object.entries(NOMBRES).map(([k, t]) => html`
          <section class="panel">
            <h2 class="panel__titulo">${t}</h2>
            ${cat[k].map((v) => html`
              <div class="valor ${v.activo ? '' : 'valor--inactivo'}">
                <span>${v.nombre}</span>
                <span class="acciones">
                  <button class="enlace" type="button" data-renombrar="${v.id}" data-nombre="${v.nombre}">Renombrar</button>
                  <button class="enlace" type="button" data-${v.activo ? 'desactivar' : 'activar'}="${v.id}">${v.activo ? 'Desactivar' : 'Activar'}</button>
                </span>
              </div>`)}
            <form class="agregar" data-agregar="${k}"><input class="campo__entrada" name="nombre" maxlength="50" placeholder="Nuevo valor" aria-label="Nuevo valor de ${t}"><button class="boton-contorno boton-contorno--chico" type="submit">Agregar</button></form>
          </section>`)}
        </div>`),
      montar(raiz) {
        const hecho = (m) => { aviso(m); estado.catalogos = null; navegar(); };
        $$('[data-agregar]', raiz).forEach((f) => f.addEventListener('submit', async (e) => {
          e.preventDefault();
          const n = f.nombre.value.trim();
          if (!V.entre(n, 1, 50)) return aviso('El nombre del valor debe tener de 1 a 50 caracteres.', 'error');
          try { const r = await api('/admin/catalogos', { metodo: 'POST', datos: { catalogo: f.dataset.agregar, nombre: n } }); hecho(r.mensaje); } catch (err) { aviso(textoError(err), 'error'); }
        }));
        $$('[data-renombrar]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const ok = await dialogo({
            titulo: 'Renombrar valor', confirmar: 'Guardar',
            cuerpo: html`<label class="campo"><span class="campo__etiqueta">Nuevo nombre</span><input class="campo__entrada" name="nombre" maxlength="50" value="${b.dataset.nombre}"></label>`,
            accion: async (f) => {
              if (!V.entre(f.nombre.value.trim(), 1, 50)) fallo('El nombre del valor debe tener de 1 a 50 caracteres.');
              await api(`/admin/catalogos/${b.dataset.renombrar}`, { metodo: 'PUT', datos: { nombre: f.nombre.value.trim() } });
            },
          });
          if (ok) hecho('Valor renombrado.');
        }));
        $$('[data-desactivar], [data-activar]', raiz).forEach((b) => b.addEventListener('click', async () => {
          const des = !!b.dataset.desactivar;
          const ok = await dialogo({
            titulo: des ? 'Desactivar valor' : 'Activar valor', texto: des ? 'Dejará de aparecer en las nuevas selecciones. Las publicaciones existentes lo conservan.' : 'Volverá a aparecer en las listas de selección.',
            accion: () => api(`/admin/catalogos/${b.dataset.desactivar || b.dataset.activar}/${des ? 'desactivar' : 'activar'}`, { metodo: 'POST' }),
          });
          if (ok) hecho(des ? 'Valor desactivado.' : 'Valor activado.');
        }));
      },
    };
  }

  /* RF-36 / RF-37 */
  function vistaAdminEstadisticas() {
    return {
      html: marcoAdmin('#/admin/estadisticas', 'Estadísticas generales', html`
        <section class="panel">${selectorPeriodo()}<div data-cifras></div>
          <div class="panel__acciones"><button class="boton-contorno boton-contorno--relleno" type="button" data-csv disabled>Exportar CSV</button></div>
          <p class="mensaje mensaje--error" data-error-csv role="alert"></p>
        </section>`),
      montar(raiz) {
        let ultimos = null;
        const btn = $('[data-csv]', raiz);
        montarPeriodo(raiz, async (params) => {
          const r = await api(conQuery('/admin/estadisticas', params));
          ultimos = params;
          btn.disabled = false;
          $('[data-cifras]', raiz).innerHTML = String(html`
            <div class="cifras">
              <article class="cifra cifra--azul"><span class="cifra__numero">${r.animales_publicados}</span><span class="cifra__texto">animales publicados</span></article>
              <article class="cifra cifra--durazno"><span class="cifra__numero">${r.adopciones_concretadas}</span><span class="cifra__texto">adopciones concretadas</span></article>
              <article class="cifra cifra--blanco"><span class="cifra__numero">${r.refugios_activos}</span><span class="cifra__texto">refugios activos</span></article>
            </div>
            <p class="nota">Periodo: ${r.inicio} a ${r.fin}</p>`);
        });
        btn.addEventListener('click', async () => {
          if (!ultimos) return;
          const err = $('[data-error-csv]', raiz);
          err.textContent = '';
          ocupado(btn);
          try {
            const res = await fetch(conQuery('/api/admin/estadisticas.csv', ultimos), { credentials: 'same-origin', headers: { 'X-Dopta': '1' } });
            if (!res.ok) throw new Error();
            const blob = await res.blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `estadisticas_dopta_${hoyCDMX()}.csv`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
          } catch { err.textContent = 'No se pudo generar el archivo. Intente de nuevo.'; } finally { ocupado(btn, false); }
        });
      },
    };
  }

  /* ======================= 14. Rutas y navegación ======================= */
  const RUTAS = [];
  const ruta = (patron, vista, acceso = null, titulo = '') => RUTAS.push({
    re: new RegExp(`^${patron.replace(/:(\w+)/g, '(?<$1>\\d{1,10})')}$`), vista, acceso, titulo,
  });
  const TODOS = ['adoptante', 'refugio', 'admin'];
  ruta('/', vistaCatalogo, null, 'Catálogo');
  ruta('/animal/:id', vistaAnimal, null, 'Ficha');
  ruta('/cuestionario', vistaCuestionario, null, 'Cuestionario');
  ruta('/nosotros', vistaNosotros, null, 'Sobre nosotros');
  ruta('/refugios', vistaRefugios, null, 'Refugios');
  ruta('/refugios/:id', vistaPerfilRefugio, null, 'Refugio');
  ruta('/login', vistaLogin, 'invitado', 'Iniciar sesión');
  ruta('/registro', vistaRegistro, 'invitado', 'Registro');
  ruta('/recuperar', vistaRecuperar, 'invitado', 'Recuperar contraseña');
  ruta('/restablecer', vistaRestablecer, 'invitado', 'Nueva contraseña');
  ruta('/verificacion-rechazada', vistaRechazada, 'invitado', 'Verificación rechazada');
  ruta('/solicitudes', vistaMisSolicitudes, ['adoptante'], 'Mis solicitudes');
  ruta('/notificaciones', vistaNotificaciones, TODOS, 'Notificaciones');
  ruta('/cuenta', vistaCuenta, TODOS, 'Mi cuenta');
  ruta('/refugio', vistaRefugio, ['refugio'], 'Mis animales');
  ruta('/refugio/animal/nuevo', vistaFormAnimal, ['refugio'], 'Publicar');
  ruta('/refugio/animal/:id', vistaFormAnimal, ['refugio'], 'Editar');
  ruta('/refugio/solicitudes', vistaRefugioSolicitudes, ['refugio'], 'Solicitudes');
  ruta('/refugio/perfil', vistaRefugioPerfil, ['refugio'], 'Perfil');
  ruta('/refugio/estadisticas', vistaRefugioEstadisticas, ['refugio'], 'Estadísticas');
  ruta('/admin', vistaAdmin, ['admin'], 'Administración');
  ruta('/admin/verificacion', vistaAdminVerificacion, ['admin'], 'Verificación');
  ruta('/admin/publicaciones', vistaAdminPublicaciones, ['admin'], 'Publicaciones');
  ruta('/admin/reportes', vistaAdminReportes, ['admin'], 'Reportes');
  ruta('/admin/cuentas', vistaAdminCuentas, ['admin'], 'Cuentas');
  ruta('/admin/catalogos', vistaAdminCatalogos, ['admin'], 'Catálogos');
  ruta('/admin/estadisticas', vistaAdminEstadisticas, ['admin'], 'Estadísticas');
  ruta('/404', vista404, null, 'No encontrada');
  ruta('/500', vista500, null, 'Error');
  const R404 = { vista: vista404, acceso: null, titulo: 'No encontrada' };

  function resolver() {
    const h = location.hash || '#/';
    if (!h.startsWith('#/')) { history.replaceState(null, '', '#/'); return resolver(); }
    const [p, qs = ''] = h.slice(1).split('?');
    const camino = p.replace(/\/+$/, '') || '/';
    for (const r of RUTAS) {
      const m = camino.match(r.re);
      if (m) return { r, params: m.groups || {}, query: new URLSearchParams(qs), camino, hash: h };
    }
    return { r: R404, params: {}, query: new URLSearchParams(), camino, hash: h };
  }

  function rutaPermitida(destino, usuario) {
    const camino = destino.slice(1).split('?')[0].replace(/\/+$/, '') || '/';
    const r = RUTAS.find((x) => x.re.test(camino));
    if (!r) return false;
    if (r.acceso === 'invitado') return !usuario;
    if (Array.isArray(r.acceso)) return !!usuario && r.acceso.includes(usuario.tipo);
    return true;
  }

  let generacion = 0;
  let caminoAnterior = null;
  async function navegar() {
    const g = ++generacion;
    const m = resolver();
    const u = estado.usuario;
    // Guardas de acceso: redirigen según la sesión y el rol
    if (m.r.acceso === 'invitado' && u) { location.replace(estado.panel); return; }
    if (Array.isArray(m.r.acceso)) {
      if (!u) {
        estado.flash = estado.flash || { tipo: 'info', texto: 'Inicie sesión para continuar.' };
        location.replace(`#/login?next=${encodeURIComponent(m.hash)}`);
        return;
      }
      if (!m.r.acceso.includes(u.tipo)) { aviso('No tiene permiso para ver esa página.', 'error'); location.replace(estado.panel); return; }
    }
    pintarNav(m.camino);
    document.title = `${m.r.titulo ? `${m.r.titulo} · ` : ''}Dopta`;
    let res;
    try {
      res = await m.r.vista(m);
    } catch (e) {
      if (g !== generacion) return;
      if (e instanceof ErrorApi && e.status === 401) return;
      if (e instanceof ErrorApi && e.status === 403) { aviso(e.message || 'No tiene permiso para ver esa página.', 'error'); location.replace(estado.panel); return; }
      console.error(e);
      if (e instanceof ErrorApi && e.datos && e.datos.codigo === 'BD') res = vista500(e.message, 'BASE DE DATOS NO DISPONIBLE');
      else if (e instanceof ErrorApi && e.status === 404) res = vista404();
      else if (e instanceof ErrorApi && e.status === 0) res = vista500('No hay conexión con el servidor. Revisa que esté encendido (npm start) y vuelve a intentar.', 'SIN CONEXIÓN');
      else if (e instanceof ErrorApi) res = vista500(e.message || undefined);
      else res = vista500('La página encontró un problema. Recarga con Ctrl + F5; si sigue, abre la consola (F12) y comparte el mensaje en rojo.', 'ERROR EN LA PÁGINA');
    }
    if (g !== generacion || res === '') return;
    const vistaHtml = res instanceof Seguro ? res : res.html;
    // Contenedor nuevo en cada vista: así no se acumulan escuchadores de vistas anteriores
    const limpio = app.cloneNode(false);
    app.replaceWith(limpio);
    app = limpio;
    app.innerHTML = String(vistaHtml);
    if (m.camino !== caminoAnterior) window.scrollTo({ top: 0 });
    caminoAnterior = m.camino;
    const r = $('[data-reintentar]', app);
    if (r) r.addEventListener('click', navegar);
    if (res && res.montar) res.montar(app);
    montarOjitos(app);
  }

  /* Botón "ojito" para mostrar u ocultar cualquier contraseña */
  function montarOjitos(raiz) {
    $$('input[type="password"]', raiz).forEach((inp) => {
      if (inp.closest('.clave')) return;
      const caja = document.createElement('span');
      caja.className = 'clave';
      inp.replaceWith(caja);
      caja.append(inp);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'clave__ojo';
      b.setAttribute('aria-label', 'Mostrar contraseña');
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = String(ICONO.ojo);
      b.addEventListener('click', () => {
        const ver = inp.type === 'password';
        inp.type = ver ? 'text' : 'password';
        b.setAttribute('aria-pressed', String(ver));
        b.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
        b.innerHTML = String(ver ? ICONO.ojoCerrado : ICONO.ojo);
        inp.focus();
      });
      caja.append(b);
    });
  }

  /* Barra de navegación según el rol */
  function pintarNav(camino) {
    const nav = $('#nav');
    const u = estado.usuario;
    const actual = (h) => si(`#${camino}` === h || (h !== '#/' && `#${camino}`.startsWith(`${h}/`)), 'aria-current="page"');
    const campana = html`<a class="boton-pastilla boton-pastilla--icono campana" href="#/notificaciones" aria-label="Notificaciones${estado.noLeidas ? `: ${estado.noLeidas} sin leer` : ''}"${actual('#/notificaciones')}>${ICONO.campana}${estado.noLeidas ? html`<span class="campana__numero">${estado.noLeidas > 99 ? '99+' : estado.noLeidas}</span>` : ''}</a>`;
    const salir = html`<button class="boton-pastilla" type="button" data-salir>Cerrar sesión</button>`;
    let enlaces;
    if (!u) {
      enlaces = html`
        <a class="boton-pastilla" href="#/" aria-label="Inicio"${actual('#/')}>${ICONO.casa}</a>
        <a class="boton-pastilla" href="#/refugios"${actual('#/refugios')}>Refugios</a>
        <a class="boton-pastilla" href="#/nosotros"${actual('#/nosotros')}>Sobre nosotros</a>
        <a class="boton-pastilla" href="#/registro"${actual('#/registro')}>Registrarse</a>
        <a class="boton-pastilla" href="#/login"${actual('#/login')}>Iniciar sesión</a>`;
    } else if (u.tipo === 'adoptante') {
      enlaces = html`
        <a class="boton-pastilla" href="#/" aria-label="Catálogo"${actual('#/')}>${ICONO.casa}</a>
        <a class="boton-pastilla" href="#/refugios"${actual('#/refugios')}>Refugios</a>
        <a class="boton-pastilla" href="#/solicitudes"${actual('#/solicitudes')}>Mis solicitudes</a>
        <a class="boton-pastilla" href="#/cuenta"${actual('#/cuenta')}>Mi cuenta</a>
        ${campana}${salir}`;
    } else if (u.tipo === 'refugio') {
      enlaces = html`
        <a class="boton-pastilla" href="#/refugio"${si(camino === '/refugio' || camino.startsWith('/refugio/'), 'aria-current="page"')}>Mi refugio</a>
        <a class="boton-pastilla" href="#/" aria-label="Catálogo público"${actual('#/')}>${ICONO.casa}</a>
        <a class="boton-pastilla" href="#/cuenta"${actual('#/cuenta')}>Mi cuenta</a>
        ${campana}${salir}`;
    } else {
      enlaces = html`
        <a class="boton-pastilla" href="#/admin"${si(camino.startsWith('/admin'), 'aria-current="page"')}>Administración</a>
        <a class="boton-pastilla" href="#/" aria-label="Catálogo público"${actual('#/')}>${ICONO.casa}</a>
        <a class="boton-pastilla" href="#/cuenta"${actual('#/cuenta')}>Mi cuenta</a>
        ${salir}`;
    }
    nav.innerHTML = String(enlaces);
    $('[data-logo]').setAttribute('href', estado.panel);
    const b = $('[data-salir]', nav);
    if (b) b.addEventListener('click', cerrarSesion);
  }

  /* ======================= 15. Sesión e inactividad (RF-06) ======================= */
  async function actualizarYo(auto = false) {
    try {
      const r = await api('/auth/yo', { auto });
      if (!r.usuario && estado.usuario) { sesionTerminada(r.expirada ? 'Su sesión terminó por inactividad. Inicie sesión de nuevo.' : 'Inicie sesión de nuevo.'); return; }
      const cambio = (r.noLeidas || 0) !== estado.noLeidas;
      estado.usuario = r.usuario;
      estado.panel = r.panel || '#/';
      estado.noLeidas = r.noLeidas || 0;
      if (r.expirada) estado.flash = { tipo: 'info', texto: 'Su sesión terminó por inactividad. Inicie sesión de nuevo.' };
      if (cambio) pintarNav(resolver().camino);
    } catch { /* sin conexión: se reintenta en el siguiente ciclo */ }
  }

  function limpiarSesionLocal() {
    estado.usuario = null;
    estado.panel = '#/';
    estado.noLeidas = 0;
    estado.perfil = null;
  }
  function sesionTerminada(mensaje) {
    limpiarSesionLocal();
    estado.flash = { tipo: 'info', texto: mensaje || 'Su sesión terminó por inactividad. Inicie sesión de nuevo.' };
    if (location.hash.startsWith('#/login')) navegar(); else location.hash = '#/login';
  }
  async function cerrarSesion() {
    try { await api('/auth/logout', { metodo: 'POST' }); } catch { /* se limpia igual */ }
    limpiarSesionLocal();
    aviso('Sesión cerrada.');
    if ((location.hash || '#/') === '#/') navegar(); else location.hash = '#/';
  }

  const INACTIVIDAD = 30 * 60 * 1000;
  let ultimaInteraccion = Date.now();
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) => window.addEventListener(ev, () => { ultimaInteraccion = Date.now(); }, { passive: true }));
  function vigilarInactividad() {
    setInterval(async () => {
      if (!estado.usuario) return;
      const t = Date.now();
      if (t - ultimaInteraccion >= INACTIVIDAD) {
        await api('/auth/logout', { metodo: 'POST' }).catch(() => {});
        sesionTerminada('Su sesión terminó por inactividad. Inicie sesión de nuevo.');
        return;
      }
      // Si el usuario sigue activo pero no ha hecho peticiones, se mantiene viva la sesión en el servidor
      if (t - ultimaInteraccion < 5 * 60 * 1000 && t - ultimaServidor > 5 * 60 * 1000) actualizarYo(false);
    }, 30000);
    setInterval(() => { if (estado.usuario && !document.hidden) actualizarYo(true); }, 60000);
  }

  /* ======================= 16. Efectos visuales ======================= */
  function actualizarBotonTema() {
    const boton = $('[data-tema-boton]');
    if (!boton) return;
    const oscuro = raizDoc.getAttribute('data-theme') === 'oscuro';
    const t = oscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    boton.setAttribute('aria-label', t);
    boton.setAttribute('title', t);
    boton.setAttribute('aria-pressed', String(oscuro));
  }
  function montarTema() {
    const boton = $('[data-tema-boton]');
    if (!boton) return;
    boton.addEventListener('click', () => {
      const sig = raizDoc.getAttribute('data-theme') === 'oscuro' ? 'claro' : 'oscuro';
      aplicarTema(sig);
      guardarLS(CLAVE_TEMA, sig);
      actualizarBotonTema();
      const sel = $('[data-tema]');
      if (sel) sel.value = sig;
    });
    actualizarBotonTema();
  }

  const reducirMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* Pantalla de carga inicial */
  function pantallaCarga() {
    if (reducirMovimiento) return () => {};
    const inicio = performance.now();
    const p = document.createElement('div');
    p.className = 'cargando';
    p.setAttribute('role', 'status');
    p.innerHTML = '<img src="img/cargando.svg" alt="Cargando la página"><p>CARGANDO...</p>';
    document.body.appendChild(p);
    return () => setTimeout(() => { p.classList.add('cargando--oculto'); setTimeout(() => p.remove(), 500); }, Math.max(0, 900 - (performance.now() - inicio)));
  }

  /* Rebote tipo croqueta al llegar con fuerza al fondo del catálogo */
  function croquetas() {
    if (reducirMovimiento) return;
    const ZONA = 100;
    const RUEDA = 100;
    let acumulado = 0;
    let relojRueda;
    let reloj;
    let ultimaY = window.scrollY;
    const azar = (a, b) => a + Math.random() * (b - a);
    const enFondo = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - ZONA;
    const golpear = () => {
      if (!$('.catalogo', app) || !$('.croquetas', app) || document.body.classList.contains('impacto')) return;
      acumulado = 0;
      $$('.croqueta-pieza', app).forEach((h) => {
        const lado = Math.random() < 0.5 ? -1 : 1;
        h.style.setProperty('--x', `${(lado * azar(40, 240)).toFixed(0)}px`);
        h.style.setProperty('--y', `${-azar(90, 320).toFixed(0)}px`);
        h.style.setProperty('--r', `${azar(-200, 200).toFixed(0)}deg`);
        h.style.setProperty('--d', `${azar(0.9, 1.5).toFixed(2)}s`);
        h.style.setProperty('--retraso', `${azar(0, 180).toFixed(0)}ms`);
      });
      document.body.classList.add('impacto');
      clearTimeout(reloj);
      reloj = setTimeout(() => document.body.classList.remove('impacto'), 1800);
    };
    window.addEventListener('scroll', () => {
      const d = window.scrollY - ultimaY;
      ultimaY = window.scrollY;
      if (d > 0 && enFondo()) golpear();
    }, { passive: true });
    window.addEventListener('wheel', (e) => {
      if (e.deltaY <= 0 || !enFondo()) return;
      acumulado += e.deltaY;
      clearTimeout(relojRueda);
      relojRueda = setTimeout(() => { acumulado = 0; }, 250);
      if (acumulado >= RUEDA) golpear();
    }, { passive: true });
  }

  /* ======================= 17. Inicio ======================= */
  document.addEventListener('DOMContentLoaded', async () => {
    app = $('#app');
    const ocultarCarga = pantallaCarga();
    montarTema();
    croquetas();
    await actualizarYo(true);
    window.addEventListener('hashchange', navegar);
    await navegar();
    ocultarCarga();
    vigilarInactividad();
  });
})();
