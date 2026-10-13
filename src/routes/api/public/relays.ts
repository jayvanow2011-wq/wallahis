// Public relay discovery endpoint.
//
// Returns the ordered list of HidenHost relay endpoints the native agent
// (and the browser client) should try. The agent polls this on startup and
// after every disconnect so new relays can be rolled out without rebuilding
// executables.
//
// Priority order: direct origin first (lowest latency), Cloudflare Worker
// proxy second (bypasses ISP/corporate blocks of the custom hostname).

import { createFileRoute } from '@tanstack/react-router'

type Relay = {
  ws: string
  http: string
  via: 'direct' | 'proxy'
  priority: number
}

const RELAYS: Relay[] = [
  {
    ws: 'wss://umad.servemc.net',
    http: 'https://umad.servemc.net',
    via: 'direct',
    priority: 1,
  },
  {
    ws: 'wss://cold-pond-1f9d.jay-068.workers.dev',
    http: 'https://cold-pond-1f9d.jay-068.workers.dev',
    via: 'proxy',
    priority: 2,
  },
]

export const Route = createFileRoute('/api/public/relays')({
  server: {
    handlers: {
      GET: async () => {
        return new Response(
          JSON.stringify({ relays: RELAYS, updated_at: Date.now() }),
          {
            headers: {
              'Content-Type': 'application/json; charset=utf-8',
              'Cache-Control': 'public, max-age=30',
              'Access-Control-Allow-Origin': '*',
            },
          },
        )
      },
    },
  },
})
