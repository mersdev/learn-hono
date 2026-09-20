import type { Context } from 'hono'
import type { AppEnv } from '../types'
import { HttpError, readJson, safeText } from './http'
import { supabase } from './supabase'

type AuthUser = { id: string; email?: string | null }

export async function readInviteEmail(c: Context<AppEnv>) {
  const body = await readJson<Record<string, unknown> | null>(c)
  if (!body || Array.isArray(body) || Object.keys(body).some((key) => key !== 'email')) throw new HttpError(400, 'Provide only an email address.')
  const input = safeText(body.email, 255)
  if (input.length > 254) throw new HttpError(400, 'Email address is too long.')
  const email = input.toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Provide a valid email address.')
  return email
}

export async function listAuthUsers(c: Context<AppEnv>): Promise<AuthUser[]> {
  const users: AuthUser[] = []
  for (let page = 1; ; page += 1) {
    const data = await supabase(c, `/auth/v1/admin/users?page=${page}&per_page=100`)
    if (!Array.isArray(data?.users)) throw new HttpError(502, 'Could not list Auth users.')
    users.push(...data.users)
    if (data.users.length < 100) return users
  }
}

export async function inviteAdmin(c: Context<AppEnv>, email: string) {
  const redirectTo = `${c.env.APP_ORIGIN.replace(/\/$/, '')}/verify/`
  const result = await supabase(c, `/auth/v1/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  })
  let user = (result?.user || result) as AuthUser
  if (!user?.id) user = (await listAuthUsers(c)).find((candidate) => candidate.email?.toLowerCase() === email) as AuthUser
  if (!user?.id) throw new HttpError(502, `Supabase sent an invite to ${email} but did not return the Auth user.`)

  try {
    const [profile] = await supabase(c, `/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ role: 'admin' })
    })
    if (profile?.role !== 'admin') throw new Error('Admin profile was not updated.')
  } catch {
    throw new HttpError(502, `The invite may have been sent, but admin access was not set. Delete ${email} from Supabase Authentication → Users, then retry.`)
  }

  return user
}
