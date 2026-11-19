import { skillrouterRead } from '@/lib/server/skillrouterBff'

// Relay models + capabilities; `?refresh=1` is forwarded by the proxy.
export const GET = skillrouterRead('/api/skillrouter/catalog', 30_000)
