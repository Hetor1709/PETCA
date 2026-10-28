# Dopta · Plataforma de adopción de perros (CDMX)

Catálogo gratuito que conecta refugios verificados con adoptantes. Web de una sola página + API REST en Node.js + MySQL.
Cubre los requerimientos **RF-01 a RF-37** y **RNF-01 a RNF-07** del Documento de Requerimientos v7, más el
RNF-08 (Rendimiento), que solo aparece en la Especificación de Casos de Uso.

## Alcance de este entregable

- **Incluye:** la versión **web** completa (frontend + API REST + base de datos MySQL).
- **No incluye:** la **aplicación móvil Android** (Android Studio + Java) que pide el documento en
  "Requerimientos de Hardware y Software". Es un entregable aparte. Esa app puede reutilizar esta misma API
  (`/api/...`) y la misma base de datos, así que tendría las mismas reglas y validaciones que la web.

## Estructura

```
dopta-web/
├─ public/                 ← Frontend (lo único que ve el navegador)
│  ├─ index.html           1 sola página
│  ├─ app.css              1 hoja de estilos (base + páginas + componentes)
│  ├─ app.js               toda la app: rutas, vistas, validaciones, seguridad
│  ├─ razas.js             24 razas con su ilustración SVG
│  └─ img/                 logo, hueso, pantalla de carga, errores
├─ server/                 ← Backend (nunca se publica)
│  ├─ index.js             servidor, redirecciones, errores, tareas periódicas
│  ├─ seguridad.js         cabeceras, CSRF, límites, sesiones, roles
│  ├─ auth.js              registro, sesión, recuperación, cuenta, notificaciones
│  ├─ animales.js          catálogo, publicaciones, perfil y estadísticas del refugio
│  ├─ solicitudes.js       solicitudes, citas, adopciones, reportes
│  ├─ admin.js             moderación, catálogos, reportes, estadísticas, CSV
│  ├─ util.js / db.js / correo.js / herramientas.js / razas.json
├─ database/schema.sql     tablas + catálogos iniciales (tamaños, edades, alcaldías)
├─ .env.example            configuración
└─ package.json
```

Los archivos antiguos de la raíz (`index.html`, `login.html`, `registro.html`, `animal.html`, `usuario.html`, `refugio.html`,
`refugio-mascota.html`, `perfil.html`, `ajustes.html`, `cuestionario.html`, `sobre-nosotros.html`, `404.html`, `500.html`,
`css/`, `js/` e `img/`) ya no se usan: su contenido vive en `public/`. Puedes borrarlos. Si alguien entra a una URL vieja
(ej. `/login.html`), el servidor lo redirige a la ruta nueva.

## Arranque rápido en cualquier computadora

1. Instala **Node.js LTS** (nodejs.org) y **XAMPP**; en XAMPP presiona **Start** en MySQL.
2. Descomprime el proyecto, abre una terminal en su carpeta y ejecuta **`npm start`**. Luego abre `http://localhost:3000`.

Al arrancar, Dopta revisa y corrige solo lo que puede:

| Situación | Qué hace |
|---|---|
| Faltan las dependencias (`node_modules`) | Ejecuta `npm install` automáticamente |
| No existe `.env` | Lo crea con la configuración de XAMPP (usuario `root`, sin contraseña) |
| No existe la base de datos o faltan tablas | Las crea con `database/schema.sql` |
| La base es de una versión anterior | Aplica las migraciones (columnas y catálogos nuevos) |
| MySQL apagado o usuario/contraseña incorrectos | Explica la causa en la terminal **y en la página**, y reintenta cada 5 s: al encender MySQL se recupera solo, sin reiniciar |
| Archivos de otra versión (por ejemplo, un archivo viejo guardado encima) | Avisa cuáles son al iniciar |
| El puerto 3000 ya está en uso | Avisa que Dopta probablemente ya está abierto |
| El navegador tiene una versión vieja en caché | La página pide recargar con Ctrl + F5 |

