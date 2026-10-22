#!/usr/bin/env python3
"""
Python Cross-Platform Load Testing Suite for Mini-IMDb 3-Tier Distributed System
Executes high-concurrency requests, calculates latency percentiles,
verifies Round-Robin distribution across tiers, and outputs metrics.
"""

import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import statistics

def execute_request(url, method="GET", payload=None, headers=None):
    headers = headers or {}
    data = None
    if payload:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = Request(url, data=data, headers=headers, method=method)
    start_time = time.perf_counter()
    try:
        with urlopen(req, timeout=10) as response:
            latency = (time.perf_counter() - start_time) * 1000.0
            status_code = response.getcode()
            trace = response.headers.get("x-request-trace", "none")
            return {
                "success": True,
                "status": status_code,
                "latency_ms": latency,
                "trace": trace,
            }
    except HTTPError as e:
        latency = (time.perf_counter() - start_time) * 1000.0
        return {
            "success": False,
            "status": e.code,
            "latency_ms": latency,
            "error": str(e),
        }
    except Exception as e:
        latency = (time.perf_counter() - start_time) * 1000.0
        return {
            "success": False,
            "status": 0,
            "latency_ms": latency,
            "error": str(e),
        }

def run_load_scenario(name, url, total_requests=1000, concurrency=50, method="GET", payload=None):
    print(f"\n=======================================================")
    print(f" Escenario: {name}")
    print(f" Destino: {method} {url}")
    print(f" Peticiones: {total_requests} | Concurrencia: {concurrency}")
    print(f"=======================================================")

    results = []
    traces = {}
    status_counts = {}

    start_total = time.perf_counter()

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [executor.submit(execute_request, url, method, payload) for _ in range(total_requests)]
        for f in as_completed(futures):
            res = f.result()
            results.append(res)
            status = res["status"]
            status_counts[status] = status_counts.get(status, 0) + 1
            if res.get("trace") and res["trace"] != "none":
                trace = res["trace"]
                traces[trace] = traces.get(trace, 0) + 1

    total_time = time.perf_counter() - start_total
    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]

    latencies = [r["latency_ms"] for r in results]
    latencies.sort()

    rps = total_requests / total_time if total_time > 0 else 0
    mean_lat = statistics.mean(latencies) if latencies else 0
    p50_lat = statistics.median(latencies) if latencies else 0
    p95_lat = latencies[int(len(latencies) * 0.95)] if latencies else 0
    p99_lat = latencies[int(len(latencies) * 0.99)] if latencies else 0

    print(f"  Resultados:")
    print(f"  - Tiempo total transcurrido: {total_time:.2f} s")
    print(f"  - Rendimiento (Throughput): {rps:.2f} peticiones/seg (RPS)")
    print(f"  - Exitosas: {len(successful)} ({len(successful)/total_requests*100:.1f}%)")
    print(f"  - Fallidas:  {len(failed)} ({len(failed)/total_requests*100:.1f}%)")
    print(f"  - Latencia media:  {mean_lat:.2f} ms")
    print(f"  - Latencia p50:    {p50_lat:.2f} ms")
    print(f"  - Latencia p95:    {p95_lat:.2f} ms")
    print(f"  - Latencia p99:    {p99_lat:.2f} ms")

    if traces:
        print("\n  Distribución de Nodos (X-Request-Trace):")
        for trace_path, count in traces.items():
            pct = (count / total_requests) * 100
            print(f"    [{count:4d} req | {pct:5.1f}%] {trace_path}")

    return {
        "scenario": name,
        "rps": rps,
        "mean_latency_ms": mean_lat,
        "p95_latency_ms": p95_lat,
        "p99_latency_ms": p99_lat,
        "success_rate": len(successful) / total_requests,
        "traces": traces,
    }

def main():
    parser = argparse.ArgumentParser(description="Prueba de Carga de Mini-IMDb en Sistema Distribuido 3 Capas")
    parser.add_argument("--host", default="http://localhost", help="URL base del sistema")
    parser.add_argument("--requests", type=int, default=1000, help="Total de peticiones por escenario")
    parser.add_argument("--concurrency", type=int, default=30, help="Nivel de concurrencia de hilos")
    args = parser.parse_args()

    print("==============================================================")
    print("  SUITE DE PRUEBAS DE CARGA: MINI-IMDb DISTRIBUIDO (3 CAPAS)  ")
    print("==============================================================")

    # 1. Storefront Nginx Web Nodes
    run_load_scenario(
        name="1. Portal Web Mini-IMDb (Nginx Webnodes)",
        url=f"{args.host}/",
        total_requests=args.requests,
        concurrency=args.concurrency
    )

    # 2. Redis Cache Hit
    run_load_scenario(
        name="2. API Top Películas (Redis Cache Hit)",
        url=f"{args.host}/api/movies/top",
        total_requests=args.requests,
        concurrency=args.concurrency
    )

    # 3. Cache Invalidation & MariaDB Galera query
    execute_request(f"{args.host}/api/cache/clear", method="POST")
    run_load_scenario(
        name="3. Consulta Relacional MariaDB Galera (Cache Miss inicial)",
        url=f"{args.host}/api/movies/top",
        total_requests=min(args.requests, 300),
        concurrency=15
    )

    # 4. MongoDB Write Operation
    review_data = {
        "reviewer": "Cinephile_AutoTester",
        "rating": 5,
        "comment": "Prueba de carga y concurrencia sobre críticas de cine en MongoDB"
    }
    run_load_scenario(
        name="4. Inserción de Críticas en MongoDB",
        url=f"{args.host}/api/movies/MOV-001/reviews",
        total_requests=min(args.requests, 400),
        concurrency=20,
        method="POST",
        payload=review_data
    )

if __name__ == "__main__":
    main()
