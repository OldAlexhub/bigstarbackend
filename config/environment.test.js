import test from "node:test";
import assert from "node:assert/strict";
import { validateEnvironment } from "./environment.js";

const required = {
  MONGO_URL: "mongodb://localhost:27017/bigstar-test",
  JWT_SECRET: "test-only-secret",
};

test("startup reports every missing required server variable", () => {
  assert.throws(
    () => validateEnvironment({}),
    (error) => /MONGO_URL is required/.test(error.message) && /JWT_SECRET is required/.test(error.message)
  );
});

test("development accepts the required server variables without CLIENT_URL", () => {
  const config = validateEnvironment(required);
  assert.equal(config.nodeEnv, "development");
  assert.equal(config.port, 3000);
  assert.equal(config.clientOrigin, null);
});

test("production requires an explicit CLIENT_URL", () => {
  assert.throws(
    () => validateEnvironment({ ...required, NODE_ENV: "production" }),
    (error) =>
      /CLIENT_URL is required when NODE_ENV=production/.test(error.message) &&
      /TRUST_PROXY is required when NODE_ENV=production/.test(error.message)
  );
});

test("production rejects a short JWT signing secret", () => {
  assert.throws(
    () => validateEnvironment({
      ...required,
      NODE_ENV: "production",
      CLIENT_URL: "https://operations.example.com",
      TRUST_PROXY: "false",
    }),
    /JWT_SECRET must be a non-placeholder secret of at least 32 characters/
  );
});

test("production rejects a long placeholder JWT signing secret", () => {
  assert.throws(
    () => validateEnvironment({
      ...required,
      NODE_ENV: "production",
      JWT_SECRET: "replace-with-at-least-32-random-characters",
      CLIENT_URL: "https://operations.example.com",
      TRUST_PROXY: "false",
    }),
    /non-placeholder secret/
  );
});

test("CLIENT_URL must be an HTTP origin without a path", () => {
  assert.throws(
    () => validateEnvironment({ ...required, CLIENT_URL: "https://example.com/app" }),
    /CLIENT_URL must be an origin only/
  );
});

test("production returns the validated client origin", () => {
  const config = validateEnvironment({
    ...required,
    JWT_SECRET: "0123456789abcdef0123456789abcdef",
    NODE_ENV: "production",
    PORT: "3001",
    CLIENT_URL: "https://operations.example.com/",
    TRUST_PROXY: "1",
  });

  assert.equal(config.port, 3001);
  assert.equal(config.clientOrigin, "https://operations.example.com");
  assert.equal(config.trustProxy, 1);
});
