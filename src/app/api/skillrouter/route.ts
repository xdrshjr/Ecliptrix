import { skillrouterRead, skillrouterWrite } from '@/lib/server/skillrouterBff'

// Public relay state (never carries the key) and its two mutations.
export const GET = skillrouterRead('/api/skillrouter')
export const PUT = skillrouterWrite('/api/skillrouter', 'PUT')
export const DELETE = skillrouterWrite('/api/skillrouter', 'DELETE')
