import { createServer } from "node:http";
import { MongoClient } from "mongodb";
import mysql from "mysql2/promise";
import { createClient } from "redis";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

// 3.4: Connection-pool tuning: 10 conexiones máx por réplica de API
const pool = mysql.createPool({
  host: required("DB_HOST"),
  port: Number(process.env.DB_PORT || 3306),
  database: required("DB_NAME"),
  user: required("DB_USER"),
  password: required("DB_PASSWORD"),
  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
});

// 2.1: Soporte para MongoDB Replica Set (rs0) con tolerancia a fallos
const mongoHosts = required("MONGO_HOST");
const mongoUri = mongoHosts.includes(",")
  ? `mongodb://${mongoHosts}/${encodeURIComponent(required("MONGO_DB"))}?replicaSet=rs0&authSource=admin&readPreference=primaryPreferred`
  : `mongodb://${mongoHosts}:${Number(process.env.MONGO_PORT || 27017)}/${encodeURIComponent(required("MONGO_DB"))}`;

const mongo = new MongoClient(mongoUri, {
  auth: {
    username: required("MONGO_USER"),
    password: required("MONGO_PASSWORD"),
  },
  authSource: "admin",
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 5000,
});

// 2.2: Conexión a Redis HA vía database-lb
const redis = createClient({
  socket: {
    host: required("REDIS_HOST"),
    port: Number(process.env.REDIS_PORT || 6379),
  },
});
redis.on("error", (error) => console.error("Redis client error:", error));

class HttpError extends Error {
  constructor(statusCode, message, trace) {
    super(message);
    this.statusCode = statusCode;
    this.trace = trace;
  }
}

const readJsonBody = async (request) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) {
      throw new HttpError(413, "Request body is too large");
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON");
  }
};

const sendJson = (response, statusCode, payload, trace = []) => {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "x-request-trace": trace.join(" -> "),
  });
  response.end(JSON.stringify(payload));
};

