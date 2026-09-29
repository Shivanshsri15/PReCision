import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().port().optional(),
  MONGODB_URI: Joi.string().uri().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_ACCESS_TOKEN_TTL: Joi.string().required(),
  GITHUB_CLIENT_ID: Joi.string().required(),
  GITHUB_CLIENT_SECRET: Joi.string().required(),
  GITHUB_CALLBACK_URL: Joi.string().uri().required(),
  GITHUB_TOKEN_ENCRYPTION_KEY: Joi.string()
    .required(),
  GITHUB_OAUTH_STATE_TTL: Joi.string().default('10m'),
  GITHUB_API_BASE_URL: Joi.string().uri().default('https://api.github.com'),
  GITHUB_OAUTH_AUTHORIZE_URL: Joi.string()
    .uri()
    .default('https://github.com/login/oauth/authorize'),
  GITHUB_OAUTH_TOKEN_URL: Joi.string()
    .uri()
    .default('https://github.com/login/oauth/access_token'),
  GITHUB_OAUTH_SCOPES: Joi.string()
    .default('read:user user:email repo pull_request:read'),
  // Fallback when a user hasn't saved their own key via PUT /api/v1/auth/gemini-key.
  GEMINI_API_KEY: Joi.string().allow('').optional(),
  GEMINI_MODEL: Joi.string().default('gemini-3.1-flash-lite'),
  EMBEDDING_MODEL: Joi.string().default('gemini-embedding-001'),
  EMBEDDING_DIMS: Joi.number().integer().default(768),
  VECTOR_INDEX_NAME: Joi.string().default('repo_vectors_index'),
  GITHUB_WEBHOOK_SECRET: Joi.string().required(),
  // Public URL GitHub POSTs push events to, e.g. https://<host>/api/v1/github/webhook
  GITHUB_WEBHOOK_URL: Joi.string().uri().allow('').optional(),
  INDEX_MAX_FILES: Joi.number().integer().min(1).default(1000),
  // Frontend origin: allowed by CORS and the target of the OAuth callback redirect.
  FRONTEND_URL: Joi.string().uri().default('http://localhost:5173'),
}).unknown(true);

