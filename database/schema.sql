

CREATE DATABASE IF NOT EXISTS `dopta`
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE `dopta`;

SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS usuarios (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    tipo VARCHAR(12) NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    correo VARCHAR(254) NOT NULL,
    hash VARCHAR(100) NOT NULL,
    estado VARCHAR(10) NOT NULL DEFAULT 'activa',
    aviso_version VARCHAR(10) NOT NULL,
    aviso_fecha DATETIME NOT NULL,
    creado DATETIME NOT NULL,
    verificado_en DATETIME NULL,
    rechazado_en DATETIME NULL,
    baja_en DATETIME NULL,
    purgar_en DATETIME NULL,
    purgado SMALLINT NOT NULL DEFAULT 0,
    eliminado_motivo VARCHAR(300) NULL,
    eliminado_en DATETIME NULL,
    telefono CHAR(10) NULL,
    mayor_edad_en DATETIME NULL,
    avatar_v INT NOT NULL DEFAULT 0,

    correo_vigente VARCHAR(254)
        GENERATED ALWAYS AS (
            IF(estado IN ('baja','eliminada'), NULL, correo)
        ) STORED,

    telefono_vigente CHAR(10)
        GENERATED ALWAYS AS (
            IF(estado IN ('baja','eliminada') OR telefono IS NULL, NULL, telefono)
        ) STORED,

    es_admin TINYINT
        GENERATED ALWAYS AS (
            IF(tipo = 'admin', 1, NULL)
        ) STORED,

    CONSTRAINT ck_usuarios_tipo
        CHECK (tipo IN ('adoptante','refugio','admin','funcionario')),

    CONSTRAINT ck_usuarios_estado
        CHECK (estado IN ('activa','pendiente','rechazada','baja','eliminada')),

    UNIQUE KEY uq_correo_vigente (correo_vigente),
    UNIQUE KEY uq_telefono_vigente (telefono_vigente),
    UNIQUE KEY uq_un_admin (es_admin),

    KEY ix_usuarios_correo (correo),
    KEY ix_usuarios_tipo_estado (tipo, estado)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE IF NOT EXISTS avatares (
    usuario_id INT NOT NULL PRIMARY KEY,
    tipo VARCHAR(20) NOT NULL,
    datos MEDIUMBLOB NOT NULL,
    creado_en DATETIME NOT NULL,

    FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 2. CATÁLOGOS
-- =========================================================

CREATE TABLE IF NOT EXISTS catalogo_valores (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    catalogo VARCHAR(20) NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    orden INT NOT NULL DEFAULT 0,
    activo SMALLINT NOT NULL DEFAULT 1,

    CONSTRAINT ck_catalogo
        CHECK (catalogo IN (
            'tamano',
            'edad',
            'tipo_requisito',
            'alcaldia',
            'vacuna',
            'documento'
        )),

    UNIQUE KEY uq_catalogo_nombre (catalogo, nombre)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 3. REFUGIOS
-- =========================================================

CREATE TABLE IF NOT EXISTS refugios (
    usuario_id INT NOT NULL PRIMARY KEY,
    institucion VARCHAR(120) NOT NULL,
    direccion VARCHAR(200) NOT NULL,
    calle VARCHAR(100) NULL,
    num_ext VARCHAR(10) NULL,
    num_int VARCHAR(10) NULL,
    colonia VARCHAR(80) NULL,
    cp CHAR(5) NULL,
    telefono CHAR(10) NOT NULL,
    alcaldia_id INT NULL,
    lat DECIMAL(9,6) NULL,
    lng DECIMAL(9,6) NULL,
    place_id VARCHAR(300) NULL,

    FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id),

    FOREIGN KEY (alcaldia_id)
        REFERENCES catalogo_valores(id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 4. HORARIOS DE REFUGIOS
-- dia: 0 = lunes, 6 = domingo
-- =========================================================

CREATE TABLE IF NOT EXISTS refugio_horarios (
    refugio_id INT NOT NULL,
    dia SMALLINT NOT NULL,
    cerrado SMALLINT NOT NULL DEFAULT 1,
    abre CHAR(5) NULL,
    cierra CHAR(5) NULL,

    PRIMARY KEY (refugio_id, dia),

    FOREIGN KEY (refugio_id)
        REFERENCES refugios(usuario_id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 5. CAMBIOS DE DATOS DE REFUGIOS
-- =========================================================

CREATE TABLE IF NOT EXISTS refugio_cambios (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    refugio_id INT NOT NULL,
    datos JSON NOT NULL,
    anteriores JSON NOT NULL,
    estado VARCHAR(10) NOT NULL DEFAULT 'pendiente',
    motivo VARCHAR(300) NULL,
    revisor_id INT NULL,
    creado_en DATETIME NOT NULL,
    revisado_en DATETIME NULL,

    pendiente_de INT
        GENERATED ALWAYS AS (
            IF(estado = 'pendiente', refugio_id, NULL)
        ) STORED,

    CONSTRAINT ck_cambios_estado
        CHECK (estado IN ('pendiente','aprobado','rechazado','cancelado')),

    UNIQUE KEY uq_un_cambio_pendiente (pendiente_de),

    FOREIGN KEY (refugio_id)
        REFERENCES refugios(usuario_id),

    FOREIGN KEY (revisor_id)
        REFERENCES usuarios(id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 6. ANIMALES
-- =========================================================

CREATE TABLE IF NOT EXISTS animales (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    refugio_id INT NOT NULL,
    nombre VARCHAR(50) NOT NULL,
    raza VARCHAR(40) NOT NULL,
    raza_aprox VARCHAR(40) NULL,
    edad_id INT NOT NULL,
    tamano_id INT NOT NULL,
    salud VARCHAR(500) NOT NULL DEFAULT '',
    temperamento VARCHAR(300) NOT NULL DEFAULT '',
    salud_general VARCHAR(20) NULL,
    tratamiento VARCHAR(20) NULL,
    temp_general VARCHAR(20) NULL,
    temp_perros VARCHAR(20) NULL,
    temp_desconocidos VARCHAR(20) NULL,
    temp_comida VARCHAR(20) NULL,
    fecha_ingreso DATE NOT NULL,
    esterilizado SMALLINT NOT NULL DEFAULT 0,
    fecha_esterilizacion DATE NULL,
    desparasitado SMALLINT NOT NULL DEFAULT 0,
    peso_kg DECIMAL(4,1) NULL,
    altura_cm SMALLINT NULL,
    estado VARCHAR(12) NOT NULL DEFAULT 'disponible',
    adoptado_en DATE NULL,
    eliminado SMALLINT NOT NULL DEFAULT 0,
    eliminado_por VARCHAR(12) NULL,
    eliminado_motivo VARCHAR(40) NULL,
    eliminado_desc VARCHAR(300) NULL,
    eliminado_en DATETIME NULL,
    publicado_en DATETIME NOT NULL,
    actualizado_en DATETIME NOT NULL,

    CONSTRAINT ck_animales_estado
        CHECK (estado IN ('disponible','adoptado')),

    CONSTRAINT ck_animales_elim
        CHECK (eliminado_por IN ('refugio','admin','funcionario')),

    KEY ix_animales_catalogo (eliminado, estado, publicado_en),
    KEY ix_animales_refugio (refugio_id),

    FOREIGN KEY (refugio_id)
        REFERENCES refugios(usuario_id),

    FOREIGN KEY (edad_id)
        REFERENCES catalogo_valores(id),

    FOREIGN KEY (tamano_id)
        REFERENCES catalogo_valores(id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 7. REQUISITOS DE ADOPCIÓN
-- =========================================================

CREATE TABLE IF NOT EXISTS requisitos (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    animal_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    tipo_id INT NOT NULL,
    otro SMALLINT NOT NULL DEFAULT 0,

    FOREIGN KEY (animal_id)
        REFERENCES animales(id)
        ON DELETE CASCADE,

    FOREIGN KEY (tipo_id)
        REFERENCES catalogo_valores(id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 8. VACUNAS
-- =========================================================

CREATE TABLE IF NOT EXISTS vacunas (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    animal_id INT NOT NULL,
    nombre VARCHAR(60) NOT NULL,
    fecha DATE NOT NULL,

    FOREIGN KEY (animal_id)
        REFERENCES animales(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 9. SOLICITUDES DE ADOPCIÓN
-- =========================================================

CREATE TABLE IF NOT EXISTS solicitudes (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    animal_id INT NOT NULL,
    adoptante_id INT NOT NULL,
    estado VARCHAR(10) NOT NULL DEFAULT 'pendiente',
    motivo_rechazo VARCHAR(300) NULL,
    cuestionario JSON NULL,
    compromiso_en DATETIME NULL,
    enviada_en DATETIME NOT NULL,
    aprobada_en DATETIME NULL,
    rechazada_en DATETIME NULL,
    visita VARCHAR(12) NULL,
    visita_en DATE NULL,
    concretada_en DATE NULL,
    entrega JSON NULL,

    CONSTRAINT ck_sol_estado
        CHECK (estado IN ('pendiente','aprobada','rechazada','cancelada')),

    CONSTRAINT ck_sol_visita
        CHECK (visita IN ('realizada','no_requerida','no_apta')),

    KEY ix_sol_animal_estado (animal_id, estado),
    KEY ix_sol_adoptante_estado (adoptante_id, estado),

    FOREIGN KEY (animal_id)
        REFERENCES animales(id),

    FOREIGN KEY (adoptante_id)
        REFERENCES usuarios(id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 10. MENSAJES
-- =========================================================

CREATE TABLE IF NOT EXISTS mensajes (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    solicitud_id INT NOT NULL,
    autor_id INT NOT NULL,
    texto VARCHAR(500) NOT NULL,
    creado_en DATETIME NOT NULL,
    leido_en DATETIME NULL,

    KEY ix_mensajes_solicitud (solicitud_id, creado_en),

    FOREIGN KEY (solicitud_id)
        REFERENCES solicitudes(id)
        ON DELETE CASCADE,

    FOREIGN KEY (autor_id)
        REFERENCES usuarios(id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 11. CITAS
-- =========================================================

CREATE TABLE IF NOT EXISTS citas (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    solicitud_id INT NOT NULL,
    refugio_id INT NOT NULL,
    fecha DATE NOT NULL,
    hora CHAR(5) NOT NULL,
    creada_en DATETIME NOT NULL,

    UNIQUE KEY uq_cita_solicitud (solicitud_id),
    UNIQUE KEY uq_cita_bloque (refugio_id, fecha, hora),

    FOREIGN KEY (solicitud_id)
        REFERENCES solicitudes(id),

    FOREIGN KEY (refugio_id)
        REFERENCES refugios(usuario_id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 12. SEGUIMIENTOS
-- =========================================================

CREATE TABLE IF NOT EXISTS seguimientos (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    solicitud_id INT NOT NULL,
    etapa VARCHAR(10) NOT NULL,
    programado DATE NOT NULL,
    realizado_en DATE NULL,
    resultado VARCHAR(12) NULL,
    notas VARCHAR(300) NULL,
    avisado SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT ck_seg_etapa
        CHECK (etapa IN ('1_semana','1_mes','3_meses')),

    CONSTRAINT ck_seg_resultado
        CHECK (resultado IN ('bien','con_dudas','problema','sin_contacto')),

    UNIQUE KEY uq_seg_etapa (solicitud_id, etapa),

    FOREIGN KEY (solicitud_id)
        REFERENCES solicitudes(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 13. NOTIFICACIONES
-- =========================================================

CREATE TABLE IF NOT EXISTS notificaciones (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    texto VARCHAR(200) NOT NULL,
    enlace VARCHAR(200) NULL,
    leida SMALLINT NOT NULL DEFAULT 0,
    creada_en DATETIME NOT NULL,
    leida_en DATETIME NULL,

    KEY ix_notif_usuario (usuario_id, leida, creada_en),

    FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 14. ERRORES DE NOTIFICACIÓN
-- =========================================================

CREATE TABLE IF NOT EXISTS errores_notificacion (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    texto VARCHAR(200) NOT NULL,
    detalle VARCHAR(300) NOT NULL,
    creado_en DATETIME NOT NULL,
    revisado SMALLINT NOT NULL DEFAULT 0

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 15. REPORTES
-- =========================================================

CREATE TABLE IF NOT EXISTS reportes (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    autor_id INT NOT NULL,
    objetivo_tipo VARCHAR(10) NOT NULL,
    objetivo_id INT NOT NULL,
    motivo VARCHAR(40) NOT NULL,
    descripcion VARCHAR(300) NOT NULL,
    estado VARCHAR(10) NOT NULL DEFAULT 'abierto',
    nota VARCHAR(300) NULL,
    admin_id INT NULL,
    creado_en DATETIME NOT NULL,
    cerrado_en DATETIME NULL,

    CONSTRAINT ck_rep_objetivo
        CHECK (objetivo_tipo IN ('animal','refugio','usuario')),

    CONSTRAINT ck_rep_estado
        CHECK (estado IN ('abierto','resuelto','descartado')),

    KEY ix_reportes_estado (estado, creado_en),

    FOREIGN KEY (autor_id)
        REFERENCES usuarios(id)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 16. SESIONES
-- =========================================================

CREATE TABLE IF NOT EXISTS sesiones (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    usuario_id INT NOT NULL,
    creada_en DATETIME NOT NULL,
    ultima_actividad DATETIME NOT NULL,
    ip VARCHAR(45) NULL,

    KEY ix_sesiones_usuario (usuario_id),

    FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 17. RECUPERACIÓN DE CONTRASEÑAS
-- =========================================================

CREATE TABLE IF NOT EXISTS recuperaciones (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    usuario_id INT NOT NULL,
    expira_en DATETIME NOT NULL,
    usado_en DATETIME NULL,

    FOREIGN KEY (usuario_id)
        REFERENCES usuarios(id)
        ON DELETE CASCADE

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 18. INTENTOS DE RECUPERACIÓN
-- =========================================================

CREATE TABLE IF NOT EXISTS recuperacion_intentos (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    correo VARCHAR(254) NOT NULL,
    creado_en DATETIME NOT NULL,

    KEY ix_recup_correo (correo, creado_en)

) ENGINE=InnoDB DEFAULT CHARACTER SET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- =========================================================
-- 19. DATOS INICIALES DE CATÁLOGOS
-- =========================================================

INSERT IGNORE INTO catalogo_valores (catalogo, nombre, orden) VALUES

-- Tamaños
('tamano','Pequeño',1),
('tamano','Mediano',2),
('tamano','Grande',3),

-- Tipos de requisito
('tipo_requisito','Texto',1),
('tipo_requisito','Documental',2),

-- Edades
('edad','1 mes',1),
('edad','2 meses',2),
('edad','3 meses',3),
('edad','4 meses',4),
('edad','5 meses',5),
('edad','6 meses',6),
('edad','7 meses',7),
('edad','8 meses',8),
('edad','9 meses',9),
('edad','10 meses',10),
('edad','11 meses',11),
('edad','1 año',12),
('edad','2 años',13),
('edad','3 años',14),
('edad','4 años',15),
('edad','5 años',16),
('edad','6 años',17),
('edad','7 años',18),
('edad','8 años',19),
('edad','9 años',20),
('edad','10 años',21),
('edad','11 años',22),
('edad','12 años',23),
('edad','13 años',24),
('edad','14 años',25),
('edad','15 años',26),

-- Alcaldías
('alcaldia','Álvaro Obregón',1),
('alcaldia','Azcapotzalco',2),
('alcaldia','Benito Juárez',3),
('alcaldia','Coyoacán',4),
('alcaldia','Cuajimalpa de Morelos',5),
('alcaldia','Cuauhtémoc',6),
('alcaldia','Gustavo A. Madero',7),
('alcaldia','Iztacalco',8),
('alcaldia','Iztapalapa',9),
('alcaldia','La Magdalena Contreras',10),
('alcaldia','Miguel Hidalgo',11),
('alcaldia','Milpa Alta',12),
('alcaldia','Tláhuac',13),
('alcaldia','Tlalpan',14),
('alcaldia','Venustiano Carranza',15),
('alcaldia','Xochimilco',16),

-- Vacunas
('vacuna','Antirrábica',1),
('vacuna','Parvovirus',2),
('vacuna','Moquillo',3),
('vacuna','Hepatitis canina',4),
('vacuna','Leptospirosis',5),
('vacuna','Parainfluenza',6),
('vacuna','Bordetella (tos de las perreras)',7),
('vacuna','Coronavirus canino',8),
('vacuna','Múltiple (quíntuple o séxtuple)',9),

-- Documentos
('documento','Identificación oficial vigente (INE o pasaporte)',1),
('documento','Comprobante de domicilio reciente',2),
('documento','CURP',3),
('documento','Comprobante de ingresos',4),
('documento','Carta responsiva de adopción firmada',5),
('documento','Fotografías del espacio donde vivirá',6),
('documento','Dos referencias personales con teléfono',7),
('documento','Permiso del arrendador (si rentas)',8),
('documento','Aceptación de todos los que viven en el hogar',9);


-- =========================================================
-- 20. VERIFICACIÓN FINAL
-- =========================================================

SELECT DATABASE() AS base_seleccionada;

SELECT COUNT(*) AS tablas_creadas
FROM information_schema.tables
WHERE table_schema = DATABASE()
AND table_type = 'BASE TABLE';

SELECT catalogo, COUNT(*) AS valores_cargados
FROM catalogo_valores
GROUP BY catalogo
ORDER BY catalogo;