const start = async () => {
  await Promise.all([mongo.connect(), redis.connect()]);
  const reviews = mongo.db(required("MONGO_DB")).collection("movie_reviews");
  const moviesCacheKey = "imdb:movies:top";

  const server = createServer((request, response) => {
    const trace = [
      request.headers["x-presentation-lb"] || "presentation-lb-unknown",
      request.headers["x-web-node"] || "web-node-unknown",
      request.headers["x-application-lb"] || "application-lb-unknown",
      process.env.APPLICATION_NODE || "app-node-unknown",
    ];

    void (async () => {
      const pathname = new URL(request.url, "http://localhost").pathname;

      if (request.method === "GET" && pathname === "/health") {
        await Promise.all([pool.query("SELECT 1"), mongo.db().command({ ping: 1 }), redis.ping()]);
        sendJson(response, 200, {
          status: "ok",
          service: "mini-imdb-api",
          database_proxy: "database-lb (Galera Cluster 3-nodes)",
          mongodb_topology: "Replica Set (rs0)",
          redis_mode: "High-Availability Persistent Cache",
        }, [...trace, "database-lb (galera)", "mongo-rs0", "database-lb (redis)"]);
        return;
      }

      if (request.method === "GET" && pathname === "/") {
        sendJson(response, 200, {
          service: "mini-imdb-api",
          version: "2.1.0",
          top_movies: "/movies/top",
          movie_reviews: "/movies/{code}/reviews",
          health: "/health",
        }, trace);
        return;
      }

      // Consulta de Top Películas con Redis Cache y Galera fallback vía proxy
      if (request.method === "GET" && (pathname === "/movies/top" || pathname === "/products/cheapest")) {
        trace.push("database-lb (redis)");
        const cached = await redis.get(moviesCacheKey);
        if (cached) {
          trace.push("cache hit");
          sendJson(response, 200, JSON.parse(cached), trace);
          return;
        }

        trace[trace.length - 1] = "database-lb (redis miss)";
        trace.push("database-lb (galera-cluster)");
        const [movies] = await pool.execute(
          "SELECT id, code, code AS sku, title, title AS name, director, genre, release_year, rating, rating AS price FROM movies ORDER BY rating DESC, release_year DESC LIMIT 10",
        );

        trace.push("redis (cache write)");
        await redis.set(moviesCacheKey, JSON.stringify(movies), { EX: 60 });
        sendJson(response, 200, movies, trace);
        return;
      }

      // Purga de Caché
      if (request.method === "POST" && pathname === "/cache/clear") {
        const removed = await redis.del(moviesCacheKey);
        sendJson(
          response,
          200,
          { cacheKey: moviesCacheKey, cacheEntryRemoved: removed === 1 },
          [...trace, "database-lb (redis del)"],
        );
        return;
      }

      // Lectura de Reseñas de Película desde MongoDB Replica Set
      const reviewMatch = pathname.match(/^\/(?:movies|products)\/([A-Za-z0-9-]+)\/reviews$/);
      if (reviewMatch && request.method === "GET") {
        const movieCode = reviewMatch[1];
        const movieReviews = await reviews
          .find({ $or: [{ movieCode }, { sku: movieCode }] })
          .sort({ createdAt: -1 })
          .limit(50)
          .project({ _id: 0, movieCode: 1, reviewer: 1, rating: 1, comment: 1, createdAt: 1 })
          .toArray();
        sendJson(response, 200, { movieCode, reviews: movieReviews }, [...trace, "mongo-rs0"]);
        return;
      }

      // Inserción de Nueva Reseña (Verificación en Galera vía Proxy + Inserción en Mongo Replica Set)
      if (reviewMatch && request.method === "POST") {
        if (!request.headers["content-type"]?.includes("application/json")) {
          throw new HttpError(415, "Content-Type must be application/json");
        }
        const body = await readJsonBody(request);
        if (body === null || typeof body !== "object" || Array.isArray(body)) {
          throw new HttpError(400, "Request body must be a JSON object");
        }
        const reviewer = typeof body.reviewer === "string" ? body.reviewer.trim() : "";
        const comment = typeof body.comment === "string" ? body.comment.trim() : "";
        if (
          reviewer.length < 1 ||
          reviewer.length > 80 ||
          !Number.isInteger(body.rating) ||
          body.rating < 1 ||
          body.rating > 5 ||
          comment.length < 1 ||
          comment.length > 1000
        ) {
          throw new HttpError(400, "Provide reviewer, rating (1-5), and comment within the allowed lengths");
        }

        trace.push("database-lb (galera lookup)");
        const [matches] = await pool.execute("SELECT 1 FROM movies WHERE code = ? LIMIT 1", [
          reviewMatch[1],
        ]);
        if (matches.length === 0) {
          throw new HttpError(404, "Movie not found in catalog", trace);
        }

        const review = {
          movieCode: reviewMatch[1],
          sku: reviewMatch[1],
          reviewer,
          rating: body.rating,
          comment,
          createdAt: new Date(),
        };
        const result = await reviews.insertOne(review);
        sendJson(response, 201, { id: result.insertedId.toString(), ...review }, [...trace, "mongo-rs0 (insert review)"]);
        return;
      }

      sendJson(response, 404, { error: "Not found" }, trace);
    })().catch((error) => {
      if (!(error instanceof HttpError)) {
        console.error("Request failed:", error);
      }
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendJson(
        response,
        error instanceof HttpError ? error.statusCode : 503,
        { error: error instanceof HttpError ? error.message : "Service temporarily unavailable" },
        error instanceof HttpError && error.trace ? error.trace : trace,
      );
    });
  });

  server.listen(8080, "0.0.0.0", () => {
    console.log("Mini-IMDb API listening on port 8080");
  });

  const shutdown = () => {
    server.close(() => {
      void Promise.all([pool.end(), mongo.close(), redis.quit()]).then(() => process.exit(0));
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

start().catch((error) => {
  console.error("Application startup failed:", error);
  process.exitCode = 1;
});