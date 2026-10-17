// Shared Claude access for Chowaniec (Netlify AI Gateway injects ANTHROPIC_API_KEY /
// ANTHROPIC_BASE_URL; a project-level ANTHROPIC_API_KEY also works).
import Anthropic from '@anthropic-ai/sdk';

export { Anthropic };

export function aiConfigured() {
  return !!(Netlify.env.get('ANTHROPIC_API_KEY') || Netlify.env.get('ANTHROPIC_AUTH_TOKEN'));
}

export function aiClient(timeoutMs = 55_000) {
  return new Anthropic({ timeout: timeoutMs, maxRetries: 0 });
}

export function textOf(response) {
  return response.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
}
