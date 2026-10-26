# Mini-IMDb: Plataforma Distribuida de Películas (3 Capas)

---

## 1. Introducción a la Arquitectura de 3 Capas

Una **arquitectura de 3 capas (Three-Tier Architecture)** es un patrón de diseño de sistemas distribuidos que organiza una aplicación en tres niveles lógicos y funcionales independientes:

1. **Capa de Presentación (Frontend / Borde):** Es la interfaz accesible por el usuario final (servidores web Nginx y balanceadores de entrada). Se encarga de entregar la interfaz gráfica y recibir las solicitudes HTTP de los clientes.
2. **Capa de Aplicación (Lógica de Negocio / Backend):** Es el núcleo de procesamiento de la plataforma (microservicios en Node.js y balanceadores internos). Ejecuta las reglas de negocio, procesa consultas y coordina el acceso a los datos.
3. **Capa de Datos (Persistencia / Almacenamiento):** Gestiona el almacenamiento de datos relacionales, documentos NoSQL y memoria intermedia (MariaDB Galera Cluster, MongoDB Replica Set y Redis HA).

**Beneficios principales:**
* **Alta Disponibilidad:** Si un nodo o componente falla, las demás capas permanecen aisladas y operativas sin caídas en cascada.
* **Escalabilidad Independiente:** Cada capa puede escalarse horizontalmente (añadiendo más réplicas de Nginx o de Node.js) según la demanda específica de tráfico.
* **Seguridad y Aislamiento:** Las bases de datos residen en redes internas privadas sin exposición directa hacia internet.

---

## 2. Visión General del Proyecto

**Mini-IMDb** es una plataforma distribuida empresarial de catálogo y críticas de cine diseñada bajo esta arquitectura de 3 capas. El sistema implementa las mejores prácticas de la industria en **Alta Disponibilidad (HA)**, **Resiliencia ante Desastres** y **Escalabilidad Horizontal**, eliminando cualquier Punto Único de Fallo (**SPOF**).

### Requerimientos y Tecnologías Utilizadas:
* **Pasarela de Borde (Edge Gateway):** `entry-proxy` público en puerto `80:80` (HAProxy modo TCP) que canaliza el tráfico exterior de forma transparente hacia la VIP de Keepalived.
* **Capa de Presentación:** HAProxy Maestro y Esclavo con Keepalived (VIP flotante vía VRRP `172.30.0.250`) + 3 nodos Web Nginx con interfaz cinematográfica moderna.
* **Capa de Aplicación:** HAProxy Maestro y Esclavo con Keepalived (VIP flotante vía VRRP `172.31.0.250`) + 3 nodos API Node.js.
* **Capa de Datos:** MariaDB Galera Cluster de 3 nodos (catálogo maestro síncrono `wsrep`) + MongoDB 8 (críticas y reseñas de usuarios) + Redis 7 (caché en memoria del Top 10 de películas).
* **Entregables:**
  1. [Diagrama de Arquitectura en formato JPG](./architecture_diagram.jpeg) (estilo Lucidchart).
  2. Documentación técnica y reportes de pruebas en Markdown.
  3. Archivos de configuración e IaC completos (Docker Compose, HAProxy, Keepalived, Nginx, Node.js).
  4. Suites de automatización y reportes para las 3 Pruebas de Concepto (**PoC**):
     - **Load Testing** con `ab`, `siege` y Python.
     - **Simple Failover Test** para conmutación por error y migración de VIPs.
     - **Chaos Engineering with Chaos Monkey** para inyección de fallos estocásticos.

---

## 3. Diagrama de Arquitectura

El siguiente diagrama ilustra la topología del sistema Mini-IMDb y la interconexión entre las capas:

![Diagrama de Arquitectura](./diagrama.jpeg)

> El archivo de imagen en alta resolución se encuentra en la raíz del repositorio: [`diagrama.jpeg`](./diagrama.jpeg).

---

## 4. Guía de Inicio Rápido (Quick Start)

### Requisitos Previos
* Docker Engine 24.0+ y Docker Compose v2.20+
* Python 3.9+ (para ejecutar scripts de prueba)

### Paso 1: Configurar Entorno
```bash
cp .env
```

### Paso 2: Desplegar el Clúster
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
* **Portal Mini-IMDb e Inspector de Trazas:** Abra en su navegador [http://localhost/](http://localhost/) (o la IP local del servidor en la red LAN).
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
Evalúa el rendimiento bajo concurrencia extrema (hasta 2,000 peticiones con 50 hilos) y compara la aceleración de Redis (5.1x) frente a consultas directas a Galera.
* **Comando:**
  ```bash
  python ./scripts/load_test.py --requests 2000 --concurrency 50
  ```

### 2. Conmutación por Error (Simple Failover Testing)
Simula la caída de balanceadores maestros (`presentation-lb-master`, `application-lb-master`) y valida la migración instantánea de la VIP vía Keepalived VRRP en menos de 2 segundos sin pérdida de paquetes ni errores 502/503.
* **Comando:**
  ```bash
  ./scripts/failover_test.sh
  ```

### 3. Ingeniería del Caos con Chaos Monkey
Inyecta fallos aleatorios en caliente sobre contenedores de las 3 capas durante tráfico activo de usuarios, evaluando el MTTD, MTTR y la preservación de la hipótesis de estado estable (86.67% de disponibilidad global con 100% de integridad de datos).
* **Comando:**
  ```bash
  python3 ./scripts/chaos_monkey.py --rounds 5 --interval 5
  ```
* 📄 **Reporte Completo:** [Informe General de Resultados](https://github.com/dangwii/sistemadistribuido3capas/wiki/Informe-de-PoC-del-Sistema).

---

## 7. Objetivos de Diseño Alcanzados

* **Resiliencia:** El sistema tolera la pérdida simultánea de servidores web, instancias de API y nodos del clúster Galera gracias a la replicación de estados, quórum síncrono y sondas de autocuración de HAProxy.
* **Alta Disponibilidad:** Pares HAProxy/Keepalived con migración de VIP en menos de 2 segundos y pasarela Entry-Proxy, eliminando puntos únicos de fallo (SPOF) en todas las capas.
* **Escalabilidad:** Separación modular por capas con balanceo Round-Robin verificado y protección de bases de datos mediante caché en memoria Redis (>710 RPS soportados).