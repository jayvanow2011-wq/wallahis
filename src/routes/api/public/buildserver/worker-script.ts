import { createFileRoute } from '@tanstack/react-router'
// Serves the latest build-worker.js source so the on-server worker can
// self-update without anyone running commands on the server.
// eslint-disable-next-line import/no-relative-packages
import workerSource from '../../../../../hidenhost/build-worker.js?raw'

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

export const Route = createFileRoute('/api/public/buildserver/worker-script')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await verifyBuildserverKey(request))) {
          return new Response('Unauthorized', { status: 401 })
        }
        return new Response(workerSource, {
          headers: {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        })
      },
    },
  },
})
