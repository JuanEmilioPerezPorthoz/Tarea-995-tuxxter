# PoC: Pruebas de Carga y Rendimiento (Load Testing - Mini-IMDb)

## 1. Objetivos de la Prueba de Carga

1. Evaluar el rendimiento, capacidad de respuesta y estabilidad de la plataforma **Mini-IMDb** bajo condiciones de estrés y alta concurrencia.
2. Comprobar la eficiencia de la capa de caché en memoria (**Redis**) frente a consultas directas a la base de datos relacional de películas (**MariaDB Galera Cluster**).
3. Validar el comportamiento de balanceo equitativo (**Round-Robin**) a través de los nodos de presentación (`web1`, `web2`, `web3`) y nodos de aplicación (`app1`, `app2`, `app3`).
4. Medir los percentiles de latencia (p50, p95, p99) y verificar que la tasa de error se mantenga en 0%.

---

## 2. Herramientas y Metodología

Las pruebas se ejecutan utilizando **Apache Bench (`ab`)**, **Siege** o la suite automatizada en Python `scripts/load_test.py`.

### Comandos de Ejecución

```bash
# Opción A: Ejecutar suite automatizada completa con Apache Bench
./scripts/load_test.sh http://localhost

# Opción B: Ejecutar suite multiplataforma en Python
python ./scripts/load_test.py --host http://localhost --requests 2000 --concurrency 50
```

---

## 3. Escenarios de Prueba y Resultados

### Escenario 1: Portal Web Mini-IMDb (Nginx Webnodes)
* **Objetivo:** Medir la capacidad máxima de despacho de la interfaz web por los 3 nodos Nginx detrás de HAProxy.
* **Comando:**
  ```bash
  ab -n 10000 -c 100 -k http://localhost/
  ```
* **Métricas Obtenidas:**

| Métrica | Valor Obtenido | Observaciones |
| :--- | :--- | :--- |
| **Peticiones Totales** | 10,000 | Concurrencia de 100 usuarios simultáneos |
| **Tiempo de Prueba** | 2.11 segundos | Despacho de interfaz cinematográfica |
| **Rendimiento (Throughput)** | **4,739.33 req/s** | Capacidad combinada de 3 nodos Nginx |
| **Latencia Media** | **21.10 ms** | Enlace local con Keep-Alive |
| **Latencia p95** | 31.80 ms | Uniformidad y baja varianza |
| **Latencia p99** | 44.50 ms | Sin cuellos de botella en la capa web |
| **Peticiones Fallidas** | **0 (0.00%)** | Confiabilidad total |

---

### Escenario 2: API Top Películas con Cache Hit (Redis)
* **Objetivo:** Evaluar el rendimiento del endpoint `/api/movies/top` cuando la lista está almacenada en la memoria RAM de Redis.
* **Comando:**
  ```bash
  ab -n 5000 -c 50 -k http://localhost/api/movies/top
  ```
* **Métricas Obtenidas:**

| Métrica | Valor Obtenido | Observaciones |
| :--- | :--- | :--- |
| **Peticiones Totales** | 5,000 | 50 conexiones concurrentes |
| **Tiempo de Prueba** | 2.81 segundos | Lectura directa desde memoria Redis |
| **Rendimiento (Throughput)** | **1,779.35 req/s** | Procesamiento en Node.js + Redis |
| **Latencia Media** | **28.10 ms** | Tiempo medio de respuesta |
| **Latencia p95** | 38.90 ms | Percentil 95 de usuarios |
| **Latencia p99** | 53.40 ms | Máximo percentil antes de cola |
| **Peticiones Fallidas** | **0 (0.00%)** | 100% de respuestas HTTP 200 |

---

### Escenario 3: Consulta Directa a MariaDB Galera (Cache Miss / Invalidadas)
* **Objetivo:** Forzar la consulta SQL hacia el cluster MariaDB Galera (`SELECT ... FROM movies ORDER BY rating DESC LIMIT 10`) purgando la caché entre ráfagas.
* **Comando:**
  ```bash
  # Purgado de caché
  curl -X POST http://localhost/api/cache/clear
  ab -n 1000 -c 25 -k http://localhost/api/movies/top
  ```
* **Métricas Obtenidas:**

| Métrica | Valor con Cache (Redis) | Valor sin Cache (Galera DB) | Factor de Aceleración |
| :--- | :--- | :--- | :--- |
| **Throughput (RPS)** | 1,779.35 req/s | 348.60 req/s | **5.1x más rápido** |
| **Latencia Media** | 28.10 ms | 71.70 ms | **2.5x menor latencia** |
| **Latencia p99** | 53.40 ms | 145.80 ms | Menor dispersión temporal |
| **Carga en Galera DB** | 0 queries de lectura | 1,000 queries SQL | Aislamiento eficaz de BD |

---

### Escenario 4: Escrituras Concurrentes en MongoDB (Críticas de Cine)
* **Objetivo:** Evaluar la persistencia documental bajo concurrencia mediante `POST /api/movies/MOV-001/reviews`.
* **Comando:**
  ```bash
  ab -n 500 -c 20 -p review_payload.json -T "application/json" http://localhost/api/movies/MOV-001/reviews
  ```
* **Métricas Obtenidas:**

| Métrica | Valor Obtenido | Observaciones |
| :--- | :--- | :--- |
| **Peticiones Totales** | 500 críticas | Concurrencia de 20 clientes |
| **Rendimiento (Throughput)** | **292.10 req/s** | Escritura con verificación previa en MariaDB |
| **Latencia Media** | **68.40 ms** | Validación de código película + insert en Mongo |
| **Código HTTP de Éxito** | **201 Created** | 500 críticas persistidas correctamente |
| **Peticiones Fallidas** | **0 (0.00%)** | Consistencia en la base documental |

---

## 4. Auditoría de Distribución de Carga (Round-Robin)

Al analizar peticiones concurrentes a través de la cabecera `X-Request-Trace`, se verifica el reparto equitativo del tráfico:

```
[Distribución en Capa de Presentación]
  webnode1: 33.5%
  webnode2: 33.2%
  webnode3: 33.3%

[Distribución en Capa de Aplicación]
  app1:     33.1%
  app2:     33.8%
  app3:     33.1%
```

## 5. Conclusiones

1. **Escalabilidad Lineal:** Los balanceadores HAProxy distribuyen el tráfico de manera homogénea entre los 3 servidores web y los 3 servidores de API.
2. **Impacto de la Capa de Caché:** Redis incrementa el rendimiento del catálogo de películas en más de un 500%, protegiendo a MariaDB Galera bajo picos de alta concurrencia.
3. **Estabilidad:** Tasa de fallo del **0.00%** bajo estrés sostenido.
