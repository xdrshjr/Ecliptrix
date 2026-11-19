import { skillrouterWrite } from '@/lib/server/skillrouterBff'

// Zero-cost key check; the body may carry a key that is checked but never stored.
export const POST = skillrouterWrite('/api/skillrouter/verify', 'POST')