También muestra la dirección para abrir Dopta **desde otro dispositivo de la misma red Wi-Fi** (celular o tablet), por ejemplo
`http://192.168.1.50:3000`. Si Windows pregunta por el firewall, permite el acceso en redes privadas.

Diagnóstico completo en cualquier momento: `npm run verificar`.

## Puesta en marcha manual (Windows)

1. Instala **Node.js 18+** y **MySQL 8** (o MariaDB de XAMPP).
2. Crea el usuario de base de datos (en la consola de MySQL como root):
   ```sql
   CREATE USER 'dopta'@'localhost' IDENTIFIED BY 'una-contrasena-segura';
   GRANT ALL ON dopta.* TO 'dopta'@'localhost';
   ```
3. En la carpeta del proyecto:
   ```bash
   copy .env.example .env        # y edita DB_PASSWORD
   npm install
   npm run db                    # crea la base y las tablas (opcional: npm start lo hace solo)
   npm run admin -- tu@correo.com "Tu Nombre" TuClave123
   npm run demo                  # opcional: 2 refugios, 12 perros y 1 adoptante de prueba (clave Demo12345)
   npm start
   ```
4. Abre http://localhost:3000

Cuentas demo: `refugio1@dopta.demo`, `refugio2@dopta.demo`, `adoptante@dopta.demo` (contraseña `Demo12345`).

## Autocompletado de direcciones (Google Places)

En el registro del refugio, al reenviar la verificación y en su perfil, el buscador **Buscar dirección** sugiere
direcciones reales de la CDMX mientras se escribe. Al elegir una se llenan solos los campos de la ubicación
(calle, número exterior, colonia, código postal y alcaldía) y se guardan las coordenadas; lo que Google no traiga
se marca para completarlo a mano. En la ficha de cada perro aparece el botón **"Cómo llegar"**, que abre Google Maps.

Para activarlo:
1. En https://console.cloud.google.com crea un proyecto, activa **Places API (New)** y **Geocoding API**
   (esta última para el botón "Usar mi ubicación actual") y crea una **API key**.
2. Restringe la key: en "Restricciones de API" elige solo *Places API (New)* y *Geocoding API*. Si el servidor tiene IP fija,
   restríngela también por IP.
3. Ponla en el `.env`: `GOOGLE_MAPS_API_KEY=tu-key` y reinicia con `npm start`.

Notas:
- La key **solo vive en el servidor**: el navegador habla con `/api/lugares/...` y nuestro servidor consulta a Google.
  Nadie puede copiarla desde la página.
- Límite de 60 búsquedas por minuto por conexión para cuidar la cuota. Las sugerencias usan *session tokens*,
  así cada búsqueda con su selección se cobra como una sola sesión.
- Google requiere una cuenta de facturación, pero da un crédito mensual gratuito; con el volumen de un refugio
  normalmente no se paga nada. Revisa los precios vigentes antes de publicar. (RNF-05 pide presupuesto $0.)
- **Sin key**, todo funciona igual que antes: la dirección se escribe a mano y "Cómo llegar" busca por texto.
- Si la base de datos se creó antes de este cambio, el servidor agrega solo las columnas `lat`, `lng` y `place_id`
  al iniciar; no hace falta volver a correr `npm run db`.

## Rutas de la aplicación

| Rol | Rutas |
|---|---|
| Público | `#/` catálogo · `#/animal/:id` ficha · `#/cuestionario` · `#/nosotros` · `#/login` · `#/registro` · `#/recuperar` |
| Adoptante | `#/solicitudes` · `#/notificaciones` · `#/cuenta` |
| Refugio | `#/refugio` · `#/refugio/animal/nuevo` · `#/refugio/animal/:id` · `#/refugio/solicitudes` · `#/refugio/perfil` · `#/refugio/estadisticas` |
| Admin | `#/admin` · `/verificacion` · `/publicaciones` · `/reportes` · `/cuentas` · `/catalogos` · `/estadisticas` |

## Razas y mestizos

