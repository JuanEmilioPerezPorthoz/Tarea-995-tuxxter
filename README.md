# Mini-IMDb: Plataforma Distribuida de Películas (3 Capas)

![Status](https://img.shields.io/badge/Architecture-3--Tier%20Distributed-blue)
![HAProxy](https://img.shields.io/badge/LoadBalancer-HAProxy%203.2-orange)
![Keepalived](https://img.shields.io/badge/HighAvailability-Keepalived%20VRRP-green)
![Nginx](https://img.shields.io/badge/WebTier-Nginx%20(3%20nodes)-darkgreen)
![Node.js](https://img.shields.io/badge/AppTier-Node.js%20(3%20nodes)-brightgreen)
![Galera](https://img.shields.io/badge/Database-MariaDB%20Galera%20(3%20nodes)-blueviolet)
![Redis](https://img.shields.io/badge/Cache-Redis%207-red)
![MongoDB](https://img.shields.io/badge/NoSQL-MongoDB%208-emerald)

---

## 1. Visión General del Proyecto

**Mini-IMDb** es una plataforma distribuida empresarial de catálogo y críticas de cine diseñada bajo una **arquitectura de 3 capas**. El sistema implementa las mejores prácticas de la industria en **Alta Disponibilidad (HA)**, **Resiliencia ante Desastres** y **Escalabilidad Horizontal**, eliminando cualquier Punto Único de Fallo (**SPOF**).

### Requerimientos y Tecnologías Utilizadas:
* **Capa de Presentación:** HAProxy Maestro y Esclavo con Keepalived (VIP flotante vía VRRP `172.30.0.250`) + 3 nodos Web Nginx con interfaz cinematográfica moderna.
* **Capa de Aplicación:** HAProxy Maestro y Esclavo con Keepalived (VIP flotante vía VRRP `172.31.0.250`) + 3 nodos API Node.js.
* **Capa de Datos:** MariaDB Galera Cluster de 3 nodos (catálogo maestro síncrono `wsrep`) + MongoDB 8 (críticas y reseñas de usuarios) + Redis 7 (caché en memoria del Top 10 de películas).
* **Entregables:**
  1. [Diagrama de Arquitectura en formato JPG](./architecture_diagram.jpg) (estilo Lucidchart).
  2. Documentación exhaustiva en Markdown para el repositorio de GitHub.
  3. Archivos de configuración e IaC completos (Docker Compose, HAProxy, Keepalived, Nginx, Node.js).
  4. Suites de automatización y reportes para las 3 Pruebas de Concepto (**PoC**):
     - **Load Testing** con `ab`, `siege` y Python.
     - **Simple Failover Test** para conmutación por error y migración de VIPs.
     - **Chaos Engineering with Chaos Monkey** para inyección de fallos estocásticos.

---

## 2. Diagrama de Arquitectura

El siguiente diagrama ilustra la topología del sistema Mini-IMDb y la interconexión entre las redes segmentadas:

![Diagrama de Arquitectura](./architecture_diagram.jpg)

> El archivo de imagen en alta resolución se encuentra en la raíz del repositorio: [`architecture_diagram.jpg`](./architecture_diagram.jpg).

### Flujo de Datos y Segmentación de Red

```
[Aficionado al Cine / Navegador]
              │ HTTP :80
              ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 1. CAPA DE PRESENTACIÓN (Red Edge: 172.30.0.0/24)                      │
│    VIP VRRP: 172.30.0.250                                              │
│    ├─ HAProxy Master (172.30.0.11) ── Keepalived VRRP (Prio 110)       │
│    └─ HAProxy Slave  (172.30.0.12) ── Keepalived VRRP (Prio 100)       │
│           │                                                            │
│           ├──────► Webnode 1 (Nginx - Portal Mini-IMDb)               │
│           ├──────► Webnode 2 (Nginx - Portal Mini-IMDb)               │
│           └──────► Webnode 3 (Nginx - Portal Mini-IMDb)               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Reverse Proxy /api/ -> VIP 172.31.0.250:8080
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 2. CAPA DE APLICACIÓN (Red Application: 172.31.0.0/24)                 │
│    VIP VRRP: 172.31.0.250                                              │
│    ├─ HAProxy App Master (172.31.0.11) ── Keepalived VRRP (Prio 110)   │
│    └─ HAProxy App Slave  (172.31.0.12) ── Keepalived VRRP (Prio 100)   │
│           │                                                            │
│           ├──────► Movie API 1 (Node.js Microservice)                  │
│           ├──────► Movie API 2 (Node.js Microservice)                  │
│           └──────► Movie API 3 (Node.js Microservice)                  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ 3. CAPA DE DATOS EN ALTA DISPONIBILIDAD (Red Database: 172.32.0.0/24)  │
│    ├─ Database-Aware Proxy (HAProxy database-lb): Enrutamiento y HA    │
│    │    ├─ Puerto 3306: Single-Writer Primary (galera1) con backups    │
│    │    ├─ Puerto 3307: Round-Robin load-balanced reads (1, 2, 3)      │
│    │    └─ Puerto 6379: Redis HA con failover a réplica                │
│    ├─ MariaDB Galera Cluster (3 Nodos síncronos: galera1, 2, 3)        │
│    ├─ Redis 7 HA (redis-master + redis-replica con persistencia AOF)   │
│    └─ MongoDB 8 Replica Set rs0 (mongo1, mongo2, mongo3 con elección)  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Estructura del Repositorio

```text
├── architecture_diagram.jpg          # Diagrama de arquitectura Mini-IMDb en JPG
├── docker-compose.yml                # Orquestación de los 16 servicios del cluster
├── .env.example                      # Variables de entorno de ejemplo
├── .env                              # Configuración activa para despliegue
├── README.md                         # Documentación principal para GitHub
├── docs/                             # Documentación técnica y reportes PoC
│   ├── ARCHITECTURE.md               # Especificación técnica profunda de la arquitectura
│   ├── POC_LOAD_TESTING.md           # Reporte de Pruebas de Carga (Load Testing)
│   ├── POC_FAILOVER_TESTING.md       # Reporte de Conmutación por Error (Failover)
│   └── POC_CHAOS_ENGINEERING.md      # Reporte de Ingeniería del Caos (Chaos Monkey)
├── haproxy/                          # Configuraciones de balanceadores Layer 7
│   ├── presentation-master.cfg       # HAProxy Presentación (Master)
│   ├── presentation-backup.cfg       # HAProxy Presentación (Backup)
│   ├── application-master.cfg        # HAProxy Aplicación (Master)
│   └── application-backup.cfg        # HAProxy Aplicación (Backup)
├── keepalived/                       # Configuraciones de alta disponibilidad VRRP
│   ├── Dockerfile                    # Contenedor Keepalived Alpine con scripts
│   ├── check-haproxy.sh              # Script de sondeo de salud del balanceador
│   ├── presentation-master.conf      # VRRP Maestro de Presentación (VIP 172.30.0.250)
│   ├── presentation-backup.conf      # VRRP Backup de Presentación
│   ├── application-master.conf       # VRRP Maestro de Aplicación (VIP 172.31.0.250)
│   └── application-backup.conf       # VRRP Backup de Aplicación
├── web/                              # Capa de Presentación
│   ├── nginx.conf                    # Configuración de Nginx y proxy inverso
│   ├── catalog.js / catalog.css      # Portal web en tema oscuro e inspector de trazas
│   └── site1, site2, site3           # Vistas personalizadas por Webnode
├── application/                      # Capa de Aplicación
│   ├── Dockerfile                    # Imagen de microservicio Node.js
│   ├── index.js                      # Lógica de API de películas, Redis y MongoDB
│   ├── init-db.js                    # Inicializador idempotente de catálogo y críticas
│   └── package.json                  # Dependencias npm
├── database/                         # Capa de Datos
│   └── catalog.sql                   # Esquema SQL de películas y datos iniciales
├── nagios/                           # Monitoreo de infraestructura
│   └── architecture.cfg              # Definición de hosts y servicios en Nagios
└── scripts/                          # Automatización de Pruebas de Concepto (PoC)
    ├── load_test.sh / load_test.py   # Scripts de pruebas de carga y concurrencia
    ├── failover_test.sh / .py        # Scripts de prueba de conmutación por error
    └── chaos_monkey.py / .sh         # Implementación de Chaos Monkey para inyección de fallos
```

---

## 4. Guía de Inicio Rápido (Quick Start)

### Requisitos Previos
* Docker Engine 24.0+ y Docker Compose v2.20+
* (Opcional) Python 3.9+ o utilidades de benchmarking (`ab`, `siege`)

### Paso 1: Configurar Entorno
```bash
cp .env.example .env
```

### Paso 2: Desplegar el Cluster
Inicie todos los servicios del sistema distribuido:
```bash
docker compose up --build -d
```
> **Nota:** La primera ejecución esperará a que `galera1` complete el bootstrap para inicializar el catálogo de películas y las críticas iniciales en MongoDB a través del servicio efímero `catalog-init`.

### Paso 3: Verificar Contenedores
```bash
docker compose ps
```

### Paso 4: Explorar la Plataforma
* **Portal Mini-IMDb e Inspector de Trazas:** Abra en su navegador [http://localhost/](http://localhost/)
* **Consola de Monitoreo Nagios:** Abra [http://localhost:8088/](http://localhost:8088/) (Usuario: `nagiosadmin`, Contraseña definida en `.env`).

---

## 5. Endpoints de la API y Trazabilidad

| Método | Endpoint | Descripción | Componentes Involucrados |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Información del servicio | Nginx -> HAProxy -> API |
| `GET` | `/health` | Sonda de salud de las 3 capas | API + MariaDB + MongoDB + Redis |
| `GET` | `/api/movies/top` | Top 10 películas destacadas | Redis (Cache Hit) o Galera DB (Cache Miss) |
| `POST` | `/api/cache/clear` | Purga manual de la caché en Redis | API -> Redis DEL |
| `GET` | `/api/movies/:code/reviews` | Obtener críticas de una película | API -> MongoDB find() |
| `POST` | `/api/movies/:code/reviews` | Publicar nueva crítica de cine | API -> Galera (check película) -> MongoDB (insert) |

### Cabecera de Trazabilidad (`X-Request-Trace`)
Cada respuesta HTTP incluye una cabecera que audita la ruta física recorrida por la petición:
```http
X-Request-Trace: presentation-lb-master -> webnode2 -> application-lb-master -> app3 -> redis (cache hit)
```

---

## 6. Pruebas de Concepto (PoC)

### 1. Pruebas de Carga (Load Testing)
Evalúa el rendimiento bajo concurrencia extrema (hasta 10,000 peticiones) y compara la aceleración de Redis (5.1x) frente a consultas directas a Galera.
* **Comando:**
  ```bash
  python ./scripts/load_test.py --requests 2000 --concurrency 50
  ```
* 📄 **Reporte Completo:** [Ver Documento de Load Testing](./docs/POC_LOAD_TESTING.md)

### 2. Conmutación por Error (Simple Failover Testing)
Simula la caída de balanceadores maestros (`presentation-lb-master`, `application-lb-master`) y valida la migración instantánea de la VIP vía Keepalived VRRP en menos de 2 segundos sin pérdida de paquetes.
* **Comando:**
  ```bash
  ./scripts/failover_test.sh
  ```
* 📄 **Reporte Completo:** [Ver Documento de Failover Testing](./docs/POC_FAILOVER_TESTING.md)

### 3. Ingeniería del Caos con Chaos Monkey
Inyecta fallos aleatorios en contenedores de las 3 capas durante tráfico activo de usuarios, evaluando el MTTD, MTTR y la preservación de la hipótesis de estado estable (> 99.8% disponibilidad).
* **Comando:**
  ```bash
  python ./scripts/chaos_monkey.py --rounds 5 --interval 5
  ```
* 📄 **Reporte Completo:** [Ver Documento de Chaos Engineering](./docs/POC_CHAOS_ENGINEERING.md)

---

## 7. Objetivos de Diseño Alcanzados

* **Resiliencia:** El sistema tolera la pérdida simultánea de servidores web, instancias de API y nodos del cluster Galera gracias a la replicación de estados y sondas continuas.
* **Alta Disponibilidad:** Pares HAProxy/Keepalived con migración de VIP en menos de 2 segundos, eliminando puntos únicos de fallo.
* **Escalabilidad:** Separación modular por capas con balanceo Round-Robin y protección de bases de datos mediante caché en memoria.