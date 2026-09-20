import { Hono } from 'hono'
import type { AppEnv } from '../types'
import { HttpError, readJson, safeText } from '../lib/http'
import { requireAdmin, supabase } from '../lib/supabase'
import { inviteAdmin, listAuthUsers, readInviteEmail } from '../lib/admin-invites'
export const adminRoutes = new Hono<AppEnv>()
adminRoutes.use('*', async (c, next) => { await requireAdmin(c); await next() })
adminRoutes.post('/invites', async (c) => {
  const email = await readInviteEmail(c)
  const users = await listAuthUsers(c)
  if (users.some((user) => user.email?.toLowerCase() === email)) throw new HttpError(409, 'That email already has an Auth account.')
  await inviteAdmin(c, email)
  return c.json({ email, message: 'Admin invitation sent.' }, 201)
})
adminRoutes.get('/dashboard', async (c) => {
  const [products, orders, customers, payments] = await Promise.all([supabase(c, '/rest/v1/products?select=id,stock'), supabase(c, '/rest/v1/orders?select=id,total_cents'), supabase(c, '/rest/v1/profiles?select=id&role=eq.customer'), supabase(c, '/rest/v1/payments?select=id')])
  return c.json({ products: products.length, lowStock: products.filter((p: any) => p.stock < 5).length, orders: orders.length, revenue: orders.reduce((n: number, o: any) => n + o.total_cents, 0), customers: customers.length, payments: payments.length })
})
adminRoutes.get('/products', async (c) => c.json({ products: await supabase(c, '/rest/v1/products?select=*&order=created_at.desc') }))
adminRoutes.patch('/products/:id', async (c) => {
  const actor = await requireAdmin(c)
  const body = await readJson<Record<string, unknown>>(c)
  const allowed = ['name', 'description', 'category', 'price_cents', 'stock', 'image_url', 'active']
  if (!Object.keys(body).length || Object.keys(body).some((key) => !allowed.includes(key))) throw new HttpError(400, 'Provide valid product fields to update.')
  const patch: Record<string, unknown> = {}
  for (const key of ['name', 'description', 'category', 'image_url']) {
    if (!(key in body)) continue
    const limit = key === 'description' ? 1000 : key === 'image_url' ? 500 : key === 'name' ? 100 : 40
    const value = safeText(body[key], limit)
    if ((key !== 'description' && !value) || typeof body[key] !== 'string') throw new HttpError(400, `Invalid product ${key}.`)
    patch[key] = value
  }
  for (const key of ['price_cents', 'stock']) {
    if (!(key in body)) continue
    const value = body[key]
    if (!Number.isInteger(value) || Number(value) < 0) throw new HttpError(400, `Invalid product ${key}.`)
    patch[key] = value
  }
  if ('active' in body) {
    if (typeof body.active !== 'boolean') throw new HttpError(400, 'Invalid product active flag.')
    patch.active = body.active
  }
  const [product] = await supabase(c, `/rest/v1/products?id=eq.${encodeURIComponent(safeText(c.req.param('id'), 80))}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(patch) })
  if (!product) throw new HttpError(404, 'Product not found.')
  await supabase(c, '/rest/v1/admin_activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_id: actor.id, action: 'updated', subject_type: 'product', subject_id: product.id }) })
  return c.json({ product })
})
adminRoutes.get('/orders', async (c) => c.json({ orders: await supabase(c, '/rest/v1/orders?select=*,profiles(email,display_name)&order=created_at.desc&limit=200') }))
adminRoutes.patch('/orders/:id', async (c) => {
  const actor = await requireAdmin(c)
  const body = await readJson<{ status?: unknown; shipping_status?: unknown }>(c)
  const orderStatuses = ['confirmed', 'processing', 'completed', 'cancelled']
  const shippingStatuses = ['pending', 'preparing', 'shipped', 'delivered', 'cancelled']
  if (!Object.keys(body).length || Object.keys(body).some((key) => !['status', 'shipping_status'].includes(key))) throw new HttpError(400, 'Provide an order or shipping status to update.')
  if (body.status !== undefined && !orderStatuses.includes(String(body.status))) throw new HttpError(400, 'Invalid order status.')
  if (body.shipping_status !== undefined && !shippingStatuses.includes(String(body.shipping_status))) throw new HttpError(400, 'Invalid shipping status.')
  const patch = Object.fromEntries(Object.entries(body).filter(([, value]) => typeof value === 'string'))
  const [order] = await supabase(c, `/rest/v1/orders?id=eq.${encodeURIComponent(safeText(c.req.param('id'), 80))}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(patch) })
  if (!order) throw new HttpError(404, 'Order not found.')
  await supabase(c, '/rest/v1/admin_activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ admin_id: actor.id, action: 'updated', subject_type: 'order', subject_id: order.id }) })
  return c.json({ order })
})
adminRoutes.get('/customers', async (c) => c.json({ customers: await supabase(c, '/rest/v1/profiles?select=*&order=created_at.desc&limit=200') }))
adminRoutes.get('/payments', async (c) => c.json({ payments: await supabase(c, '/rest/v1/payments?select=*,orders(id,user_id)&order=created_at.desc&limit=200') }))
adminRoutes.get('/activity', async (c) => c.json({ activity: await supabase(c, '/rest/v1/admin_activity?select=*,profiles(display_name,email)&order=created_at.desc&limit=200') }))
