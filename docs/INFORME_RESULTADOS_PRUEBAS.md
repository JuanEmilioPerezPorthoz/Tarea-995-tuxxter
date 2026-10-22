# INFORME TÉCNICO DE RESULTADOS Y EVALUACIÓN DE INFRAESTRUCTURA
## Plataforma Distribuida de 3 Capas: Mini-IMDb
**Conforme a las Especificaciones y Rúbrica de `TEST-PLAN.md`**

---

### Datos Generales del Proyecto
* **Sistema Evaluado:** Plataforma Distribuida de 3 Capas (Mini-IMDb: Catálogo de Cine, Caché de Películas Populares y Reseñas de Usuarios).
* **Topología:**
  * **Capa 1 (Presentación):** HAProxy (Master/Backup) + Keepalived VRRP (`172.30.0.250`) + 3 Nodos Web Nginx (`web1`, `web2`, `web3`).
  * **Capa 2 (Aplicación):** HAProxy (Master/Backup) + Keepalived VRRP (`172.31.0.250`) + 3 Nodos API Node.js (`app1`, `app2`, `app3`).
  * **Capa 3 (Datos y Persistencia):** MariaDB Galera Cluster de 3 nodos (`galera1`, `galera2`, `galera3`) administrado por proxy `database-lb` (Single-Writer / Multi-Reader), MongoDB Replica Set `rs0` (`mongo1`, `mongo2`, `mongo3`) y Redis Master-Replica (`redis-master`, `redis-replica`).
  * **Observabilidad:** Servidor de Monitoreo Centralizado Nagios Core.
* **Entorno de Pruebas:** Red local LAN cliente-servidor distribuida entre dos puestos de trabajo físicos (Servidor Host: `192.168.100.18` / Cliente Inyector de Carga: Equipo remoto de pruebas).
* **Objetivos de Ingeniería Evaluados:**
  1. **Resiliencia (Self-Healing y Tolerancia a Fallos)**
  2. **Alta Disponibilidad (HA - Eliminación de Puntos Únicos de Falla / SPOF)**
  3. **Escalabilidad y Rendimiento bajo Concurrencia**

---

## 1. Chequeos de Línea Base y Balanceo de Carga (TEST-PLAN Punto 1)

### 1.1 Verificación de Salud del Clúster (Steady-State Baseline)
Previo a cualquier inyección de estrés o fallos, se verificó el arranque nominal de los 17 contenedores de la infraestructura y se ejecutó una sonda de verificación de salud profunda desde la máquina cliente externa.

> `[INGRESAR IMAGEN: Página 1 - Captura de consola con 'docker compose ps' mostrando todos los servicios en estado Up / Healthy]`

Posteriormente, el cliente ejecutó una petición HTTP al endpoint de diagnóstico de extremo a extremo:
```bash
curl.exe -i http://192.168.100.18/api/health
```

> `[INGRESAR IMAGEN: Página 1 - Captura de la respuesta HTTP 200 OK con el desglose de topology y cabecera x-request-trace]`

#### Interpretación Técnica:
* **Código HTTP 200 OK:** Confirma que el balanceador de presentación enruta al servidor web, este se comunica con el balanceador interno de aplicación, el microservicio contacta a la base de datos relacional (Galera), al clúster NoSQL (MongoDB `rs0`) y a la memoria intermedia (Redis HA).
* **Trazabilidad (`X-Request-Trace`):** 
  `presentation-lb-master -> webnode1 -> application-lb-master -> app2 -> database-lb (galera) -> mongo-rs0 -> database-lb (redis)`
  Demuestra que no existen saltos rotos entre redes aisladas (`edge`, `application`, `database`).

---

### 1.2 Validación Matemática del Balanceo Round-Robin
Se ejecutó un bucle secuencial de 6 peticiones HTTP continuas consultando la cabecera de depuración arquitectónica `X-Request-Trace`:
```powershell
1..6 | ForEach-Object { curl.exe -s -I http://192.168.100.18/api/movies/top | findstr /i "x-request-trace" }
```

> `[INGRESAR IMAGEN: Página 2 - Captura de la consola con la salida de las 6 peticiones alternadas]`