- Al publicar, el refugio elige la raza tocando su ilustración (24 razas, con buscador).
- Si elige **Mestizo**, aparece un segundo selector: *¿A qué raza se parece más?* (o “No estoy seguro”).
- No se suben fotos: cada perro se muestra con la ilustración de su raza (o de la raza parecida en mestizos).
- **Tamaño automático:** en razas puras el tamaño lo asigna el sistema según la raza (un chihuahua siempre es Pequeño) y no se puede cambiar. En mestizos lo elige el refugio y se sugiere el de la raza parecida.
- Buscar “husky” también encuentra mestizos parecidos a husky.
- Para agregar una raza: añade su objeto en `public/razas.js` y su `id`/`nombre` en `server/razas.json`.

## Seguridad implementada

| Capa | Medida |
|---|---|
| Contraseñas | bcrypt (costo 12) con sal; nunca en texto plano (RNF-03) |
| Sesión | token aleatorio de 256 bits en cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` y prefijo `__Host-` en producción); en BD solo se guarda su hash; cierre a los 30 min de inactividad en servidor **y** cliente; se regenera al iniciar sesión y se invalidan las demás al cambiar contraseña |
| CSRF | cabecera obligatoria `X-Dopta` + validación de `Origin` en toda petición que modifica datos |
| SQL injection | 100 % consultas parametrizadas, `multipleStatements` desactivado |
| XSS | el frontend escapa todo dato antes de pintarlo (`& < > " ' ` = /` → entidades) mediante plantillas seguras; los campos de texto eliminan `<` `>` y caracteres invisibles mientras se escribe; el servidor también los elimina; CSP estricta sin scripts en línea |
| Redirecciones | rutas protegidas por rol (cliente y servidor); `?next=` solo acepta rutas internas conocidas (sin redirección abierta); URLs antiguas → 301 a las nuevas; rutas desconocidas → 404; HTTP → HTTPS en producción |
| Fuerza bruta | 10 intentos de login / 15 min por IP+correo; 10 registros / hora por IP; 3 recuperaciones / hora por correo (RF-08); 600 peticiones / 15 min por IP |
| Enumeración | misma respuesta en recuperación exista o no el correo; tiempo de login constante con hash falso |
| Entrega | `npm run empaquetar` arma el zip con lista blanca: nunca incluye `.env` |
| Nombres | personas: solo letras, máx. 6 palabras, no solo iniciales · perros: 2–30 letras, máx. 3 palabras, sin términos genéricos ni nombre de raza · refugios: letras, números y . , & ( ) - · todos: sin la misma letra 3 veces seguidas, con vocal y sin groserías |
| Cabeceras | Helmet: CSP, `frame-ancestors 'none'` (anti-clickjacking), HSTS, `nosniff`, `Referrer-Policy`; sin `X-Powered-By` |
| Privacidad | el correo del adoptante solo lo ven el refugio de su solicitud y el admin (RNF-03) |
| Sondeos | rutas tipo `.env`, `.git`, `.php`, `wp-admin`, `../` responden 404 sin información |
| Errores | mensajes genéricos al usuario, detalle solo en el log del servidor |

## Entrega segura del proyecto

Para entregar o compartir el proyecto **no comprimas la carpeta a mano**: usa

```bash
npm run empaquetar
```

Crea `entrega/dopta-web_FECHA.zip` solo con `public/`, `server/`, `database/`, `package.json`,
`package-lock.json`, `.env.example`, `.gitignore` y este README. **Nunca** incluye `.env` (contraseñas),
`node_modules/`, `respaldos/` ni los archivos antiguos de la raíz.

Si alguna vez se compartió un `.env` real, cambia esa contraseña de MySQL de inmediato
(en el Shell de XAMPP: `mysql -u root`, luego `ALTER USER 'dopta'@'localhost' IDENTIFIED BY 'nueva-clave';`)
y actualiza `DB_PASSWORD` en tu `.env`.

## Producción

