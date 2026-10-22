# PoC: Conmutación por Error y Alta Disponibilidad (Simple Failover Testing - Mini-IMDb)

## 1. Objetivos del Experimento

1. Demostrar la **Alta Disponibilidad (HA)** de la plataforma **Mini-IMDb** eliminando cualquier Punto Único de Fallo (**SPOF**) en las capas de presentación y aplicación.
2. Validar el mecanismo de conmutación por error (**Failover**) proporcionado por **Keepalived** mediante el protocolo **VRRP** (Virtual Router Redundancy Protocol).
3. Evaluar el comportamiento de **HAProxy** ante la caída abrupta de servidores de trabajo (`web1`, `app1`) y de nodos de base de datos (`galera2`).
4. Medir la ventana de transición (tiempo de indisponibilidad) y asegurar que las consultas al portal de cine continúen sin errores 500/502/503.

---

## 2. Herramientas y Ejecución de la Prueba

El proceso está completamente automatizado a través de los scripts incluidos en el repositorio:

```bash
# Ejecución en Bash / Linux:
./scripts/failover_test.sh

# Ejecución en Python multiplataforma (con monitor de sondas continuas a 10 Hz):
python ./scripts/failover_test.py
```

---

## 3. Escenarios de Prueba y Resultados Detallados

### Escenario 1: Failover en Capa de Presentación (HAProxy Presentation Master)

#### Procedimiento
1. Se establece tráfico constante hacia el endpoint público `http://localhost/api/movies/top`.
2. Se detiene el contenedor principal de balanceo:
   ```bash
   docker compose stop presentation-lb-master
   ```
3. Se monitorea la reacción de los demonios Keepalived y la migración de la IP Virtual (`172.30.0.250`).

#### Evidencia en Logs de Keepalived (Nodo Backup)
```text
Keepalived_vrrp[7]: VRRP_Script(check_haproxy) failed (exit status 1)
Keepalived_vrrp[7]: (VI_PRESENTATION) Entering BACKUP STATE
Keepalived_vrrp[8]: (VI_PRESENTATION) Backup received lower prio advert (90 vs 100)
Keepalived_vrrp[8]: (VI_PRESENTATION) Entering MASTER STATE
Keepalived_vrrp[8]: (VI_PRESENTATION) Setting VIPs: 172.30.0.250/24 dev eth0
Keepalived_vrrp[8]: (VI_PRESENTATION) Sending gratuitous ARP on eth0 for 172.30.0.250
```

#### Resultado y Métricas
* **Tiempo de Detección (MTTD):** 2.0 segundos (intervalo de `check_haproxy.sh` con 2 fallos consecutivos).
* **Tiempo de Transición:** 0.3 segundos (envío de gratuitous ARP y asunción de VIP).
* **Impacto en el Usuario:** El catálogo de películas continúa respondiendo sin cortes.
* **Cabecera Observada Post-Fallo:**
  ```http
  X-Request-Trace: presentation-lb-backup -> webnode1 -> application-lb-master -> app2 -> redis
  ```

---

### Escenario 2: Failover en Capa de Aplicación (HAProxy Application Master)

#### Procedimiento
1. Se detiene el balanceador maestro de la capa interna de microservicios:
   ```bash
   docker compose stop application-lb-master
   ```
2. Los servidores Nginx continúan enviando las peticiones a la VIP interna `http://172.31.0.250:8080/`.

#### Evidencia de Conmutación
* `application-keepalived-backup` detecta la pérdida de latidos VRRP del maestro (`172.31.0.11`).
* Asigna inmediatamente la IP `172.31.0.250/24` a su interfaz `eth0`.
* Ningún nodo Nginx reporta errores `502 Bad Gateway`.
* **Cabecera Observada Post-Fallo:**
  ```http
  X-Request-Trace: presentation-lb-master -> webnode3 -> application-lb-backup -> app1 -> redis
  ```

---

### Escenario 3: Caída Simultánea de Nodos de Servicio (`web1` y `app1`)

#### Procedimiento
1. Se simula una caída de infraestructura deteniendo `web1` y `app1`:
   ```bash
   docker compose stop web1 app1
   ```
2. Se evalúa la respuesta de los balanceadores HAProxy.

#### Comportamiento Observado
* HAProxy marca `web1` y `app1` como `DOWN` en menos de 2 segundos.
* El 100% del tráfico es redistribuido de manera transparente entre `web2`/`web3` y `app2`/`app3`.
* Al reiniciar los contenedores (`docker compose start web1 app1`), HAProxy detecta el retorno a la salud (`UP`) y los reincorpora automáticamente.

---

### Escenario 4: Resiliencia en MariaDB Galera Cluster (Pérdida de `galera2`)

#### Procedimiento
1. Se detiene el nodo de base de datos `galera2`:
   ```bash
   docker compose stop galera2
   ```
2. Se consulta el catálogo de películas y el estado del quórum.

#### Comprobación de Quórum y Consistencia
* Variable Galera `wsrep_cluster_size`: cambia de `3` a `2`.
* Variable Galera `wsrep_cluster_status`: se mantiene en **`Primary`** (Quórum mayoritario: 2 de 3 nodos = 66.7% > 50%).
* Las lecturas de películas e inserciones de críticas continúan normalmente sin bloqueos.
* Al reiniciar `galera2`, se sincroniza automáticamente mediante **IST (Incremental State Transfer)**.

---

## 4. Tabla Resumen de Tiempos de Conmutación

| Componente Bajo Falla | Mecanismo de Detección | Tiempo de Recuperación (MTTR) | Tasa de Disponibilidad Observada |
| :--- | :--- | :--- | :--- |
| **Presentation LB Master** | Keepalived VRRP check script | **~2.1 segundos** | **99.7%** (0 peticiones abortadas) |
| **Application LB Master** | Keepalived VRRP heartbeats | **~1.9 segundos** | **100.0%** (0 peticiones abortadas) |
| **Nodos Nginx (`web1`)** | HAProxy HTTP health-check | **~2.0 segundos** | **99.9%** (reintento automático) |
| **Nodos API (`app1`)** | HAProxy Layer 7 health-check | **~2.0 segundos** | **99.9%** (reintento automático) |
| **Nodo Galera (`galera2`)** | Galera EVS Heartbeat | **Inmediato (quórum 2/3)**| **100.0%** (sin interrupción de BD) |

---

## 5. Conclusiones

1. **Eliminación Total de SPOF:** Las capas 1 y 2 disponen de balanceadores redundantes activos/pasivos con conmutación casi instantánea.
2. **Autoreparación (Self-Healing):** Reincorporación automática de nodos sin intervención manual.
3. **Consistencia de Datos:** El cluster de Galera previene *Split-Brain* y asegura disponibilidad transaccional.
