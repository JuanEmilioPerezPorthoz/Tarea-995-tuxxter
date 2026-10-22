import { readFile } from "node:fs/promises";
import { MongoClient } from "mongodb";
import mysql from "mysql2/promise";

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const connectToMariaDb = async () => {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      return await mysql.createConnection({
        host: required("DB_HOST"),
        port: Number(process.env.DB_PORT || 3306),
        database: required("DB_NAME"),
        user: required("DB_USER"),
        password: required("DB_PASSWORD"),
        multipleStatements: true,
      });
    } catch (error) {
      if (!["ECONNREFUSED", "ETIMEDOUT", "EHOSTUNREACH"].includes(error.code) || attempt === 30) {
        throw error;
      }
      console.log(`MariaDB / database-lb is not ready; retrying (${attempt}/30)`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error("MariaDB connection retry limit reached");
};

const connection = await connectToMariaDb();

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
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});

try {
  const schema = await readFile(new URL("./database/catalog.sql", import.meta.url), "utf8");
  await connection.query(schema);
  console.log("Mini-IMDb movie catalog schema initialized via database-lb");
} finally {
  await connection.end();
}

try {
  await mongo.connect();
  const reviews = mongo.db(required("MONGO_DB")).collection("movie_reviews");
  await reviews.createIndex({ movieCode: 1, createdAt: -1 });
  await reviews.updateOne(
    { sampleId: "sample-mov-001-a" },
    {
      $setOnInsert: {
        sampleId: "sample-mov-001-a",
        movieCode: "MOV-001",
        sku: "MOV-001",
        reviewer: "Cinephile_Leo",
        rating: 5,
        comment: "Obra maestra de Nolan. Diseño de producción y banda sonora de Hans Zimmer inolvidables.",
        createdAt: new Date("2025-01-15T12:00:00.000Z"),
      },
    },
    { upsert: true },
  );
  await reviews.updateOne(
    { sampleId: "sample-mov-001-b" },
    {
      $setOnInsert: {
        sampleId: "sample-mov-001-b",
        movieCode: "MOV-001",
        sku: "MOV-001",
        reviewer: "FilmCritic_Ana",
        rating: 5,
        comment: "Concepto visual innovador y ritmo narrativo perfecto.",
        createdAt: new Date("2025-01-16T12:00:00.000Z"),
      },
    },
    { upsert: true },
  );
  await reviews.updateOne(
    { sampleId: "sample-mov-005" },
    {
      $setOnInsert: {
        sampleId: "sample-mov-005",
        movieCode: "MOV-005",
        sku: "MOV-005",
        reviewer: "Bruce_W",
        rating: 5,
        comment: "La actuación de Heath Ledger como Joker es histórica. El mejor thriller de superhéroes.",
        createdAt: new Date("2025-01-18T15:30:00.000Z"),
      },
    },
    { upsert: true },
  );
  await reviews.createIndex({ sampleId: 1 }, { unique: true, sparse: true });
  console.log("Movie reviews initialized in MongoDB Replica Set");
} finally {
  await mongo.close();
}