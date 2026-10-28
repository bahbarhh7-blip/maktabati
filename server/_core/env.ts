// قيم الإعدادات تُقرأ من متغيرات البيئة وقت الاستخدام.
export const ENV = {
  // معرّف داخلي للجلسات، أي قيمة ثابتة تكفي.
  get appId() { return process.env.MANUS_PROJECT_ID || "maktabati"; },
  get cookieSecret() { return process.env.JWT_SECRET || process.env.MANUS_JWT_SECRET || ""; },
  get databaseUrl() { return process.env.DATABASE_URL ?? ""; },
  get oAuthServerUrl() { return process.env.MANUS_OAUTH_API_URL ?? ""; },
  get ownerOpenId() { return process.env.OWNER_OPEN_ID ?? ""; },
  get isProduction() { return process.env.NODE_ENV === "production"; },
  get forgeApiUrl() { return process.env.MANUS_API_URL ?? ""; },
  get forgeApiKey() { return process.env.MANUS_API_KEY ?? ""; },
  // Cloudflare R2
  get r2AccountId() { return process.env.R2_ACCOUNT_ID ?? ""; },
  get r2AccessKeyId() { return process.env.R2_ACCESS_KEY_ID ?? ""; },
  get r2SecretAccessKey() { return process.env.R2_SECRET_ACCESS_KEY ?? ""; },
  get r2Bucket() { return process.env.R2_BUCKET ?? ""; },
};