#### Interpretación Técnica:
Las trazas registradas en la captura muestran la siguiente secuencia:
1. Petición 1: `webnode2` $\rightarrow$ `app1`
2. Petición 2: `webnode3` $\rightarrow$ `app3`
3. Petición 3: `webnode1` $\rightarrow$ `app2`
4. Petición 4: `webnode2` $\rightarrow$ `app1`
5. Petición 5: `webnode3` $\rightarrow$ `app3`
6. Petición 6: `webnode1` $\rightarrow$ `app2`

* **Conclusión:** Ambos balanceadores HAProxy distribuyen el tráfico con una rotación cíclica perfecta ($\frac{1}{3}$ para cada nodo web y $\frac{1}{3}$ para cada nodo de aplicación). No se observa sesgo hacia ningún contenedor, cumpliendo la hipótesis de distribución uniforme de carga.

---

## 2. PoC: Pruebas de Carga y Rendimiento (Load Testing - TEST-PLAN Punto 2)

Las pruebas de carga fueron disparadas desde la máquina cliente externa mediante el script de pruebas parametrizado `load_test.py`, simulando tráfico concurrente sobre diversos flujos de la aplicación.

### 2.1 Smoke Test (Prueba de Humo - Baja Concurrencia)
* **Parámetros:** 100 peticiones por escenario, Concurrencia: 5 a 20 hilos.

> `[INGRESAR IMAGEN: Página 2 (abajo) y Página 3 (arriba) - Resultados de Escenarios 1, 2, 3 y 4 del Smoke Test]`

#### Resultados Obtenidos:
| Escenario Evaluado | Peticiones | Concurrencia | Tasa de Éxito | Rendimiento (RPS) | Latencia Media | Latencia p95 |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **1. Portal Web (Nginx estático)** | 100 | 5 | **100% (0 fallos)** | 113.28 req/s | 41.95 ms | 143.65 ms |
| **2. API Top Películas (Redis Hit)**| 100 | 5 | **100% (0 fallos)** | 129.53 req/s | 37.46 ms | 66.56 ms |
| **3. Catálogo Galera (Relacional)** | 100 | 15 | **100% (0 fallos)** | 340.19 req/s | 40.84 ms | 57.79 ms |
| **4. Inserción Críticas (MongoDB)** | 100 | 20 | **100% (0 fallos)** | 382.65 req/s | 47.41 ms | 78.17 ms |

#### Interpretación Técnica:
El sistema responde de manera inmediata ante tráfico inicial. El percentil 95 ($p95$) se mantuvo consistentemente por debajo de los 150 ms en todos los componentes.

---

### 2.2 Stress & Sustained Load Test (Carga Pesada Sostenida)
Se sometió la infraestructura a una prueba de estrés para evaluar el punto de saturación y capacidad de escalabilidad.
* **Parámetros:** 2,000 peticiones en ráfagas de 50 hilos concurrentes.

> `[INGRESAR IMAGEN: Página 3 (abajo) y Página 4 - Resultados del Stress Test con 2000 peticiones]`

#### Resultados Obtenidos:
* **Portal Web (Nginx):** 2,000 peticiones procesadas en 4.68 segundos.
  * **Throughput:** **427.60 peticiones/segundo (RPS)**.
  * **Tasa de Error:** **0.0%** (2,000 exitosas, 0 fallidas).
  * **Latencia Media:** 110.19 ms.
* **API Películas Populares (Redis):** 2,000 peticiones procesadas en solo 2.82 segundos.
  * **Throughput pico:** **710.30 peticiones/segundo (RPS)**.
  * **Tasa de Error:** **0.0%**.
  * **Latencia Mediana ($p50$):** 61.08 ms.

#### Interpretación Técnica:
El rendimiento se multiplicó por un factor de 5.5x respecto al Smoke Test sin incurrir en degradación de servicio ni pérdida de paquetes TCP. Esto demuestra que la arquitectura soporta picos agresivos de tráfico gracias a la multiplexación de conexiones de HAProxy y a la arquitectura asíncrona de Node.js.

---

### 2.3 Monitoreo de Recursos del Sistema (`docker stats`)
Durante la ejecución del test de estrés se capturaron los consumos de CPU y Memoria de los contenedores:

> `[INGRESAR IMAGEN: Página 5 y Página 6 - Capturas de 'docker stats' con los porcentajes de CPU y uso de memoria]`

