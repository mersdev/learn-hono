import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { HttpError } from '../lib/http'
import { inviteAdmin, listAuthUsers, readInviteEmail } from '../lib/admin-invites'

export const bootstrapRoutes = new Hono<AppEnv>()

bootstrapRoutes.post('/admin', async (c) => {
  const secret = c.env.ADMIN_BOOTSTRAP_SECRET
  if (!secret) throw new HttpError(404, 'First-admin bootstrap is disabled.')
  if (c.req.header('Authorization') !== `Bearer ${secret}`) throw new HttpError(403, 'Invalid bootstrap secret.')

  const email = await readInviteEmail(c)
  if ((await listAuthUsers(c)).length > 0) throw new HttpError(409, 'Bootstrap is available only when the project has no Auth users.')

  await inviteAdmin(c, email)
  return c.json({ email, message: 'First-admin invitation sent. Remove ADMIN_BOOTSTRAP_SECRET from the Worker.' }, 201)
})
