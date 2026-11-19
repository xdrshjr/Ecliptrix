import { skillrouterWrite } from '@/lib/server/skillrouterBff'

// Sends one minimal chat request through the relay for a single LLM slot.
export const POST = skillrouterWrite('/api/skillrouter/test-slot', 'POST')
