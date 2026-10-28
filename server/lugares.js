/* Autocompletado de direcciones con Google Places API (New).
   La API key vive solo en el servidor (.env → GOOGLE_MAPS_API_KEY); el navegador nunca la ve.
   Sin key configurada, la dirección se escribe a mano como antes. */
const express = require('express');
const { q } = require('./db');
const { h, falla, limpiar, CP_ALCALDIA, sinAcentos } = require('./util');
const { limitador } = require('./seguridad');

const r = express.Router();
const BASE = process.env.GOOGLE_PLACES_URL || 'https://places.googleapis.com/v1';
const clave = () => process.env.GOOGLE_MAPS_API_KEY || '';

/* Rectángulo que cubre la Ciudad de México: las sugerencias se limitan a esta zona */
const CDMX = { low: { latitude: 19.04, longitude: -99.37 }, high: { latitude: 19.6, longitude: -98.94 } };
const enCDMX = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
  && lat >= CDMX.low.latitude && lat <= CDMX.high.latitude && lng >= CDMX.low.longitude && lng <= CDMX.high.longitude;

const RE_TOKEN = /^[A-Za-z0-9-]{10,40}$/;
const RE_PLACE = /^[A-Za-z0-9_-]{10,300}$/;
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Protege la cuota de Google: 60 consultas por minuto por conexión
const limite = limitador({ ventanaMin: 1, max: 60, mensaje: 'Demasiadas búsquedas de dirección. Espere un momento.' });