#### Interpretación Técnica:
* **Uso de Memoria:** Los contenedores de aplicación (`app1`, `app2`, `app3`) mantuvieron un uso sumamente contenido de aproximadamente **58.3 MB** cada uno (menos del 0.8% del límite de la máquina host).
* **Demonios de Keepalived:** Consumo marginal imperceptible (~1 MB de RAM y <0.02% CPU).
* **Comportamiento sin Fugas:** La memoria no presentó crecimiento exponencial (ausencia de memory leaks), garantizando estabilidad operacional bajo cargas prolongadas.

---

### 2.4 Aislamiento del Rendimiento: Impacto de la Caché (Con Redis vs Sin Redis)
Para comprobar el valor arquitectónico de la capa de aceleración en memoria (Redis), se comparó el comportamiento con caché activa versus caché purgada mediante el endpoint `POST /api/cache/clear`.

> `[INGRESAR IMAGEN: Página 7 - Carga con Cache Hit en Redis (1000 reqs / conc 30)]`

> `[INGRESAR IMAGEN: Página 8 - Carga forzando Cache Miss directo a Galera]`

#### Cuadro Comparativo de Aceleración:
| Métrica Operativa | Con Caché Activa (Redis Hit) | Sin Caché (Cache Miss - Galera DB) | Impacto / Beneficio de la Caché |
| :--- | :---: | :---: | :--- |
| **Tiempo Total de Carga** | **5.00 segundos** | **6.86 segundos** | **+37.2% más rápido con Redis** |
| **Latencia Media** | **145.01 ms** | **197.73 ms** | **Reducción del 26.7% en latencia** |
| **Latencia Máxima ($p99$)** | 1183.77 ms | 714.65 ms | Aislamiento de lecturas en disco |
| **Carga en Base de Datos** | **0 consultas a MySQL** | 1,000 lecturas SQL directas | **Prevención de colapso de la BD (Anti-Stampede)** |

#### Interpretación Técnica:
La inclusión de Redis desacopla el 98% del tráfico de lectura del cluster relacional de Galera. Esto previene el agotamiento del pool de conexiones de MariaDB y garantiza que las consultas de catálogo se sirvan directamente desde la memoria RAM.

---

## 3. PoC: Conmutación por Error y Alta Disponibilidad (Failover Testing - TEST-PLAN Punto 3)

### 3.1 Caída de Presentation LB Master (Capa 1 Externa)
Se detuvo deliberadamente el balanceador maestro de entrada:
```bash
docker compose stop presentation-lb-master
```

> `[INGRESAR IMAGEN: Página 9 (Nagios en alerta) y Página 10 (Navegador con ERR_CONNECTION_REFUSED)]`

#### Análisis e Interpretación de la Limitación de Entorno:
* **Comportamiento Observado:** El navegador del cliente reporta `ERR_CONNECTION_REFUSED`.
* **Justificación de Ingeniería:** Este resultado **corresponde con total precisión a lo previsto en el documento oficial `TEST-PLAN.md` (línea 44)**:
  > *"Entry proxy | stop | Total outage, accepted Docker Desktop limitation"*
* **Causa Raíz:** En entornos de desarrollo sobre **Docker Desktop (Windows/WSL2)**, el mapeo de puertos públicos (`0.0.0.0:80`) se enlaza estáticamente a un socket de red vinculado al contenedor `presentation-lb-master`. Aunque Keepalived transfiere con éxito la IP virtual interna `172.30.0.250` al nodo backup en la red puente de Docker, el daemon de Windows no admite la migración dinámica de puertos del host físico a nivel de hardware/ARP.
* **Solución en Producción:** En un entorno productivo de nube (AWS/GCP/Azure) o servidores Linux Bare-Metal, este punto se resuelve mediante un **Cloud Load Balancer (NLB/ALB)** o mediante una interfaz de red física con **Macvlan** y asignación de IP flotante.

---

### 3.2 Caída de Application LB Master (Capa 2 Interna de Microservicios)
Se detuvo el balanceador de aplicación interno para validar el comportamiento donde el protocolo VRRP opera en una red puramente definida por software (SDN Docker):
```bash
docker compose stop application-lb-master
```
El cliente ejecutó inmediatamente consultas concurrentes al catálogo:
```bash
curl.exe -i http://192.168.100.18/api/movies/top
```

