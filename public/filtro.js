/* Filtro de texto compartido por el navegador (window.Filtro) y el servidor (require('../public/filtro.js')).
   Detecta groserías (también disfrazadas: "p3nd3j0", "puuuto", "p.u.t.o" o con una letra cambiada),
   texto sin sentido ("ñljkñksñldkasd", "asdasdasd") y mensajes rellenados con espacios o saltos de línea.
   Las mismas reglas se aplican en ambos lados: el navegador avisa antes de enviar y el servidor decide. */
(function (raiz, crear) {
  if (typeof module === 'object' && module.exports) module.exports = crear();
  else raiz.Filtro = crear();
}(typeof self !== 'undefined' ? self : this, () => {
  const GROSERIAS = ['puta', 'puto', 'pendejo', 'pendeja', 'verga', 'chinga', 'chingada', 'chingado', 'chingar', 'chingon', 'culero', 'culera',
    'culo', 'mierda', 'cabron', 'cabrona', 'mamada', 'mamon', 'mamona', 'joto', 'zorra', 'estupido', 'estupida', 'idiota', 'imbecil', 'pinche',
    'marica', 'maricon', 'ojete', 'nazi', 'hitler', 'naco', 'naca', 'pito', 'panocha', 'coger', 'cogida', 'malparido', 'hijueputa',
    'putita', 'putazo', 'pendejada', 'culiao', 'gilipollas', 'cojones', 'polla', 'retrasado', 'mongol', 'subnormal', 'puñetas', 'chupamela',
    'mamaguevo', 'huevon', 'guey', 'wey', 'buey', 'sexo', 'porno', 'xxx', 'fuck', 'shit', 'bitch', 'dick', 'asshole', 'cum', 'nigga', 'nigger'];
  // Estas solo se bloquean como palabra completa, nunca por parecido ("perra" no está: en Dopta es una perrita)
  const SOLO_EXACTAS = new Set(['buey', 'guey', 'wey', 'naco', 'naca', 'pito', 'sexo', 'culo', 'cum', 'polla', 'mongol', 'coger', 'mamon', 'joto']);
  // Palabras comunes que se parecen (a una letra) a una grosería y NO deben bloquearse
  const PERMITIDAS = new Set(['cuero', 'cueros', 'pincho', 'pinchar', 'pincha', 'pinchas', 'pinchen', 'maria', 'marina', 'marcia', 'mariana', 'carbon',
    'marcha', 'mamado', 'mamadera', 'chingo', 'pato', 'idiotez', 'cabrio', 'cabra', 'cabras', 'polo', 'pollo', 'pollas', 'pita', 'pinta',
    'culto', 'culpa', 'curo', 'cumple', 'nacer', 'nazareno', 'coser', 'cogido', 'escoger', 'recoger', 'acoger', 'zorro', 'zorros',
    'perro', 'perros', 'perrito', 'perrita', 'perra', 'perras', 'ojeto', 'marico', 'mariscos', 'marisco', 'manada', 'mamita', 'pendiente',
    'pendientes', 'chinita', 'cabeza', 'cobron', 'canon', 'jota', 'jotas', 'vergel', 'vergara', 'mason', 'maricarmen', 'estupor', 'estupidez',
    'imbecilidad', 'huevo', 'huevos', 'nacho', 'macho', 'mapache', 'puesto', 'punto', 'pinto', 'pista', 'mientras']);
  const LISTA = new Set(GROSERIAS);

  const sinAcentos = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // Números y símbolos usados para disfrazar letras
  const LEET = { 4: 'a', '@': 'a', 3: 'e', '€': 'e', 1: 'i', '!': 'i', '|': 'i', 0: 'o', 5: 's', $: 's', 7: 't', '+': 't', 8: 'b', 9: 'g' };
  const deLeet = (p) => (/[a-z]/.test(p) ? p.replace(/[4@3€1!|05$7+89]/g, (c) => LEET[c]) : p);
  const colapsar = (p) => p.replace(/(.)\1+/g, '$1'); // "puuuuto" → "puto"

  /* Distancia de edición con transposición (Damerau-Levenshtein restringida) */
  function distancia(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
    for (let i = 1; i <= a.length; i += 1) {
      for (let j = 1; j <= b.length; j += 1) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[a.length][b.length];
  }

  /* Palabras normalizadas del texto; también une letras sueltas separadas ("p u t o", "p.u.t.o", "p-u-t-o") */
  function palabras(texto) {
    const base = sinAcentos(texto);
    const unidas = base.replace(/\b([a-z0-9@$!])(?:[\s.\-_*]+(?=[a-z0-9@$!]\b)([a-z0-9@$!]))+/g, (m) => m.replace(/[\s.\-_*]+/g, ''));
    return [...new Set(`${base} ${unidas}`.split(/[^a-z0-9@$!€|+]+/).filter(Boolean))];
  }

  /* Devuelve la grosería encontrada (para registro) o null */
  function groseria(texto) {
    for (const cruda of palabras(texto)) {
      const p = colapsar(deLeet(cruda)).replace(/[^a-zñ]/g, '');
      if (!p) continue;
      const exacta = deLeet(cruda).replace(/[^a-zñ]/g, '');
      if (LISTA.has(exacta)) return exacta;
      const singular = exacta.replace(/(es|s)$/, '');
      if (exacta !== singular && (LISTA.has(singular) || LISTA.has(exacta.slice(0, -1)))) return LISTA.has(singular) ? singular : exacta.slice(0, -1);
      if (LISTA.has(p) && !PERMITIDAS.has(exacta)) return p;
      if (PERMITIDAS.has(p) || p.length < 5) continue;
      // Parecido: 1 letra de diferencia en palabras de 5 a 7 letras, 2 en las de 8 o más
      for (const g of GROSERIAS) {
        if (SOLO_EXACTAS.has(g) || g.length < 5) continue;
        const max = g.length >= 8 ? 2 : 1;
        if (distancia(p, g) <= max) return g;
      }
      // Grosería pegada a otra palabra ("hijodeputa", "pendejoo123")
      if (p.length >= 7 && GROSERIAS.some((g) => g.length >= 6 && !SOLO_EXACTAS.has(g) && p.includes(g) && !PERMITIDAS.has(p))) return p;
    }
    return null;
  }

  /* ¿Texto sin sentido? Revisa cada palabra larga: rachas de consonantes, falta de vocales,
     combinaciones que no existen en español, filas del teclado y patrones repetidos */
  const RARAS = /(ñl|ñk|kñ|lñ|jk|kj|qk|qw|wq|xz|zx|ñj|jñ|sdf|dfg|fgh|ghj|hjk|jkl|klñ|wer|ert|rty|tyu|yui|uio|iop|zxc|xcv|cvb|vbn|bnm|asd|qwe|lkj|kjh|jhg|ñlk|dsa|fds|poi|mnb)/;
  function palabraRara(p) {
    if (p.length < 6) return false;
    if (!/[aeiouy]/.test(p)) return true;                           // 6+ letras sin vocal
    if (/[^aeiouy]{5,}/.test(p)) return true;                       // 5+ consonantes seguidas
    const vocales = (p.match(/[aeiouy]/g) || []).length;
    if (p.length >= 10 && vocales / p.length < 0.25) return true;   // palabra larga casi sin vocales
    if (p.length >= 8 && RARAS.test(p)) return true;                // teclazos
    if (/(.{3,})\1{2,}/.test(p)) return true;                       // "asdasdasd"
    if (p.length > 24) return true;                                 // ninguna palabra común es tan larga
    return false;
  }
  function sinSentido(texto) {
    const ps = sinAcentos(texto).split(/[^a-zñ]+/).filter(Boolean);
    const raras = ps.filter(palabraRara);
    if (!raras.length) return null;
    // Una sola palabra rara en un texto largo puede ser un nombre propio o una marca: se tolera
    if (raras.length === 1 && ps.length >= 8 && raras[0].length < 12) return null;
    return raras[0];
  }

  /* Limpia y revisa un texto largo (mensajes, motivos): quita espacios y saltos de línea de relleno.
     Devuelve { texto, error } — error es null si se puede usar. */
  function revisarTexto(entrada, { min = 1, max = 500, campo = 'El texto', minPalabras = 1, lineas = 6 } = {}) {
    let t = String(entrada || '').replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ');
    t = t.split('\n').map((l) => l.trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n'); // máximo 1 línea vacía seguida
    t = t.replace(/\n{3,}/g, '\n\n').trim();
    const visibles = t.replace(/\s/g, '').length;
    const largo = [...t].length;
    const palabrasReales = (t.match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2,}/g) || []).length;
    let error = null;
    if (!t && min > 0) error = `${campo} no puede estar vacío.`;
    else if (largo > max) error = `${campo} puede tener máximo ${max} caracteres.`;
    else if (visibles < min) error = `${campo} debe tener al menos ${min} caracteres de texto (los espacios y saltos de línea no cuentan).`;
    else if (t.split('\n').length > lineas) error = `${campo} puede tener máximo ${lineas} renglones.`;
    else if (palabrasReales < minPalabras) error = `${campo} debe tener al menos ${minPalabras} palabra${minPalabras > 1 ? 's' : ''} con letras.`;
    else if (/(.)\1{5,}/.test(t.replace(/\s/g, ''))) error = `${campo} no puede repetir el mismo carácter tantas veces seguidas.`;
    else if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|mx|net|org|io|ly|me|co)\b)/i.test(t)) error = `${campo} no puede incluir enlaces.`;
    else if (groseria(t)) error = `${campo} contiene palabras no permitidas.`;
    else if (sinSentido(t)) error = `${campo} tiene palabras sin sentido (por ejemplo "${sinSentido(t)}"). Escribe con palabras reales.`;
    return { texto: t, error };
  }

  /* ---------- Correo ---------- */
  // Terminaciones mal escritas comunes y dominios temporales (correos desechables)
  const TLD_MAL = /\.(cum|con|cmo|comm|cpm|vom|xom|om|co\.m|mxx|cxm|ocm|cm|clm|ccom|coom|comn)$/;
  const DOMINIOS_MAL = { 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com', 'gmail.co': 'gmail.com', 'gmal.com': 'gmail.com',
    'gnail.com': 'gmail.com', 'hotmial.com': 'hotmail.com', 'hotmai.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com',
    'outlok.com': 'outlook.com', 'outloo.com': 'outlook.com', 'yaho.com': 'yahoo.com', 'yahoo.co': 'yahoo.com', 'yahooo.com': 'yahoo.com',
    'gmail.com.mx': 'gmail.com', 'iclod.com': 'icloud.com', 'icloud.co': 'icloud.com' };
  const DESECHABLES = new Set(['mailinator.com', 'yopmail.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
    'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'throwawaymail.com', 'fakeinbox.com', 'mintemail.com',
    'emailondeck.com', 'mohmal.com', 'tempail.com', 'mailnesia.com', 'mytemp.email', 'burnermail.io', 'example.com', 'test.com', 'correo.com']);
  const RE_CORREO = /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
  /* Revisión de formato (sin red). Devuelve null o el mensaje de error */
  function problemaCorreo(c) {
    const correo = String(c || '').trim().toLowerCase();
    if (!correo || correo.length > 254 || !RE_CORREO.test(correo) || /\.\./.test(correo)) return 'Ingrese un correo electrónico válido (ej. nombre@gmail.com).';
    const dominio = correo.split('@')[1];
    if (DOMINIOS_MAL[dominio]) return `¿Quisiste decir ${correo.split('@')[0]}@${DOMINIOS_MAL[dominio]}? Revisa el dominio del correo.`;
    if (TLD_MAL.test(dominio)) return `La terminación "${dominio.slice(dominio.lastIndexOf('.'))}" no es válida. Revisa el correo (¿.com?).`;
    if (DESECHABLES.has(dominio)) return 'No se aceptan correos temporales o de prueba. Usa tu correo personal.';
    if (groseria(correo.split('@')[0].replace(/[._\-+]/g, ' '))) return 'El correo contiene palabras no permitidas.';
    return null;
  }

  return { groseria, sinSentido, revisarTexto, problemaCorreo, distancia, sinAcentos, palabraRara };
}));
