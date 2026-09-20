export type Bindings = {
  APP_ORIGIN: string
  CORS_ORIGIN: string
  SUPABASE_URL: string
  SUPABASE_SECRET_KEY: string
}

export type AppEnv = {
  Bindings: Bindings
}