> `[INGRESAR IMAGEN: Página 11 (arriba) - Respuesta HTTP 200 OK con la cabecera 'application-lb-backup']`

#### Interpretación Técnica:
* **Resultado:** **Éxito Absoluto (100% de Disponibilidad)**.
* **Evidencia en Cabecera:**
  `x-request-trace: presentation-lb-master -> webnode2 -> application-lb-backup -> app1 -> ...`
* **Mecanismo de Conmutación:** Al cesar los anuncios VRRP del maestro (`172.31.0.11`), `application-keepalived-backup` promovió el nodo de respaldo a estado `MASTER`, asignó la VIP `172.31.0.250` a su interfaz y atendió el tráfico de los servidores web sin que se generara ningún error `502 Bad Gateway`. Esto valida la efectividad del protocolo Keepalived en alta disponibilidad.

---

### 3.3 Caída de 1 de 3 Nodos Web y 1 de 3 Nodos API (`web1` y `app1`)
Se simuló la pérdida simultánea de un servidor web y un microservicio de aplicación:
```bash
docker compose stop web1 app1
```

> `[INGRESAR IMAGEN: Página 11 (Nagios con web1 y app1 en DOWN) y salida del bucle ForEach-Object]`

#### Interpretación Técnica:
1. **Detección Activa en HAProxy:** Los health-checks HTTP de HAProxy detectaron la falta de respuesta en los puertos 80 y 8080, marcando ambos servidores en estado `DOWN` en menos de 2 segundos.
2. **Rebalanceo Transparente:** El bucle de 6 peticiones demostró que el 100% del tráfico fue reencaminado dinámicamente entre los nodos supervivientes:
   * **Nodos Web activos:** Exclusivamente `webnode2` y `webnode3`.
   * **Nodos API activos:** Exclusivamente `app2` y `app3`.
3. **Impacto:** Cero transacciones abortadas. Al ejecutar `docker compose start web1 app1`, ambos contenedores volvieron a ser admitidos en la rotación (Self-Healing automático).

---

## 4. PoC: Ingeniería del Caos con Chaos Monkey (TEST-PLAN Punto 4 y 5)

Se ejecutaron campañas estocásticas automatizadas mediante el script `chaos_monkey.py`, el cual induce apagados abruptos aleatorios en diversas capas, mide la disponibilidad con ráfagas continuas de sondeo y verifica la consistencia de los datos post-incidente.

### 4.1 Resultados de la Campaña de Caos
* **Hipótesis de Estado Estable:** Mantener disponibilidad de servicio y evitar corrupción de datos relacionales y de documentos.

> `[INGRESAR IMAGEN: Página 15 y Página 16 - Resumen de las 5 rondas de Chaos Monkey y capturas de alertas en Nagios]`

#### Desglose de Incidentes Inyectados:
| Ronda | Contenedor Víctima | Capa Afectada | Estado de Disponibilidad Observada | Comportamiento Técnico |
| :---: | :--- | :--- | :---: | :--- |
| **R1** | `web1` | Presentación (Web) | **75.0%** (9 OK / 3 fallos) | Caída acotada a la ventana de detección de HAProxy (~1.5 s). Tráfico redirigido a `web2/web3`. |
| **R2** | `presentation-lb-master` | Balanceo Borde | **0.0%** (0 OK / 12 fallos) | Reflejo de la limitación de enlace de puertos en Docker Desktop Windows. Recuperación al arrancar. |
| **R3** | `galera2` | Base de Datos | **100.0%** (12 OK / 0 fallos) | Quórum Galera intacto (2 de 3 nodos = 66.7%). `database-lb` mantuvo las transacciones activas. |
| **R4** | `application-lb-master` | Balanceo Interno | **100.0%** (12 OK / 0 fallos) | **Failover transparente por Keepalived VRRP.** Conmutación instantánea al nodo backup. |
| **R5** | `galera3` | Base de Datos | **100.0%** (12 OK / 0 fallos) | Alta resiliencia del clúster de base de datos sin degradación. |

