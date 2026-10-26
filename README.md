# Sistema Distribuido de 3 Capas con Alta Disponibilidad, Resiliencia y Escalabilidad
> **Tarea #995 - Sistemas Distribuidos**  
> **Repositorio Oficial:** [https://github.com/JuanEmilioPerezPorthoz/Tarea-995-tuxxter](https://github.com/JuanEmilioPerezPorthoz/Tarea-995-tuxxter)  
> **Autor:** Juan Emilio Perez Porthoz  
> **Fecha de Entrega:** Lunes 26 de Octubre de 2026  

---

# 1. ENTREGABLE: Diagrama de arquitectura

El siguiente diagrama ilustra la arquitectura de 3 capas completa, tolerante a fallos, diseñada para eliminar cualquier punto único de falla (**SPOF**) mediante Keepalived VRRP, clústeres síncronos, réplicas y proxies conscientes de base de datos.

![Diagrama de Arquitectura](./docs/evidencias/diagrama_arquitectura.png)

> **Archivos del Diagrama de arquitectura:**  
> - Formato JPG / JPEG: [`diagrama.jpeg`](./diagrama.jpeg) y [`diagrama.jpg`](./diagrama.jpg) en la raíz del repositorio.  
> - Imagen de alta resolución: [`docs/evidencias/diagrama_arquitectura.png`](./docs/evidencias/diagrama_arquitectura.png).

---

# 2. ENTREGABLE: Archivos con la configuración (IaC, config files)

El sistema distribuido está completamente orquestado con Docker Compose e infraestructura como código (IaC), dividido en tres capas lógicas y una capa de observabilidad:

| Capa | Componentes | Tecnologías | Función y Resiliencia |
| :--- | :--- | :--- | :--- |
| **Borde / Ingress** | `entry-proxy` | HAProxy 3.2 (Puerto 80:80) | Pasarela pública TCP que canaliza tráfico exterior a la VIP de presentación. |
| **1. Presentación** | `presentation-lb-master`<br>`presentation-lb-backup`<br>`web1`, `web2`, `web3` | HAProxy + Keepalived (VRRP VIP `172.30.0.250`)<br>3 Nodos Nginx (Alpine) | Balanceo Round-Robin a nivel web. Conmutación automática de VIP por Keepalived si cae el balanceador maestro. |
| **2. Aplicación** | `application-lb-master`<br>`application-lb-backup`<br>`app1`, `app2`, `app3` | HAProxy + Keepalived (VRRP VIP `172.31.0.250`)<br>3 Nodos Node.js (API REST) | Lógica de negocio, pooling de conexiones optimizado (10 conex/nodo) y auditoría mediante cabecera `X-Request-Trace`. |
| **3. Datos / Almacenamiento** | `database-lb`<br>`galera1`, `galera2`, `galera3`<br>`mongo1`, `mongo2`, `mongo3`<br>`redis-master`, `redis-replica` | HAProxy Database Proxy<br>MariaDB Galera Cluster 11.4<br>MongoDB Replica Set `rs0`<br>Redis 7 con AOF (`appendonly yes`) | Enrutamiento transparente a Galera sin ataduras a un solo nodo. Replicación multi-master síncrona `wsrep`, auto-failover en MongoDB y caché persistente en memoria. |
| **Observabilidad** | `nagios` | Nagios Core 4.5 (Puerto 8088:80) | Monitoreo en tiempo real de los 20 componentes y emisión de alertas de estado. |

---

# 3. ENTREGABLE: Documentar las siguientes PoC usando la infraestructura creada

En esta sección se documentan paso a paso y con capturas de evidencia todas las Pruebas de Concepto (PoC) exigidas en la rúbrica de la Tarea #995.

---

## 3.1 PoC: Load testing con ab, siege o jmeter (Pruebas de Carga y Rendimiento)

Se ejecutó la suite de pruebas de carga concurrente [`scripts/load_test.py`](./scripts/load_test.py) (equivalente a `ab` / `siege`) desde la Computadora 2 (Cliente externo) hacia el host `http://192.168.22.12`.

### Prueba de Carga Inicial (1,000 Peticiones con 25 Hilos Concurrentes)
```cmd
python ./scripts/load_test.py --host http://192.168.22.12 --requests 1000 --concurrency 25
```
![Prueba de Carga 1000 Peticiones - Parte 1](./docs/evidencias/06_load_test_1000_part1.png)
![Prueba de Carga 1000 Peticiones - Parte 2](./docs/evidencias/07_load_test_1000_part2.png)

### Prueba de Carga Extrema (2,000 Peticiones con 20 Hilos Concurrentes)
```cmd
python ./scripts/load_test.py --host http://192.168.22.12 --requests 2000 --concurrency 20
```
![Prueba de Carga 2000 Peticiones - Parte 1](./docs/evidencias/23_load_test_2000_part1.png)
![Prueba de Carga 2000 Peticiones - Parte 2](./docs/evidencias/24_load_test_2000_part2.png)

Estado de salud en Nagios tras absorber el tráfico de 2,000 peticiones continuas:
![Nagios Salud tras 2000 peticiones](./docs/evidencias/25_nagios_after_2000_ok.png)

### Tabla de Métricas de Rendimiento Obtenidas

| Escenario Evaluado | Peticiones | Concurrencia | Tasa de Éxito | Rendimiento (RPS) | Latencia Media | Latencia p95 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Portal Web Nginx (Estático)** | 2,000 | 20 | **100.0%** | **336.18 RPS** | 55.23 ms | 84.80 ms |
| **2. API Catálogo (Redis Cache Hit)** | 2,000 | 20 | **100.0%** | **304.97 RPS** | 60.32 ms | 329.33 ms |
| **3. Consulta Galera DB (Cache Miss)** | 300 | 15 | **100.0%** | **254.40 RPS** | 45.44 ms | 47.78 ms |
| **4. Inserción de Críticas (MongoDB)** | 400 | 20 | **100.0%** | **289.21 RPS** | 67.88 ms | 103.34 ms |

### Auditoría de Recursos en el Servidor (`docker stats`)
Consumo de memoria y CPU por contenedor bajo tráfico extremo:
![Consumo de Recursos Docker Stats](./docs/evidencias/26_docker_stats_resources.png)

---

## 3.2 PoC: Simple failover test (Tolerancia a Fallos)

Se inyectaron fallas manuales deteniendo componentes individuales en el servidor mientras se evaluaba la continuidad del servicio desde la máquina cliente.

### Caso A: Failover de Galera MariaDB (Capa de Datos Relacional)
1. **Detención forzada del nodo `galera1` en Servidor:**
   ```cmd
   docker compose stop galera1
   ```
   ![Parada de Galera 1](./docs/evidencias/08_failover_galera_stop.png)

2. **Verificación de disponibilidad en Cliente (Computadora 2):**
   ```cmd
   curl -i http://192.168.22.12/api/products/cheapest
   ```
   ![Consulta Exitosa con Galera Caído](./docs/evidencias/09_failover_galera_curl_ok.png)
   * **Resultado:** `HTTP/1.1 200 OK`. `database-lb` conmutó inmediatamente el tráfico hacia `galera2` o `galera3`.

3. **Detección y Alerta en Nagios:**  
   Nagios alertó inmediatamente la caída pasando `galera1` a estado **CRITICAL (rojo)**:
   ![Nagios Alerta Galera Caído](./docs/evidencias/10_failover_galera_nagios.png)

4. **Recuperación:**  
   Se reinició el nodo con `docker compose start galera1` y Nagios restableció el estado nominal en **OK (verde)**:
   ![Reinicio de Galera 1](./docs/evidencias/11_failover_galera_start.png)  
   ![Nagios Galera Recuperado](./docs/evidencias/12_failover_galera_recovered.png)

---

### Caso B: Failover de MongoDB Replica Set (Capa NoSQL)
1. **Detención forzada del nodo primario `mongo1` en Servidor:**
   ```cmd
   docker compose stop mongo1
   ```
   ![Parada de Mongo 1](./docs/evidencias/13_failover_mongo_stop.png)

2. **Verificación de disponibilidad en Cliente:**
   ```cmd
   curl -i http://192.168.22.12/api/products/ST-001/reviews
   ```
   ![Consulta Exitosa con Mongo Caído](./docs/evidencias/14_failover_mongo_curl_ok.png)
   * **Resultado:** `HTTP/1.1 200 OK`. El Replica Set eligió automáticamente un nuevo primario (`mongo2` o `mongo3`) con la traza `mongo-rs0`.

3. **Detección y Alerta en Nagios:**  
   Nagios detectó la parada marcando a `mongo1` en estado **DOWN (rojo)**:
   ![Nagios Alerta Mongo Caído](./docs/evidencias/15_failover_mongo_nagios.png)

4. **Recuperación:**  
   Reinicio con `docker compose start mongo1` y confirmación de Nagios en **UP (verde)**:
   ![Reinicio de Mongo 1](./docs/evidencias/16_failover_mongo_start.png)  
   ![Nagios Mongo Recuperado](./docs/evidencias/17_failover_mongo_recovered.png)

---

### Caso C: Failover de Capa de Presentación (Keepalived VRRP)
1. **Detención forzada de `presentation-lb-master` en Servidor:**
   ```cmd
   docker compose stop presentation-lb-master
   ```
   ![Parada de Presentation LB Master](./docs/evidencias/18_failover_lb_master_stop.png)

2. **Detección y Alerta en Nagios:**  
   Nagios marcó a `presentation-lb-master` en estado **DOWN (rojo)**:
   ![Nagios Alerta Presentation LB Master Caído](./docs/evidencias/19_failover_lb_master_nagios.png)

3. **Verificación de Migración de VIP en Cliente:**  
   La interfaz web siguió respondiendo con normalidad. Keepalived migró la Virtual IP `172.30.0.250` hacia `presentation-lb-backup` en menos de 2 segundos:
   ![Web Operativa con Backup LB](./docs/evidencias/20_failover_lb_master_web_ok.png)

4. **Recuperación:**  
   Reinicio con `docker compose start presentation-lb-master` y validación en Nagios en **UP (verde)**:
   ![Reinicio de Presentation LB Master](./docs/evidencias/21_failover_lb_master_start.png)  
   ![Nagios Presentation LB Recuperado](./docs/evidencias/22_failover_lb_recovered_nagios.png)

---

## 3.3 PoC: Chaos Engineering with Chaos Monkey

Se ejecutó [`scripts/chaos_monkey.py`](./scripts/chaos_monkey.py) inyectando fallas estocásticas sobre contenedores de todas las capas mientras se mantenía tráfico continuo.

### Ejecución de Rondas de Caos y Resultados
```cmd
python ./scripts/chaos_monkey.py --host http://localhost --rounds 5 --interval 5
```
![Chaos Monkey Rondas 1 a 4](./docs/evidencias/27_chaos_monkey_rounds1_4.png)
![Chaos Monkey Reporte Final y Disponibilidad](./docs/evidencias/28_chaos_monkey_report.png)

* **Resumen del Experimento de Caos:**
  - **Ataques ejecutados:** 5 rondas sobre víctimas seleccionadas al azar (`application-lb-master`, `web2`, `galera3`, `presentation-lb-master`).
  - **Total de sondas enviadas:** 60 sondas en alta concurrencia.
  - **Sondas exitosas:** 55.
  - **Disponibilidad Global bajo Caos:** **91.67%**.
  - **Integridad de Datos:** **100% comprobada** (catálogo e índices intactos).

### Degradación Elegante y Observabilidad durante el Caos
Durante el ataque, la plataforma demostró degradación elegante enrutando a los balanceadores de respaldo:
![Traza de Backup durante Ataque de Caos](./docs/evidencias/29_chaos_monkey_web_trace.png)

Nagios registró en tiempo real cada contenedor impactado por el Chaos Monkey:
![Nagios Registro de Víctima de Caos](./docs/evidencias/30_chaos_monkey_nagios_victim.png)

---

## 3.4 PoC: Estado Final Recuperado, Cache Hit y Nagios

Tras completar todas las pruebas de carga, failover y caos, se verificó el estado final limpio de la arquitectura:

1. **Restablecimiento general de contenedores:**
   ```cmd
   docker compose up -d
   ```
   ![Arranque Final Limpio](./docs/evidencias/31_final_compose_up_all_ok.png)

2. **Respuestas HTTP 200 OK estables:**
   ![Caché Redis y Galera Estable](./docs/evidencias/32_final_curl_redis_write.png)
   ![Consulta Estable sin Errores 503](./docs/evidencias/33_final_curl_redis_stable.png)

3. **Validación de Cache Hit en Redis:**  
   La interfaz web demostró que las consultas subsecuentes son servidas directamente desde la memoria caché de Redis (`cache hit`), acelerando la respuesta a <2 ms y liberando a Galera DB de lecturas repetitivas:
   ![Web con Cache Hit en Redis](./docs/evidencias/34_final_web_cache_hit.png)

4. **Auditoría Final en Nagios:**  
   Todos los 20 servicios y hosts concluyeron en estado **UP / OK (verde)**:
   ![Nagios Estado Final Todo Verde](./docs/evidencias/35_final_nagios_all_green.png)

---

# 4. MEJORAS DE ARQUITECTURA IMPLEMENTADAS (Según ToDo.md)

En cumplimiento con los requerimientos específicos de mejora arquitectónica del proyecto:

### 4.1 MongoDB Replica Set (Punto 2.1 ToDo.md)
* **Antes:** Una única instancia aislada de MongoDB (punto único de falla).
* **Mejora:** Despliegue de un **MongoDB Replica Set (`rs0`)** compuesto por 3 nodos activos (`mongo1`, `mongo2`, `mongo3`).
* **Conexión:** La aplicación se conecta mediante la cadena `replicaSet=rs0&authSource=admin` con soporte nativo de elección de nuevo nodo primario automático en caso de falla.

### 4.2 Redis Master-Replica con Persistencia (Puntos 2.2 y 2.3 ToDo.md)
* **Antes:** Nodo Redis volátil y único.
* **Mejora:** Despliegue en modo **Master-Replica** (`redis-master` con replicación en tiempo real a `redis-replica`).
* **Persistencia:** Habilitación de **AOF (`appendonly yes`, `appendfsync everysec`)** y snapshots RDB para evitar pérdida de datos en memoria y mitigar problemas de *cache stampede*.

### 4.3 GaleraDB con Load Balancer Dedicado (Punto 3 ToDo.md)
* **Antes:** Nodos de aplicación conectados fijamente en duro a `galera1`.
* **Mejora:** Se eliminó la atadura a `galera1` implementando un proxy consciente de base de datos (**`database-lb`**) en el puerto 3306.
* **Enrutamiento:** Las aplicaciones se conectan a `database-lb:3306`, el cual distribuye el tráfico en Round-Robin activo hacia `galera1`, `galera2` o `galera3`, detectando caídas por sondeo TCP y redirigiendo las consultas sin pérdida de servicio.

---

# 5. ENTORNO DE PRUEBAS EN 2 COMPUTADORAS FÍSICAS

Para asegurar una evaluación fiel a un entorno de red real, el sistema se probó dividiendo la carga entre dos equipos físicos conectados en la misma red local (LAN):

* **Computadora 1 (Servidor de Infraestructura):** Dirección IP `192.168.22.12`. Aloja Docker Engine con los contenedores de las 3 capas y el servidor Nagios Core.
* **Computadora 2 (Tester / Cliente de Pruebas):** Equipo cliente externo que lanza las peticiones HTTP concurrentes, ejecuta las pruebas de estrés y monitorea el estado desde la red.

---

# 6. CUMPLIMIENTO DE OBJETIVOS DE LA TAREA

* **Resiliencia:** Capacidad de auto-curación y tolerancia a la pérdida simultánea de nodos sin caída total del sistema ni corrupción de datos.
* **Alta Disponibilidad:** Pares redundantes HAProxy con Keepalived VRRP, clustering multi-master síncrono en Galera y Replica Set en MongoDB, garantizando conmutaciones por error en menos de 2 segundos.
* **Escalabilidad:** Separación modular e independiente de las 3 capas, con balanceo Round-Robin verificado y aceleración mediante caché Redis superando los 300 RPS concurrentes.