async function google(ruta, opciones) {
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${BASE}${ruta}`, { ...opciones, signal: ctrl.signal });
    if (!res.ok) {
      console.error('Google Places', res.status, (await res.text()).slice(0, 300));
      falla('No se pudo consultar la dirección. Escríbala manualmente.', 502);
    }
    return res.json();
  } catch (e) {
    if (e.status) throw e;
    falla('No se pudo consultar la dirección. Escríbala manualmente.', 502);
  } finally {
    clearTimeout(reloj);
  }
}

r.get('/lugares/estado', (req, res) => res.json({ activo: !!clave() }));

/* Sugerencias mientras se escribe */
r.post('/lugares/sugerencias', limite, h(async (req, res) => {
  if (!clave()) return res.json({ sugerencias: [], activo: false });
  const b = req.body || {};
  const texto = limpiar(b.texto).slice(0, 120);
  if ([...texto].length < 3) return res.json({ sugerencias: [] });
  if (!RE_TOKEN.test(String(b.sesion || ''))) falla('Solicitud inválida.');
  const j = await google('/places:autocomplete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': clave() },
    body: JSON.stringify({
      input: texto,
      languageCode: 'es',
      regionCode: 'mx',
      includedRegionCodes: ['mx'],
      locationRestriction: { rectangle: CDMX },
      sessionToken: b.sesion,
    }),
  });
  const sugerencias = (j.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .slice(0, 5)
    .map((p) => ({
      id: p.placeId,
      principal: (p.structuredFormat && p.structuredFormat.mainText && p.structuredFormat.mainText.text) || (p.text && p.text.text) || '',
      secundario: (p.structuredFormat && p.structuredFormat.secondaryText && p.structuredFormat.secondaryText.text) || '',
    }));
  res.json({ sugerencias });
}));

/* Convierte los componentes de Google en la ubicación atomizada de Dopta */
async function atomizar(componentes, formateada) {
  // Dirección sin el país, recortada a 200 caracteres (RF-04)
  const direccion = limpiar(String(formateada || '').replace(/,\s*(México|Mexico|Méx\.?)\s*$/i, '')).slice(0, 200);

  // Busca la alcaldía comparando los componentes de Google con las 16 del catálogo
  const alcaldias = await q("SELECT id, nombre FROM catalogo_valores WHERE catalogo = 'alcaldia' AND activo = 1");
  // Solo componentes administrativos: así una calle o colonia llamada "Miguel Hidalgo" no se confunde con la alcaldía
  const ADMIN = ['sublocality', 'sublocality_level_1', 'locality', 'administrative_area_level_2', 'administrative_area_level_3'];
  const nombres = componentes
    .filter((c) => (c.types || []).some((t) => ADMIN.includes(t)))
    .flatMap((c) => [c.longText, c.shortText]).map(norm);
  const clave16 = (n) => norm(n).replace(/^la\s+/, '').replace(/\s+de\s+morelos$/, '');
  // Ubicación atomizada: cada parte de la dirección en su campo
  // En la CDMX Google suele poner la alcaldía como sublocality_level_1 y la colonia como sublocality_level_2 o neighborhood
  const esAlcaldia = (t) => norm(t) === 'ciudad de mexico' || alcaldias.some((x) => norm(x.nombre) === norm(t) || norm(t).includes(clave16(x.nombre)));
  const comp = (...tipos) => {
    for (const t of tipos) {
      const c = componentes.find((x) => (x.types || []).includes(t) && !(t.startsWith('sublocality') && esAlcaldia(x.longText)));
      if (c) return limpiar(String(c.longText || ''));
    }
    return '';
  };
  const cp = /^\d{5}$/.test(comp('postal_code')) ? comp('postal_code') : '';
  // La alcaldía se toma del C.P. (más confiable); si no hay C.P., de los nombres administrativos de Google
  const porCp = cp && CP_ALCALDIA[cp.slice(0, 2)];
  const alc = (porCp && alcaldias.find((a) => sinAcentos(a.nombre) === sinAcentos(porCp)))
    || alcaldias.find((a) => nombres.some((n) => n === norm(a.nombre) || n.includes(clave16(a.nombre))));

  return {
    direccion,
    calle: comp('route').slice(0, 100),
    num_ext: comp('street_number').toUpperCase().slice(0, 10),
    colonia: comp('neighborhood', 'sublocality_level_2', 'sublocality_level_1', 'sublocality').replace(/^col(onia)?\.?\s+/i, '').slice(0, 80),
    cp,
    alcaldia_id: alc ? alc.id : null,
  };
}


/* Detalle del lugar elegido: dirección limpia, alcaldía del catálogo y coordenadas */
r.post('/lugares/detalle', limite, h(async (req, res) => {
  if (!clave()) falla('El autocompletado de direcciones no está disponible.', 503);
  const b = req.body || {};
  if (!RE_PLACE.test(String(b.id || '')) || !RE_TOKEN.test(String(b.sesion || ''))) falla('Solicitud inválida.');
  const j = await google(`/places/${encodeURIComponent(b.id)}?languageCode=es&regionCode=mx&sessionToken=${encodeURIComponent(b.sesion)}`, {
    headers: { 'X-Goog-Api-Key': clave(), 'X-Goog-FieldMask': 'id,formattedAddress,addressComponents,location' },
  });
  const lat = j.location && Number(j.location.latitude);
  const lng = j.location && Number(j.location.longitude);
  if (!enCDMX(lat, lng)) falla('La dirección debe estar dentro de la Ciudad de México.');

  res.json({ ...(await atomizar(j.addressComponents || [], j.formattedAddress)), lat, lng, place_id: j.id || b.id });
}));

/* Ubicación actual: el navegador da las coordenadas (con permiso del usuario) y Google Geocoding las convierte
   en dirección. Requiere habilitar "Geocoding API" en la misma key. */
const GEOCODE = process.env.GOOGLE_GEOCODE_URL || 'https://maps.googleapis.com/maps/api/geocode/json';
r.post('/lugares/inversa', limite, h(async (req, res) => {
  if (!clave()) falla('La ubicación automática no está disponible.', 503);
  const b = req.body || {};
  const lat = Number(b.lat);
  const lng = Number(b.lng);
  if (!enCDMX(lat, lng)) falla('Tu ubicación actual está fuera de la Ciudad de México. Escribe la dirección del refugio.');
  const ctrl = new AbortController();
  const reloj = setTimeout(() => ctrl.abort(), 6000);
  let j;
  try {
    const url = `${GEOCODE}?latlng=${lat.toFixed(6)},${lng.toFixed(6)}&language=es&region=mx&result_type=street_address|premise|route&key=${encodeURIComponent(clave())}`;
    const r2 = await fetch(url, { signal: ctrl.signal });
    j = await r2.json();
  } catch {
    falla('No se pudo obtener la dirección de tu ubicación. Escríbela manualmente.', 502);
  } finally { clearTimeout(reloj); }
  if (j.status === 'REQUEST_DENIED') { console.error('Geocoding:', j.error_message); falla('La ubicación automática no está habilitada (activa Geocoding API en tu key de Google).', 503); }
  const g = (j.results || [])[0];
  if (!g) falla('No encontramos una dirección para tu ubicación. Escríbela manualmente.', 404);
  const comps = (g.address_components || []).map((c) => ({ longText: c.long_name, shortText: c.short_name, types: c.types }));
  res.json({ ...(await atomizar(comps, g.formatted_address)), lat, lng, place_id: RE_PLACE.test(String(g.place_id || '')) ? g.place_id : null });
}));

module.exports = { router: r, enCDMX, RE_PLACE };
