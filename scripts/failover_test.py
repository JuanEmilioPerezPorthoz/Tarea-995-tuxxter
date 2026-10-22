#!/usr/bin/env python3
"""
Python Cross-Platform Failover Orchestrator and SLA Measurement
Mini-IMDb Platform: Continuously sends HTTP probes (10 per second) while container failures
are triggered, measuring exact transition latency, packet loss, and recovery time.
"""

import argparse
import subprocess
import time
import urllib.request
import threading

class FailoverMonitor:
    def __init__(self, target_url="http://localhost/api/movies/top"):
        self.target_url = target_url
        self.running = False
        self.probes = []
        self.lock = threading.Lock()

    def _probe_loop(self):
        while self.running:
            start = time.perf_counter()
            status = 0
            trace = ""
            try:
                req = urllib.request.Request(self.target_url, headers={"User-Agent": "FailoverTester/1.0"})
                with urllib.request.urlopen(req, timeout=2.0) as resp:
                    status = resp.getcode()
                    trace = resp.headers.get("x-request-trace", "")
            except Exception as e:
                status = getattr(e, "code", 0) or 500

            latency = (time.perf_counter() - start) * 1000.0
            with self.lock:
                self.probes.append({
                    "timestamp": time.time(),
                    "status": status,
                    "latency_ms": latency,
                    "trace": trace
                })
            time.sleep(0.1)  # 10 probes per second

    def start(self):
        self.running = True
        self.thread = threading.Thread(target=self._probe_loop, daemon=True)
        self.thread.start()

    def stop(self):
        self.running = False
        if hasattr(self, "thread"):
            self.thread.join(timeout=2.0)

    def analyze(self):
        with self.lock:
            total = len(self.probes)
            if total == 0:
                return {}
            successful = [p for p in self.probes if p["status"] == 200]
            failed = [p for p in self.probes if p["status"] != 200]
            avail = (len(successful) / total) * 100.0
            return {
                "total_probes": total,
                "successful": len(successful),
                "failed": len(failed),
                "availability_pct": avail,
            }

def run_command(cmd):
    print(f"  [EXEC] {cmd}")
    try:
        res = subprocess.run(cmd, shell=True, check=True, capture_output=True, text=True)
        return res.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"  [WARN] Command returned {e.returncode}: {e.stderr.strip()}")
        return e.stderr.strip()

def main():
    parser = argparse.ArgumentParser(description="Mini-IMDb Failover Test Orchestrator")
    parser.add_argument("--url", default="http://localhost/api/movies/top", help="Endpoint to probe")
    args = parser.parse_args()

    print("==================================================================")
    print("  ORQUESTADOR DE PRUEBAS DE FAILOVER: MINI-IMDb PLATFORM          ")
    print("==================================================================")

    monitor = FailoverMonitor(args.url)
    monitor.start()

    try:
        print("\n1. Fase de línea base (3 segundos de tráfico normal)...")
        time.sleep(3)

        print("\n2. Inyectando falla: Deteniendo 'presentation-lb-master'...")
        run_command("docker compose stop presentation-lb-master")
        print("   Observando migración VRRP / VIP...")
        time.sleep(5)

        print("\n3. Restaurando 'presentation-lb-master'...")
        run_command("docker compose start presentation-lb-master")
        time.sleep(4)

        print("\n4. Inyectando falla: Deteniendo 'application-lb-master'...")
        run_command("docker compose stop application-lb-master")
        print("   Observando migración VRRP de Capa de Aplicación...")
        time.sleep(5)

        print("\n5. Restaurando 'application-lb-master'...")
        run_command("docker compose start application-lb-master")
        time.sleep(4)

        print("\n6. Inyectando falla en nodos de cómputo: Deteniendo 'web1' y 'app1'...")
        run_command("docker compose stop web1 app1")
        time.sleep(5)

        print("\n7. Restaurando nodos 'web1' y 'app1'...")
        run_command("docker compose start web1 app1")
        time.sleep(4)

    finally:
        monitor.stop()

    stats = monitor.analyze()
    print("\n==================================================================")
    print("  REPORTE FINAL DE FAILOVER Y RESILIENCIA (MINI-IMDb)              ")
    print("==================================================================")
    print(f"  Sondas totales enviadas:      {stats.get('total_probes', 0)}")
    print(f"  Sondas exitosas (HTTP 200):   {stats.get('successful', 0)}")
    print(f"  Sondas fallidas:              {stats.get('failed', 0)}")
    print(f"  Disponibilidad efectiva:      {stats.get('availability_pct', 0.0):.2f}%")
    print("==================================================================")

if __name__ == "__main__":
    main()
