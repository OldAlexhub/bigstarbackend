const REQUIRED_KEYS = ["MONGO_URL", "JWT_SECRET"];

const configuredValue = (env, key) => {
  const value = env[key];
  return typeof value === "string" ? value.trim() : "";
};

const validateClientOrigin = (value, errors) => {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) {
      errors.push("CLIENT_URL must use http:// or https://.");
      return null;
    }
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      errors.push("CLIENT_URL must be an origin only (for example, https://app.example.com).");
      return null;
    }
    return url.origin;
  } catch {
    errors.push("CLIENT_URL must be a valid absolute URL.");
    return null;
  }
};

const parseTrustProxy = (value) => {
  if (!value) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};

export const validateEnvironment = (env = process.env) => {
  const errors = [];

  for (const key of REQUIRED_KEYS) {
    if (!configuredValue(env, key)) errors.push(`${key} is required.`);
  }

  const nodeEnv = configuredValue(env, "NODE_ENV") || "development";
  const jwtSecret = configuredValue(env, "JWT_SECRET");
  if (
    nodeEnv === "production" &&
    (jwtSecret.length < 32 || /replace[-_ ]?with|change[-_ ]?me/i.test(jwtSecret))
  ) {
    errors.push("JWT_SECRET must be a non-placeholder secret of at least 32 characters when NODE_ENV=production.");
  }
  const clientUrl = configuredValue(env, "CLIENT_URL");
  if (nodeEnv === "production" && !clientUrl) {
    errors.push("CLIENT_URL is required when NODE_ENV=production.");
  }
  const rawTrustProxy = configuredValue(env, "TRUST_PROXY");
  if (nodeEnv === "production" && !rawTrustProxy) {
    errors.push("TRUST_PROXY is required when NODE_ENV=production (use false when no reverse proxy is present).");
  }
  const clientOrigin = validateClientOrigin(clientUrl, errors);

  const rawPort = configuredValue(env, "PORT");
  const port = rawPort ? Number(rawPort) : 3000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push("PORT must be an integer between 1 and 65535.");
  }

  if (errors.length) {
    throw new Error(`Invalid environment configuration:\n- ${errors.join("\n- ")}`);
  }

  return {
    nodeEnv,
    port,
    mongoUrl: configuredValue(env, "MONGO_URL"),
    jwtSecret,
    clientOrigin,
    trustProxy: parseTrustProxy(rawTrustProxy),
  };
};