- Define `NODE_ENV=production`, `BASE_URL=https://tu-dominio` y, si el hosting termina HTTPS (Render, Railway, Nginx), `TRUST_PROXY=1`.
- Configura `SMTP_*` para enviar los correos de recuperación (sin SMTP, el enlace se imprime en la consola).
- **Respaldo diario (RNF-06):** `npm run respaldo` genera `respaldos/dopta_FECHA.sql` y conserva los últimos 30.
  Prográmalo en el Programador de tareas de Windows (diario) o con cron: `0 3 * * * cd /ruta && npm run respaldo`.

## Decisiones tomadas (revisables)

- **Estadísticas generales (RF-36):** “animales publicados” usa la fecha de ingreso, igual que RF-35, para que las cifras coincidan (CA1).
- **Cita (RF-21):** el bloque de 30 min debe terminar antes del cierre; reagendar reemplaza la cita anterior.
- **Una sola solicitud aprobada por animal (RF-19):** no se puede aprobar otra mientras exista una aprobada.
  Si el adoptante desiste, el refugio usa **Cancelar aprobación** (pasa a Rechazada con motivo y se borra la cita)
  y entonces puede aprobar otra. Además, al concretar la adopción (RF-23) se cierran las pendientes y cualquier
  aprobada sin concretar, con aviso a cada adoptante.
- **RF-15 y RF-22 usan el mismo flujo:** cambiar a Adoptado exige la solicitud aprobada y la fecha de concreción.
  Volver a Disponible revierte la adopción: la solicitud queda aprobada sin fecha de concreción y se avisa al adoptante.
- **Ficha de un animal adoptado:** se muestra como historial con estado *Adoptado* y sin botón de adopción
  (las solicitudes del adoptante siguen enlazando a ella). Solo responde 404 si la publicación fue eliminada.
- **RF-36 refugios_activos:** cuenta los refugios verificados antes del fin del periodo que no se dieron de baja
  ni fueron eliminados antes de su inicio (activos en algún momento del periodo).
- **Nombre del adoptante (RF-01):** solo letras (con acentos y ñ) y espacios; no se aceptan apóstrofes.
- **Salud y temperamento con opciones cerradas (cambio sobre RF-12):** el texto libre "estado de salud" (máx. 500)
  se reemplazó por *Estado de salud general* (Excelente / Bueno / Regular / En recuperación) y *¿Requiere medicamento
  o trato especial?* (No / medicamento / dieta especial / cuidados especiales). El temperamento se divide en *general*,
  *con otros perros*, *con desconocidos* y *al comer*, con "No evaluado" donde aplica. Las opciones viven en
  `server/util.js → OPCIONES_ANIMAL`; el servidor rechaza cualquier valor fuera de la lista. Las publicaciones
  anteriores siguen mostrando su texto libre hasta que se editen. Conviene reflejar este cambio en el Documento de Requerimientos.
- **Vacunas como catálogo (cambio sobre RF-12):** ya no se escriben a mano; se marcan de una lista
  (Antirrábica, Parvovirus, Moquillo, Hepatitis canina, Leptospirosis, Parainfluenza, Bordetella, Coronavirus canino
  y Múltiple) con su fecha de aplicación, máximo 10. El Administrador puede agregar, renombrar o desactivar vacunas
  en **Catálogos** (RF-29 a RF-31).
- **Refugios públicos:** la búsqueda del catálogo también encuentra refugios (por nombre, institución o alcaldía).
  Cada refugio tiene su página `#/refugios/:id` con ubicación, "Cómo llegar", teléfono, horario (con el día de hoy
  marcado y si está abierto ahora), adopciones logradas y sus perros disponibles. En la ficha de cada perro, el
  nombre del refugio enlaza a esa página. Nunca se muestran correos.
