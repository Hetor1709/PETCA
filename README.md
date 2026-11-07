# Dopta · Plataforma de adopción de perros (CDMX) · v2.0

Catálogo gratuito que conecta **refugios verificados** con **adoptantes** y guía la adopción con el protocolo
que usan los refugios de la Ciudad de México. Web de una sola página + API REST en Node.js + **PostgreSQL (Supabase)**.

## Estructura

```
public/            Frontend (lo único que ve el navegador)
  index.html       1 sola página
  app.js           rutas, vistas y validaciones del navegador
  app.css          estilos (claro y oscuro)
  filtro.js        groserías (Levenshtein), texto sin sentido, correos — compartido con el servidor
  reglas.js        peso y altura por raza y edad en meses — compartido con el servidor
  razas.js         razas con su ilustración SVG
server/            Backend
  index.js         servidor, errores, tareas periódicas, /api/cron/mantenimiento
  db.js            conexión a PostgreSQL (pg) con la misma interfaz que tenía MySQL
  seguridad.js     cabeceras (CSP), CSRF, límites, sesiones, roles
  auth.js          registro, sesión, contraseña, cuenta, foto de perfil, notificaciones
  animales.js      catálogo y filtros, publicaciones, perfil y estadísticas del refugio
  solicitudes.js   protocolo de adopción, mensajes, visita, entrega, seguimiento, reportes
  cambios.js       cambios de datos del refugio que aprueba el Administrador
  admin.js         verificación, refugios, publicaciones, cuentas, reportes, estadísticas, CSV
  lugares.js       C.P. → alcaldía y colonias (SEPOMEX) y sugerencias de Google
  cp_cdmx.json     códigos postales de la CDMX (Correos de México)
database/schema.sql  esquema idempotente (se aplica solo al arrancar)
render.yaml        despliegue en Render
```

## Roles

| Rol | Puede |
|---|---|
| **Adoptante** | Ver el catálogo, enviar el formato de adopción, conversar con el refugio, cancelar, reportar refugios y publicaciones |
| **Refugio** | Publicar y editar perros, revisar solicitudes, agendar cita, registrar visita, entrega y seguimiento, reportar adoptantes. **No puede adoptar** |
| **Funcionario** | Atender reportes y ver estadísticas (lo asigna el Administrador a una cuenta de adoptante) |
| **Administrador** | Uno solo. Verifica refugios (con el mapa), aprueba cambios de datos, modera, administra cuentas y catálogos. No se pueden crear más administradores desde la app (índice único en la base); solo con `npm run admin -- --reemplazar` |

## Protocolo de adopción (CDMX)

Basado en la Ley de Protección y Bienestar de los Animales de la CDMX (art. 32: entrega esterilizado o con compromiso,
desparasitado y con cartilla; carta compromiso; persona mayor de edad) y en la práctica de refugios y de la
Brigada de Vigilancia Animal:

1. **Formato**: cuestionario de hogar, experiencia y tiempo + carta compromiso (6 puntos) + mayoría de edad.
2. **Revisión** del refugio y **conversación** corta (300 caracteres, 10 al día, máx. 3 seguidos sin respuesta).
3. **Cita** para conocer al perro y entregar documentos (próximos 14 días).
4. **Visita domiciliaria** (realizada / no requerida / hogar no apto → se rechaza con motivo).
5. **Entrega** con lista: carta firmada, desparasitado, cartilla, esterilizado (o fecha comprometida si es cachorro) y folio RUAC opcional.
6. **Seguimiento** a la semana, al mes y a los 3 meses (se avisa al refugio cuando toca).

## Validaciones principales

- **Groserías** con distancia de Damerau‑Levenshtein (detecta `pndejo`, `p3ndej0`, `puuuto`…) y lista de excepciones (`perra`, `huevos`…).
- **Texto sin sentido**: 10+ letras sin vocal/patrón razonable (`ñljkñksñldkasd`), letras repetidas, solo espacios o saltos de línea.
- **Correo**: formato, TLD mal escrito (`.cum`, `.con`, `.comm`), dominios mal escritos (`gmial`), desechables, y **DNS MX** (que el dominio reciba correo).
- **Teléfono**: LADA real de México y tipo fijo/móvil (`libphonenumber-js`) + series falsas (`5555555555`, `1234567890`). Un número solo puede estar en una cuenta vigente; al darse de baja se libera, igual que el correo.
- **Contraseña** nueva distinta de la actual.
- **Peso y altura** por raza (o tamaño en mestizos) **y por edad en meses** con una curva de crecimiento (un cachorro de 1 mes no puede pesar 75 kg).
- **Ubicación**: primero el **C.P.**, la alcaldía se llena sola, la colonia se elige de la lista SEPOMEX y la calle se sugiere con Google acotada a esa zona.
- **Cambios fuertes** en un perro con solicitudes (nombre, raza, edad, tamaño): se avisa, y si se confirma se cancelan las solicitudes y se notifica a cada adoptante.
- **Datos del refugio** (institución, dirección, teléfono, horario): el cambio queda pendiente hasta que lo aprueba el Administrador.

## Desarrollo local

1. Instala **Node.js 20** y **PostgreSQL 16** (o usa directamente la base de Supabase).
2. `npm install`
3. Copia `.env.example` a `.env` y pon tu `DATABASE_URL`.
4. `npm start` → crea las tablas solas y abre `http://localhost:3000`.
5. `npm run admin` crea el único Administrador. `npm run demo` carga refugios y perros de prueba.

## Despliegue: Supabase + Render

**Base de datos (Supabase, gratis)**
1. supabase.com → New project (región *East US* o la más cercana a tu servicio de Render). Guarda la contraseña.
2. Project Settings → Database → **Connection string** → pestaña **Session pooler** → copia la URI y reemplaza `[YOUR-PASSWORD]`.
   *No uses la conexión directa (es solo IPv6 y Render no la alcanza) ni el Transaction pooler (6543): Dopta usa bloqueos de sesión al migrar.*
3. No hace falta correr SQL a mano: Dopta crea el esquema al arrancar.

**Aplicación (Render, gratis)**
1. Sube el proyecto a GitHub (sin `.env`).
2. render.com → New → **Blueprint** → elige el repositorio (usa `render.yaml`). O bien *Web Service*: Build `npm ci --omit=dev`, Start `npm start`, Health check `/api/version`.
3. En Environment pega `DATABASE_URL` (y si quieres `GOOGLE_MAPS_API_KEY` / `GOOGLE_MAPS_EMBED_KEY`).
4. Al terminar el deploy, abre la Shell del servicio y ejecuta `npm run admin` para crear el Administrador.

**Limitaciones del plan gratis**
- Render duerme el servicio tras 15 min sin visitas (la primera carga tarda ~1 min) y **bloquea SMTP**.
- Supabase pausa el proyecto tras 7 días sin actividad (se reactiva desde su panel).
- Para las tareas diarias (seguimientos, purga), programa en cron-job.org un `GET https://<tu-app>.onrender.com/api/cron/mantenimiento`
  con el encabezado `Authorization: Bearer <CRON_SECRET>`.

## Pendiente

- **Correo de recuperación de contraseña**: el token ya se genera y caduca, pero no hay servicio de envío. En Render
  se recomienda una API HTTP (Resend o Brevo) en lugar de SMTP. Mientras, el enlace se imprime en el log del servidor.

## Fuentes de datos

- Códigos postales: Catálogo Nacional de Códigos Postales, Correos de México (SEPOMEX), uso libre no comercial.
- Ley de Protección y Bienestar de los Animales de la Ciudad de México (PAOT).
