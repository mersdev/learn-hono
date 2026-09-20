import { api, getCurrentUser } from '../js/api.js'
import { escapeHtml, money, setBusy } from '../js/ui.js'

const route = location.pathname.replace(/\/+$/, '').split('/').pop() || 'index'
const page = (route === 'admin' ? 'index' : route).replace('admin_', '').replace('.html', '') || 'index'
const endpoint = { index: 'dashboard', products: 'products', orders: 'orders', customers: 'customers', payments: 'payments', activity: 'activity', shipping: 'orders' }[page] || 'dashboard'
const labels = { index: 'Bakery overview', products: 'Products', orders: 'Orders', customers: 'Customers', payments: 'Demo payments', activity: 'Admin activity', shipping: 'Shipping' }
const orderStatuses = ['confirmed', 'processing', 'completed', 'cancelled']
const shippingStatuses = ['pending', 'preparing', 'shipped', 'delivered', 'cancelled']
const nav = () => ['index', 'products', 'orders', 'shipping', 'customers', 'payments', 'activity'].map((key) => `<a href="${key === 'index' ? '/admin/' : `/admin/${key}/`}" ${key === page ? 'aria-current="page" class="pb-button"' : ''}>${labels[key]}</a>`).join('')
const empty = (what) => `<p class="pb-admin-empty">No ${what} yet.</p>`

function format(value, key) {
  if (value == null || value === '') return '—'
  if (key === 'created_at') return new Date(value).toLocaleString()
  if (key.includes('cents') && typeof value === 'number') return money(value)
  return escapeHtml(typeof value === 'object' ? JSON.stringify(value) : value)
}