- **Validaciones de coherencia (se aplican en el navegador y, de forma definitiva, en el servidor):**
  - *Teléfono:* además de 10 dígitos, no puede empezar con 0 o 1 ni ser una serie falsa (0000000000, 1234567890…).
  - *Ubicación por partes:* calle (con letras), número exterior (`1200`, `15-B`, `12A` o `S/N`), número interior
    opcional, colonia y código postal de 5 dígitos de la CDMX (01000–16999). Los 2 primeros dígitos del C.P. indican
    la alcaldía: al escribirlo se elige sola y no se acepta una alcaldía distinta a la del C.P.
  - *Nombres:* sin la misma letra 3 veces seguidas, con al menos una vocal y sin groserías; el del perro, de 2 a 30
    letras, sin términos genéricos ("perro", "prueba"…) ni el nombre de su raza.
  - *Tamaño:* en razas puras se asigna solo según la raza (un chihuahua siempre es pequeño); en mestizos se sugiere
    el de la raza parecida y el refugio puede cambiarlo.
  - *Mensaje de la solicitud* (opcional): de 10 a 500 caracteres, con texto real, sin enlaces ni groserías.
  - *Nombres* de refugio, institución y perro: deben incluir letras (no solo números o símbolos).
  - *Horario:* cada día abierto con al menos 1 hora de atención y al menos un día abierto (si no, no se pueden agendar citas).
  - *Fechas del perro* (ingreso, vacunas, esterilización): no antes del año 2000 ni antes del nacimiento estimado por
    su edad (con un margen de un mes o un año). Ej.: un cachorro de 3 meses no puede tener una vacuna de hace un año.
  - *Requisitos:* sin repetidos en la misma publicación.
  - *Publicación duplicada:* un refugio no puede tener dos perros disponibles con el mismo nombre y raza.
  - *Estadísticas:* el periodo no puede empezar antes del año 2000.
- **Requisitos de adopción:** lista cerrada de documentos (INE, comprobante de domicilio, CURP…) que el admin
  administra en Catálogos → Documentos; el refugio marca los que pide y puede agregar hasta 3 "Otro" escritos a mano.
- **Peso y altura:** al elegir raza y edad se sugieren el peso (kg) y la altura a la cruz (cm) típicos de la raza
  (o del tamaño en mestizos), ajustados si es cachorro. El servidor rechaza valores incoherentes (ej. un chihuahua
  adulto de 30 kg). *Los rangos por raza son aproximados de referencia (server/razas.json).*
- **Teléfono del adoptante:** se pide al registrarse (y en la solicitud si una cuenta antigua no lo tiene). Solo lo ve
  el refugio de cada solicitud; se edita en Mi cuenta y se borra en la purga.
- **Nota del refugio:** en solicitudes pendientes o aprobadas el refugio puede dejar un aviso corto (5–200 caracteres)
  que el adoptante ve en su solicitud y recibe como notificación.
- **Cita en tabla:** día, hora, refugio, dirección con "Cómo llegar", teléfono y qué documentos llevar.
- **Ubicación actual:** "Usar mi ubicación actual" llena la dirección del refugio (requiere Geocoding API) y
  "Más cercanos a mí" ordena los refugios por distancia. El navegador pide permiso; solo funciona en https o
  localhost (no en `http://192.168...`). La ubicación del usuario no se guarda.
- **Mostrar contraseña:** todos los campos de contraseña tienen el botón del ojo.
- **Mensaje en la solicitud (RF-16):** al solicitar una adopción, el adoptante puede escribir un mensaje opcional para
  el refugio (con quién vive, otras mascotas, etc.). El refugio lo ve en sus solicitudes y el adoptante en las suyas.
- **Purga (RF-10):** a los 30 días de la baja se borran nombre, correo, contraseña, institución, dirección (todas sus
  partes), teléfono y los mensajes de las solicitudes.
- **Baja o eliminación de cuenta:** se cierran las solicitudes pendientes del adoptante o se retiran las publicaciones disponibles del refugio.
- **Catálogos:** el admin edita Tamaños, Rangos de edad y Tipos de requisito; las 16 alcaldías son fijas. Se agregó “Activar” como inverso de RF-31.
- **Tamaño/energía por raza** (para el cuestionario) son orientativos y están en `public/razas.js`. El cuestionario
  busca el tamaño en el catálogo por su posición (1.º, 2.º y 3.º), así que sigue funcionando si el admin lo renombra.
- **Aviso de privacidad v1.0** es un texto base: debe revisarlo quien sea responsable legal del proyecto.
