import { readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline/promises'
import { randomBytes } from 'node:crypto'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name) => args[args.indexOf(name) + 1]
const fail = (message) => { console.error(`Reset refused: ${message}`); process.exit(1) }
const adminEmail = 'petit@admin.com'

if (args.some((arg) => !['--remote', '--dry-run', '--project-ref'].includes(arg) && arg !== option('--project-ref'))) fail('unknown argument.')
if (!flag('--remote')) fail('pass --remote to confirm this command targets a hosted project.')
if (/^(true|1)$/i.test(process.env.CI || '')) fail('remote reset is a manual operation and cannot run in CI.')

const projectRef = option('--project-ref')
const projectUrl = process.env.SUPABASE_URL
const secretKey = process.env.SUPABASE_SECRET_KEY
const databasePassword = process.env.POSTGRESQL_DB_PASSWORD
const poolerHost = process.env.SUPABASE_DB_POOLER_HOST
if (!projectRef || !/^[a-z0-9-]+$/.test(projectRef)) fail('provide --project-ref with the hosted project reference.')
if (!projectUrl || !secretKey || !databasePassword || !poolerHost) fail('set SUPABASE_URL, SUPABASE_SECRET_KEY, POSTGRESQL_DB_PASSWORD, and SUPABASE_DB_POOLER_HOST.')

let url
try { url = new URL(projectUrl) } catch { fail('SUPABASE_URL must be a valid project URL.') }
const urlRef = url.hostname.endsWith('.supabase.co') ? url.hostname.split('.')[0] : ''
if (url.protocol !== 'https:' || urlRef !== projectRef) fail('--project-ref must exactly match the HTTPS SUPABASE_URL project reference.')
if (!/^[a-z0-9.-]+$/.test(poolerHost) || poolerHost.includes('..')) fail('SUPABASE_DB_POOLER_HOST is invalid.')

const migrations = (await readdir('supabase/migrations')).filter((file) => file.endsWith('.sql')).sort()
const databaseUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(databasePassword)}@${poolerHost}:5432/postgres`
console.log(`Remote reset target: ${projectRef}`)
console.log(`Supabase URL: ${url.origin}`)
console.log(`Database host: ${poolerHost}:5432`)
console.log(`Migrations to replay: ${migrations.join(', ') || '(none)'}`)
console.log(`Auth cleanup: delete every Auth user, then create one auto-confirmed admin (${adminEmail}).`)
console.log('The random admin password will be printed once after verification.')
if (flag('--dry-run')) {
  console.log('Dry run only. No database or Auth request was made.')
  process.exit(0)
}

if (!process.stdin.isTTY || !process.stdout.isTTY) fail('a terminal is required for typed project confirmation.')
const readline = createInterface({ input: process.stdin, output: process.stdout })
const confirmation = await readline.question(`Type ${projectRef} to reset this remote project: `)
readline.close()
if (confirmation !== projectRef) fail('project reference did not match.')

const cli = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const reset = spawnSync(cli, ['supabase', 'db', 'reset', '--db-url', databaseUrl], { stdio: 'inherit' })
if (reset.error) fail(`could not start Supabase CLI: ${reset.error.message}`)
if (reset.status !== 0) fail(`Supabase CLI reset exited with status ${reset.status ?? 'unknown'}.`)

const apiBase = `${url.origin}/auth/v1`
const headers = { apikey: secretKey, Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/json' }
async function request(path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { ...headers, ...init.headers } })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(data?.msg || data?.message || `Supabase Auth request failed (${response.status}).`)
  return data
}
async function listUsers() {
  const users = []
  for (let page = 1; ; page += 1) {
    const data = await request(`/admin/users?page=${page}&per_page=100`)
    users.push(...(data.users || []))
    if (!data.users || data.users.length < 100) return users
  }
}

const users = await listUsers()
for (const user of users) await request(`/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })

const password = randomBytes(32).toString('base64url')
let admin
try {
  const created = await request('/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email: adminEmail, password, email_confirm: true })
  })
  admin = created?.user || created
  if (!admin?.id) throw new Error('Supabase did not return the created Auth user.')

  const promoted = await fetch(`${url.origin}/rest/v1/profiles?id=eq.${encodeURIComponent(admin.id)}&select=id,email,role`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ role: 'admin' })
  })
  if (!promoted.ok) throw new Error(`Could not promote the new profile (${promoted.status}).`)
  const profiles = await promoted.json()
  if (profiles.length !== 1 || profiles[0].id !== admin.id || profiles[0].role !== 'admin') throw new Error('The new profile was not promoted to admin.')

  const remaining = await listUsers()
  const profileResponse = await fetch(`${url.origin}/rest/v1/profiles?role=eq.admin&select=id,email,role`, { headers })
  if (!profileResponse.ok) throw new Error(`Could not verify admin profiles after reset (${profileResponse.status}).`)
  const admins = await profileResponse.json()
  const confirmed = remaining[0]?.email_confirmed_at || remaining[0]?.confirmed_at
  if (remaining.length !== 1 || remaining[0].id !== admin.id || remaining[0].email?.toLowerCase() !== adminEmail || !confirmed || admins.length !== 1 || admins[0].id !== admin.id || admins[0].email?.toLowerCase() !== adminEmail || admins[0].role !== 'admin') {
    throw new Error('Reset finished, but the only Auth user is not the confirmed admin with the expected profile.')
  }
} catch (error) {
  let cleanupErrors = ''
  try {
    const createdUsers = admin?.id ? [admin] : (await listUsers()).filter((user) => user.email?.toLowerCase() === adminEmail)
    for (const user of createdUsers) await request(`/admin/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
  } catch (cleanupError) {
    cleanupErrors = ` Cleanup failed: ${cleanupError.message}`
  }
  throw new Error(`First-admin creation failed: ${error.message}.${cleanupErrors}`)
}

console.log('Remote reset complete. The only Auth user is the auto-confirmed admin.')
console.log(`Admin email: ${adminEmail}`)
console.log(`Admin password (save it securely; shown once): ${password}`)
