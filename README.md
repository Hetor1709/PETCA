# Dopta · plataforma de adopción de perros (CDMX)

Aplicación web que corre **solo en tu computadora**: servidor Node.js (Express) + base de datos **MySQL** local. No usa servicios en la nube.

## Requisitos

- [Node.js](https://nodejs.org) 18 o más reciente (LTS recomendado).
- [MySQL Community Server](https://dev.mysql.com/downloads/mysql/) **8.0.16 o más reciente**, con el servicio iniciado. MariaDB no es compatible (Dopta usa `FOR UPDATE OF`, columnas JSON y restricciones `CHECK` de MySQL 8).

## Puesta en marcha

```bash
npm install            # solo la primera vez (npm start lo hace solo si faltan dependencias)
npm start
```

La primera vez, `npm start`:

1. crea el archivo `.env` a partir de `.env.example` (si no existía);
2. se conecta a MySQL, **crea la base `dopta`** si no existe y **crea las tablas** (`database/schema.sql`);
3. abre el servidor en <http://localhost:3000>.

Si tu MySQL tiene contraseña para `root` (lo normal), ponla en `DB_PASSWORD` dentro de `.env` y vuelve a ejecutar `npm start`. Mientras MySQL no esté disponible, la API responde con el motivo exacto y el servidor reintenta cada 5 segundos.

## Configuración (`.env`)

| Variable | Para qué sirve | Por defecto |
|---|---|---|
| `PORT` | Puerto del sitio | `3000` |
| `HOST` | Dirección en la que escucha. `127.0.0.1` = solo esta computadora; `0.0.0.0` = también la red | `127.0.0.1` |
| `DB_HOST`, `DB_PORT` | Dónde corre MySQL | `127.0.0.1`, `3306` |
| `DB_USER`, `DB_PASSWORD` | Credenciales de MySQL | `root`, *(vacía)* |
| `DB_NAME` | Nombre de la base | `dopta` |
| `SMTP_*` | Correo para recuperar contraseña. Vacío = el enlace se imprime en la consola donde corre `npm start` | vacío |
| `VALIDAR_CORREO_DNS` | `1` revisa que el dominio del correo exista (necesita internet) | `1` |
| `GOOGLE_MAPS_*` | Autocompletado de direcciones y mapa del administrador (opcional) | vacío |

El usuario de MySQL necesita permisos para crear la base (solo la primera vez) y para crear tablas, consultar y modificar datos en ella. Si prefieres no usar `root`:

```sql
CREATE USER 'dopta'@'localhost' IDENTIFIED BY 'una_clave';
GRANT ALL PRIVILEGES ON dopta.* TO 'dopta'@'localhost';
```

y pon `DB_USER=dopta` y `DB_PASSWORD=una_clave` en `.env` (con este usuario, crea antes la base: `CREATE DATABASE dopta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm start` | Inicia el sitio |
| `npm run dev` | Igual, reiniciando al editar archivos del servidor |
| `npm run db` | Crea o actualiza las tablas sin iniciar el sitio |
| `npm run admin -- correo@x.com "Nombre" Clave123` | Crea el **único** Administrador (`--reemplazar` para cambiarlo) |
| `npm run demo` | Carga refugios, perros y un adoptante de prueba (contraseña `Demo12345`) |
| `npm run respaldo` | Respaldo con `mysqldump` en `respaldos/` (conserva los últimos `RESPALDO_DIAS`) |
| `npm run verificar` | Diagnóstico: Node, dependencias, `.env`, MySQL, tablas y archivos |
| `npm run empaquetar` | Zip de entrega sin `.env` ni `node_modules` |

Para restaurar un respaldo: `mysql -u root -p dopta < respaldos/dopta_AAAA-MM-DD-....sql`.

## Estructura

```
server/      API (Express) y acceso a MySQL
  db.js        conexión (mysql2), consultas preparadas y transacciones
  arranque.js  crea la base y las tablas, diagnóstico de arranque
  ...          auth, animales, solicitudes, admin, cambios, lugares
database/schema.sql   esquema MySQL (idempotente)
public/      interfaz (HTML, CSS y JavaScript que sirve el propio servidor)
```

## Notas sobre MySQL

- Las fechas se guardan como `DATETIME`/`DATE` en hora de la Ciudad de México (las calcula el servidor).
- La base usa la collation `utf8mb4_unicode_ci`: las búsquedas ignoran mayúsculas y acentos.
- MySQL no tiene índices únicos parciales; las reglas "correo y teléfono únicos solo entre cuentas vigentes", "un solo administrador" y "un solo cambio pendiente por refugio" se aplican con columnas generadas (`correo_vigente`, `telefono_vigente`, `es_admin`, `pendiente_de`) que el servidor nunca escribe.
- Si `npm start` dice que el esquema no se pudo aplicar, revisa primero la versión de MySQL (`SELECT VERSION();`).
