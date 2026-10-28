-- =====================================================================
-- Dopta · Esquema MySQL 8 (o MariaDB 10.6+)
-- Todas las fechas se guardan en hora de la Ciudad de México (las calcula el servidor).
-- Uso:  mysql -u root -p < database/schema.sql
-- =====================================================================
CREATE DATABASE IF NOT EXISTS dopta CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE dopta;

-- ---------- Cuentas ----------
CREATE TABLE IF NOT EXISTS usuarios (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tipo             ENUM('adoptante','refugio','admin') NOT NULL,
  nombre           VARCHAR(120) NOT NULL,
  correo           VARCHAR(254) NOT NULL,
  hash             VARCHAR(100) NOT NULL,
  estado           ENUM('activa','pendiente','rechazada','baja','eliminada') NOT NULL DEFAULT 'activa',
  aviso_version    VARCHAR(10)  NOT NULL,
  aviso_fecha      DATETIME     NOT NULL,
  creado           DATETIME     NOT NULL,
  verificado_en    DATETIME     NULL,
  rechazado_en     DATETIME     NULL,
  baja_en          DATETIME     NULL,
  purgar_en        DATETIME     NULL,
  purgado          TINYINT(1)   NOT NULL DEFAULT 0,
  eliminado_motivo VARCHAR(300) NULL,
  eliminado_en     DATETIME     NULL,
  UNIQUE KEY uq_correo (correo),
  KEY ix_tipo_estado (tipo, estado)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS catalogo_valores (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  catalogo  ENUM('tamano','edad','tipo_requisito','alcaldia','vacuna') NOT NULL,
  nombre    VARCHAR(50) NOT NULL,
  orden     INT NOT NULL DEFAULT 0,
  activo    TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_catalogo_nombre (catalogo, nombre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS refugios (
  usuario_id   INT UNSIGNED PRIMARY KEY,
  institucion  VARCHAR(120) NOT NULL,
  direccion    VARCHAR(200) NOT NULL,
  telefono     CHAR(10)     NOT NULL,
  alcaldia_id  INT UNSIGNED NULL,
  lat          DECIMAL(9,6) NULL,          -- coordenadas de Google Places (opcional)
  lng          DECIMAL(9,6) NULL,
  place_id     VARCHAR(300) NULL,
  CONSTRAINT fk_ref_usuario  FOREIGN KEY (usuario_id)  REFERENCES usuarios(id),
  CONSTRAINT fk_ref_alcaldia FOREIGN KEY (alcaldia_id) REFERENCES catalogo_valores(id)
) ENGINE=InnoDB;

-- dia: 0 = lunes … 6 = domingo
CREATE TABLE IF NOT EXISTS refugio_horarios (
  refugio_id  INT UNSIGNED NOT NULL,
  dia         TINYINT UNSIGNED NOT NULL,
  cerrado     TINYINT(1) NOT NULL DEFAULT 1,
  abre        CHAR(5) NULL,
  cierra      CHAR(5) NULL,
  PRIMARY KEY (refugio_id, dia),
  CONSTRAINT fk_hor_refugio FOREIGN KEY (refugio_id) REFERENCES refugios(usuario_id)
) ENGINE=InnoDB;

-- ---------- Publicaciones ----------
CREATE TABLE IF NOT EXISTS animales (
  id                   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  refugio_id           INT UNSIGNED NOT NULL,
  nombre               VARCHAR(50)  NOT NULL,
  raza                 VARCHAR(40)  NOT NULL,           -- id de raza o 'mestizo'
  raza_aprox           VARCHAR(40)  NULL,               -- solo mestizos: raza a la que más se parece
  edad_id              INT UNSIGNED NOT NULL,
  tamano_id            INT UNSIGNED NOT NULL,
  salud                VARCHAR(500) NOT NULL DEFAULT '',
  temperamento         VARCHAR(300) NOT NULL DEFAULT '',   -- texto libre de versiones anteriores
  salud_general        VARCHAR(20) NULL,                   -- opciones cerradas (server/util.js → OPCIONES_ANIMAL)
  tratamiento          VARCHAR(20) NULL,
  temp_general         VARCHAR(20) NULL,
  temp_perros          VARCHAR(20) NULL,
  temp_desconocidos    VARCHAR(20) NULL,
  temp_comida          VARCHAR(20) NULL,
  fecha_ingreso        DATE NOT NULL,
  esterilizado         TINYINT(1) NOT NULL DEFAULT 0,
  fecha_esterilizacion DATE NULL,
  foto                 VARCHAR(80) NULL,
  estado               ENUM('disponible','adoptado') NOT NULL DEFAULT 'disponible',
  adoptado_en          DATE NULL,
  eliminado            TINYINT(1) NOT NULL DEFAULT 0,
  eliminado_por        ENUM('refugio','admin') NULL,
  eliminado_motivo     VARCHAR(40)  NULL,
  eliminado_desc       VARCHAR(300) NULL,
  eliminado_en         DATETIME NULL,
  publicado_en         DATETIME NOT NULL,
  actualizado_en       DATETIME NOT NULL,
  KEY ix_catalogo (eliminado, estado, publicado_en),
  KEY ix_refugio (refugio_id),
  CONSTRAINT fk_ani_refugio FOREIGN KEY (refugio_id) REFERENCES refugios(usuario_id),
  CONSTRAINT fk_ani_edad    FOREIGN KEY (edad_id)    REFERENCES catalogo_valores(id),
  CONSTRAINT fk_ani_tamano  FOREIGN KEY (tamano_id)  REFERENCES catalogo_valores(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS requisitos (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  animal_id  INT UNSIGNED NOT NULL,
  nombre     VARCHAR(100) NOT NULL,
  tipo_id    INT UNSIGNED NOT NULL,
  CONSTRAINT fk_req_animal FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE,
  CONSTRAINT fk_req_tipo   FOREIGN KEY (tipo_id)   REFERENCES catalogo_valores(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS vacunas (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  animal_id  INT UNSIGNED NOT NULL,
  nombre     VARCHAR(60) NOT NULL,
  fecha      DATE NOT NULL,
  CONSTRAINT fk_vac_animal FOREIGN KEY (animal_id) REFERENCES animales(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Solicitudes y citas ----------
CREATE TABLE IF NOT EXISTS solicitudes (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  animal_id      INT UNSIGNED NOT NULL,
  adoptante_id   INT UNSIGNED NOT NULL,
  estado         ENUM('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
  motivo_rechazo VARCHAR(300) NULL,
  enviada_en     DATETIME NOT NULL,
  aprobada_en    DATETIME NULL,
  rechazada_en   DATETIME NULL,
  concretada_en  DATE NULL,
  KEY ix_animal_estado (animal_id, estado),
  KEY ix_adoptante_estado (adoptante_id, estado),
  CONSTRAINT fk_sol_animal    FOREIGN KEY (animal_id)    REFERENCES animales(id),
  CONSTRAINT fk_sol_adoptante FOREIGN KEY (adoptante_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS citas (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  solicitud_id  INT UNSIGNED NOT NULL,
  refugio_id    INT UNSIGNED NOT NULL,
  fecha         DATE NOT NULL,
  hora          CHAR(5) NOT NULL,
  creada_en     DATETIME NOT NULL,
  UNIQUE KEY uq_solicitud (solicitud_id),
  UNIQUE KEY uq_bloque (refugio_id, fecha, hora),
  CONSTRAINT fk_cit_solicitud FOREIGN KEY (solicitud_id) REFERENCES solicitudes(id),
  CONSTRAINT fk_cit_refugio   FOREIGN KEY (refugio_id)   REFERENCES refugios(usuario_id)
) ENGINE=InnoDB;

-- ---------- Fotos (se usan cuando el sitio corre en Vercel o con ALMACEN_FOTOS=bd) ----------
CREATE TABLE IF NOT EXISTS fotos (
  nombre     CHAR(37) PRIMARY KEY,
  tipo       VARCHAR(20) NOT NULL,
  datos      MEDIUMBLOB NOT NULL,
  creada_en  DATETIME NOT NULL
) ENGINE=InnoDB;

-- ---------- Notificaciones ----------
CREATE TABLE IF NOT EXISTS notificaciones (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT UNSIGNED NOT NULL,
  texto       VARCHAR(200) NOT NULL,
  leida       TINYINT(1) NOT NULL DEFAULT 0,
  creada_en   DATETIME NOT NULL,
  leida_en    DATETIME NULL,
  KEY ix_usuario (usuario_id, leida, creada_en),
  CONSTRAINT fk_not_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS errores_notificacion (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario_id  INT UNSIGNED NOT NULL,
  texto       VARCHAR(200) NOT NULL,
  detalle     VARCHAR(300) NOT NULL,
  creado_en   DATETIME NOT NULL,
  revisado    TINYINT(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB;

-- ---------- Reportes ----------
CREATE TABLE IF NOT EXISTS reportes (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  adoptante_id   INT UNSIGNED NOT NULL,
  objetivo_tipo  ENUM('animal','refugio') NOT NULL,
  objetivo_id    INT UNSIGNED NOT NULL,
  motivo         ENUM('Animal no doméstico','Contenido inapropiado','Información falsa','Otro') NOT NULL,
  descripcion    VARCHAR(300) NOT NULL,
  estado         ENUM('abierto','resuelto','descartado') NOT NULL DEFAULT 'abierto',
  nota           VARCHAR(300) NULL,
  admin_id       INT UNSIGNED NULL,
  creado_en      DATETIME NOT NULL,
  cerrado_en     DATETIME NULL,
  KEY ix_estado (estado, creado_en),
  CONSTRAINT fk_rep_adoptante FOREIGN KEY (adoptante_id) REFERENCES usuarios(id)
) ENGINE=InnoDB;

-- ---------- Sesiones y recuperación ----------
CREATE TABLE IF NOT EXISTS sesiones (
  token_hash        CHAR(64) PRIMARY KEY,
  usuario_id        INT UNSIGNED NOT NULL,
  creada_en         DATETIME NOT NULL,
  ultima_actividad  DATETIME NOT NULL,
  ip                VARCHAR(45) NULL,
  KEY ix_usuario (usuario_id),
  CONSTRAINT fk_ses_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS recuperaciones (
  token_hash  CHAR(64) PRIMARY KEY,
  usuario_id  INT UNSIGNED NOT NULL,
  expira_en   DATETIME NOT NULL,
  usado_en    DATETIME NULL,
  CONSTRAINT fk_rec_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Cuenta las solicitudes de enlace por correo (exista o no la cuenta) para el límite de 3 por hora
CREATE TABLE IF NOT EXISTS recuperacion_intentos (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  correo    VARCHAR(254) NOT NULL,
  creado_en DATETIME NOT NULL,
  KEY ix_correo (correo, creado_en)
) ENGINE=InnoDB;

-- ---------- Valores iniciales de catálogos (RF-29) ----------
INSERT IGNORE INTO catalogo_valores (catalogo, nombre, orden) VALUES
 ('tamano','Pequeño',1),('tamano','Mediano',2),('tamano','Grande',3),
 ('tipo_requisito','Texto',1),('tipo_requisito','Documental',2),
 ('edad','1 mes',1),('edad','2 meses',2),('edad','3 meses',3),('edad','4 meses',4),('edad','5 meses',5),
 ('edad','6 meses',6),('edad','7 meses',7),('edad','8 meses',8),('edad','9 meses',9),('edad','10 meses',10),
 ('edad','11 meses',11),('edad','1 año',12),('edad','2 años',13),('edad','3 años',14),('edad','4 años',15),
 ('edad','5 años',16),('edad','6 años',17),('edad','7 años',18),('edad','8 años',19),('edad','9 años',20),
 ('edad','10 años',21),('edad','11 años',22),('edad','12 años',23),('edad','13 años',24),('edad','14 años',25),
 ('edad','15 años',26),
 ('alcaldia','Álvaro Obregón',1),('alcaldia','Azcapotzalco',2),('alcaldia','Benito Juárez',3),
 ('alcaldia','Coyoacán',4),('alcaldia','Cuajimalpa de Morelos',5),('alcaldia','Cuauhtémoc',6),
 ('alcaldia','Gustavo A. Madero',7),('alcaldia','Iztacalco',8),('alcaldia','Iztapalapa',9),
 ('alcaldia','La Magdalena Contreras',10),('alcaldia','Miguel Hidalgo',11),('alcaldia','Milpa Alta',12),
 ('alcaldia','Tláhuac',13),('alcaldia','Tlalpan',14),('alcaldia','Venustiano Carranza',15),
 ('alcaldia','Xochimilco',16),
 ('vacuna','Antirrábica',1),
 ('vacuna','Parvovirus',2),
 ('vacuna','Moquillo',3),
 ('vacuna','Hepatitis canina',4),
 ('vacuna','Leptospirosis',5),
 ('vacuna','Parainfluenza',6),
 ('vacuna','Bordetella (tos de las perreras)',7),
 ('vacuna','Coronavirus canino',8),
 ('vacuna','Múltiple (quíntuple o séxtuple)',9);