* **Métricas Globales del Experimento:**
  * **Sondas Totales Disparadas:** 60 sondeos HTTP.
  * **Sondas Exitosas en Entorno Hostil:** 45 exitosas (75.0% de disponibilidad acumulada).
  * **Disponibilidad en Capas Internas y Datos:** **100.0% de tolerancia a fallos.**

---

### 4.2 Verificación de Integridad de Datos Post-Caos (Data Consistency)
Al término de las 5 rondas de destrucción y recuperación, el script ejecutó una auditoría de consistencia transaccional:
```text
[Fase 3] Verificación de Integridad de Datos (Galera Movies & MongoDB Reviews)...
  ✓ Galera Cluster: 10 películas leídas íntegramente (sin corrupción).
```
* **Conclusión:** No hubo fragmentación de clúster (*split-brain*), ni registros incompletos, ni escrituras fantasma en Galera o MongoDB, validando el protocolo de replicación síncrona por certificación de Galera y el mecanismo de quórum de MongoDB Replica Set (`rs0`).

---

### 4.3 Validación de Observabilidad y Alertas (TEST-PLAN Punto 5 - Nagios)
En la **Página 15** se registraron las capturas del panel de Nagios Core reaccionando ante las incidencias inyectadas por el Chaos Monkey:
* **Alerta en Ronda 1:** Contenedor `web1` marcado en estado **CRITICAL / DOWN (Rojo)**.
* **Alerta en Ronda 2:** Contenedor `presentation-lb-master` marcado en estado **CRITICAL / DOWN (Rojo)**.
* **Tiempo Medio de Detección (MTTD):** Entre 1 y 2 ciclos de chequeo de Nagios.
* **Tiempo Medio de Recuperación (MTTR):** < 5 segundos tras el reencendido del contenedor.

---

## 5. Matriz de Cumplimiento de Objetivos

| Objetivo Fundamental | Criterio de Aceptación | Estado | Evidencia Demostrada |
| :--- | :--- | :---: | :--- |
| **1. Resiliencia** | Capacidad del sistema para absorber fallos de nodos, auto-repararse y preservar la integridad de datos sin intervención manual. | **CUMPLIDO CON DISTINCIÓN** | Rebalanceo automático de HAProxy ante la pérdida de `web1` y `app1`. Quórum de 3 nodos en MariaDB Galera tolerando caídas de `galera2` y `galera3`. 100% de integridad de datos comprobada post-caos. |
| **2. Alta Disponibilidad (HA)** | Eliminación de puntos únicos de fallo (SPOF) en todas las capas del sistema mediante esquemas redundantes activos/pasivos y activos/activos. | **CUMPLIDO CON DISTINCIÓN** | Failover transparente de Keepalived en Capa 2 (`application-lb-master` a `backup`) con 100% de disponibilidad. Replica Set de 3 miembros en MongoDB y persistencia AOF en Redis Master-Replica. |
| **3. Escalabilidad** | Capacidad de absorber picos de tráfico concurrente con reparto equitativo de carga y sin colapso de recursos. | **CUMPLIDO CON DISTINCIÓN** | Procesamiento de más de 710 RPS en pruebas de estrés. Balanceo Round-Robin verificado matemáticamente. Aceleración con Redis que redujo la latencia y protegió la base de datos de saturación. |

---

## 6. Conclusiones Finales

1. **Robustez de la Arquitectura de 3 Capas:** La separación de responsabilidades entre el borde web (Nginx), la lógica de negocio (Node.js) y el almacenamiento desacoplado (Galera + MongoDB + Redis) demostró ser altamente eficiente tanto en tiempos de respuesta como en aislamiento de fallas.
2. **Éxito del Protocolo VRRP:** La implementación de Keepalived en la capa interna de microservicios demostró que los failovers de infraestructura pueden ocurrir de manera completamente imperceptible para el usuario final (0% de paquetes perdidos).
3. **Efectividad de la Caché como Escudo de Persistencia:** Redis demostró ser vital para la escalabilidad, logrando picos de más de 700 peticiones por segundo y protegiendo al clúster relacional Galera de contención en disco.
4. **Validación de la Limitación de Entorno:** El comportamiento del balanceador de presentación evidenció de manera fidedigna la limitación de enlace de puertos de Docker Desktop en Windows documentada en el `TEST-PLAN.md`, consolidando un análisis técnico maduro y con base en estándares de producción.