function readOnlyRows(data, what) {
  if (!data?.length) return empty(what)
  const columns = Object.keys(data[0]).filter((key) => !['description', 'image_url', 'address1', 'address2'].includes(key))
  return `<div class="overflow-x-auto"><table class="pb-admin-table"><thead><tr>${columns.map((key) => `<th scope="col">${escapeHtml(key.replaceAll('_', ' '))}</th>`).join('')}</tr></thead><tbody>${data.map((item) => `<tr>${columns.map((key) => `<td>${format(item[key], key)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}

function productEditors(products) {
  if (!products?.length) return empty('products')
  return `<div class="grid gap-4">${products.map((product) => `<form data-product-id="${escapeHtml(product.id)}" class="grid gap-3 rounded-2xl border border-[color:var(--pb-line)] bg-white p-4 sm:grid-cols-2">
    <label class="text-sm font-semibold">Name<input name="name" required maxlength="100" value="${escapeHtml(product.name)}" class="pb-field mt-1 w-full"></label>
    <label class="text-sm font-semibold">Category<input name="category" required maxlength="40" value="${escapeHtml(product.category)}" class="pb-field mt-1 w-full"></label>
    <label class="text-sm font-semibold">Price (MYR)<input name="price" type="number" required min="0" step="0.01" value="${(product.price_cents / 100).toFixed(2)}" class="pb-field mt-1 w-full"></label>
    <label class="text-sm font-semibold">Stock<input name="stock" type="number" required min="0" step="1" value="${product.stock}" class="pb-field mt-1 w-full"></label>
    <label class="text-sm font-semibold sm:col-span-2">Description<textarea name="description" required maxlength="1000" rows="3" class="pb-field mt-1 w-full">${escapeHtml(product.description)}</textarea></label>
    <label class="text-sm font-semibold sm:col-span-2">Image path or URL<input name="image_url" required maxlength="500" value="${escapeHtml(product.image_url)}" class="pb-field mt-1 w-full"></label>
    <label class="flex items-center gap-2 text-sm font-semibold"><input name="active" type="checkbox" ${product.active ? 'checked' : ''}> Available in storefront</label>
    <div class="flex items-center gap-3"><button class="pb-button" type="submit">Save product</button><span data-form-status role="status" class="text-sm"></span></div>
  </form>`).join('')}</div>`
}

function statusSelect(name, label, value, choices) {
  const options = [...new Set([value, ...choices])]
  return `<label class="block text-sm font-semibold">${label}<select name="${name}" class="pb-field mt-1 w-full">${options.map((option) => `<option value="${escapeHtml(option)}" ${option === value ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`
}

function orderEditors(orders) {
  if (!orders?.length) return empty('orders')
  return `<div class="grid gap-4">${orders.map((order) => `<form data-order-id="${escapeHtml(order.id)}" data-original-status="${escapeHtml(order.status)}" data-original-shipping="${escapeHtml(order.shipping_status)}" class="grid gap-4 rounded-2xl border border-[color:var(--pb-line)] bg-white p-4 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
    <div class="min-w-0"><p class="break-all font-mono text-xs text-[color:var(--pb-muted)]">${escapeHtml(order.id)}</p><p class="mt-1 font-semibold">${escapeHtml(order.profiles?.display_name || order.profiles?.email || 'Customer')}</p><p class="mt-1 text-sm">${money(order.total_cents)}</p></div>
    ${statusSelect('status', 'Order status', order.status, orderStatuses)}
    ${statusSelect('shipping_status', 'Shipping status', order.shipping_status || 'pending', shippingStatuses)}
    <div class="flex items-center gap-3"><button class="pb-button" type="submit">Save status</button><span data-form-status role="status" class="text-sm"></span></div>
  </form>`).join('')}</div>`
}

async function load() {
  const user = await getCurrentUser()
  if (!user) {
    location.href = '/login/?next=' + encodeURIComponent(location.pathname)
    return
  }

  let data
  try {
    data = await api(`/api/admin/${endpoint}`)
  } catch (error) {
    document.body.innerHTML = `<main class="pb-main"><h1 class="pb-display">${error.status === 403 ? 'Admin access required' : `Could not load ${labels[page].toLowerCase()}`}</h1><p role="alert" class="mt-3">${escapeHtml(error.message)}</p><div class="mt-5 flex gap-3"><button class="pb-button" onclick="location.reload()">Try again</button><a class="pb-button alt" href="/">Back to shop</a></div></main>`
    return
  }

  const value = endpoint === 'dashboard' ? data : data[endpoint] || data.orders || []
  const body = endpoint === 'dashboard'
    ? `<div class="pb-admin-metrics">${Object.entries(data).map(([key, item]) => `<div><b>${escapeHtml(key === 'revenue' ? 'Demo order total' : key)}</b><strong>${key === 'revenue' ? money(item) : escapeHtml(item)}</strong></div>`).join('')}</div><p class="mt-4 text-sm text-[color:var(--pb-muted)]">Order totals are demo records; no money is collected or charged.</p><div class="mt-8 border-t border-[color:var(--pb-line)] pt-6"><h2 class="text-xl font-bold">Invite an admin</h2><p class="mt-1 text-sm text-[color:var(--pb-muted)]">Send an admin invitation to an email that does not already have an account.</p><form id="admin-invite-form" class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"><label class="flex-1 text-sm font-semibold">Email address<input name="email" type="email" required maxlength="254" autocomplete="email" class="pb-field mt-1 w-full"></label><button class="pb-button" type="submit">Invite admin</button><span id="admin-invite-status" role="status" class="text-sm"></span></form></div>`
    : page === 'products' ? productEditors(value)
      : page === 'orders' || page === 'shipping' ? orderEditors(value)
        : readOnlyRows(value, page)

  document.body.innerHTML = `<header class="pb-shell"><div class="pb-nav"><a class="pb-brand" href="/"><span>PetitBakery</span></a><a href="/account/">${escapeHtml(user.displayName)}</a></div></header><main class="pb-main"><span class="pb-kicker">Back office</span><h1 class="pb-display" style="font-size:clamp(2.5rem,6vw,5rem)">${labels[page]}</h1><nav class="pb-admin-nav" aria-label="Admin">${nav()}</nav>${page === 'customers' || page === 'payments' || page === 'activity' ? '<p class="mb-4 text-sm text-[color:var(--pb-muted)]">Read-only records. Checkout is a demo and does not collect or charge payment.</p>' : ''}<section class="pb-admin-card" aria-label="${labels[page]}">${body}</section></main>`

  const inviteForm = document.querySelector('#admin-invite-form')
  inviteForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = inviteForm.querySelector('button[type="submit"]')
    const status = document.querySelector('#admin-invite-status')
    const email = new FormData(inviteForm).get('email')
    setBusy(button, true, 'Sending invite…')
    status.textContent = ''
    status.className = 'text-sm'
    try {
      const result = await api('/api/admin/invites', { method: 'POST', body: JSON.stringify({ email }) })
      inviteForm.reset()
      status.textContent = `Invitation sent to ${result.email}.`
    } catch (error) {
      status.textContent = error.message
      status.className = 'text-sm text-red-700'
    } finally {
      setBusy(button, false)
    }
  })

  document.querySelectorAll('form[data-product-id]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = form.querySelector('button[type="submit"]')
    const status = form.querySelector('[data-form-status]')
    setBusy(button, true, 'Saving…')
    status.textContent = ''
    status.className = 'text-sm'
    const fields = Object.fromEntries(new FormData(form))
    const payload = { name: fields.name, category: fields.category, description: fields.description, image_url: fields.image_url, price_cents: Math.round(Number(fields.price) * 100), stock: Number(fields.stock), active: form.elements.active.checked }
    try {
      await api(`/api/admin/products/${encodeURIComponent(form.dataset.productId)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      status.textContent = 'Saved.'
    } catch (error) {
      status.textContent = error.message
      status.className = 'text-sm text-red-700'
    } finally {
      setBusy(button, false)
    }
  }))

  document.querySelectorAll('form[data-order-id]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const button = form.querySelector('button[type="submit"]')
    const status = form.querySelector('[data-form-status]')
    const fields = new FormData(form)
    const payload = {}
    if (fields.get('status') !== form.dataset.originalStatus) payload.status = fields.get('status')
    if (fields.get('shipping_status') !== form.dataset.originalShipping) payload.shipping_status = fields.get('shipping_status')
    if (!Object.keys(payload).length) { status.textContent = 'No changes.'; return }
    setBusy(button, true, 'Saving…')
    status.textContent = ''
    status.className = 'text-sm'
    try {
      const { order } = await api(`/api/admin/orders/${encodeURIComponent(form.dataset.orderId)}`, { method: 'PATCH', body: JSON.stringify(payload) })
      form.dataset.originalStatus = order.status
      form.dataset.originalShipping = order.shipping_status
      status.textContent = 'Saved.'
    } catch (error) {
      status.textContent = error.message
      status.className = 'text-sm text-red-700'
    } finally {
      setBusy(button, false)
    }
  }))
}

load().catch((error) => {
  document.body.innerHTML = `<main class="pb-main"><h1 class="pb-display">Admin page unavailable</h1><p role="alert">${escapeHtml(error.message)}</p><a class="pb-button" href="/">Back to shop</a></main>`
})
