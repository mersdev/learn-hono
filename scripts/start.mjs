import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const children = []
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const run = (command, args, options = {}) => {
  const child = spawn(command, args, { stdio: 'inherit', ...options })
  children.push(child)
  return child
}

if (!existsSync('backend/node_modules')) {
  console.error('Install backend dependencies first: cd backend && npm install')
  process.exit(1)
}

if (!existsSync('.env')) {
  console.error('Create a repository-root .env before starting the app.')
  process.exit(1)
}
process.loadEnvFile('.env')
const requiredEnv = ['APP_ORIGIN', 'CORS_ORIGIN', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'RESEND_API_KEY']
const missingEnv = requiredEnv.filter((key) => !process.env[key])
if (missingEnv.length || String(process.env.BETTER_AUTH_SECRET || '').length < 32) {
  console.error(`Set ${missingEnv.length ? missingEnv.join(', ') : 'a 32+ character BETTER_AUTH_SECRET'} in .env.`)
  process.exit(1)
}

const migration = spawnSync(npm, ['--prefix', 'backend', 'run', 'db:migrate:local'], { stdio: 'inherit' })
if (migration.error) throw migration.error
if (migration.status !== 0) process.exit(migration.status || 1)

console.log('Starting PetitBakery Worker on http://localhost:8787')
console.log('Starting PetitBakery Pages preview on http://localhost:8788')
run(npm, ['--prefix', 'backend', 'run', 'dev'])
run(process.execPath, ['scripts/serve-frontend.mjs'])

const stop = () => {
  for (const child of children) child.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
