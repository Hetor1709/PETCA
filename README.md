# Dopta · sitio estático (HTML, CSS, JavaScript y JSON)

Dopta ya no necesita Node.js ni PostgreSQL. Todo corre en el navegador:

- `public/index.html`, `public/app.css`, `public/app.js`: interfaz (sin cambios de fondo).
- `public/js/servidor.js`: sustituye a la antigua API. Atiende las llamadas `/api/...` con la misma lógica de validación, solicitudes, citas, adopciones, refugios, reportes y estadísticas.
- `public/data/catalogos.json`, `public/data/razas.json`, `public/data/cp_cdmx.json`: datos iniciales (catálogos, razas y códigos postales de la CDMX).
- `public/data/esquema.json`: estructura de las tablas (equivalente a la antigua `database/schema.sql`).

## Cómo abrirlo

Hay que servir la carpeta con cualquier servidor estático (no sirve abrir el HTML con doble clic, porque el navegador no carga los JSON). Por ejemplo:

```bash
npx serve public
```

o subir la carpeta a un hosting estático (GitHub Pages, Hostinger, Netlify).

## Crear la cuenta de Administrador

Desde la consola del navegador en la página de Dopta (solo se puede crear uno):

```js
await DoptaServidor.crearAdministrador('correo@ejemplo.com', 'Nombre Completo', 'Clave12345')
```

## Dónde se guardan los datos

Cada navegador tiene su propia copia en `localStorage` (clave `dopta.datos.v2`). Los refugios, perros y solicitudes registrados en una computadora no aparecen en otra. Para mover o respaldar datos:

```js
// Respaldo
const txt = DoptaServidor.exportarRespaldo();
// Restaurar
await DoptaServidor.importarRespaldo(txt);
```

## Limitaciones frente a la versión con servidor

- **Sin base de datos compartida:** no hay sincronización entre dispositivos.
- **Seguridad:** las contraseñas se guardan con PBKDF2 en el navegador, pero cualquiera con acceso al navegador puede leer los datos. No es adecuado para datos personales reales en producción.
- **Recuperar contraseña:** no se envía correo. El enlace aparece en pantalla.
- **Autocompletado de direcciones con Google:** desactivado (una clave de Google no puede ser secreta en el navegador). La dirección se escribe a mano.
- **Revisión de teléfonos:** solo formato y series inventadas; ya no se consulta la LADA.
- **Revisión de dominios de correo (DNS):** ya no se hace.
- **Límites de intentos:** solo en memoria de la pestaña.

Los archivos Node antiguos (`server/`, `database/`, `package.json`, `package-lock.json`, `.env.example`) ya no se usan y pueden eliminarse; siguen disponibles en el historial de git.
