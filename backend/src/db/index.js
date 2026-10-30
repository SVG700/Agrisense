/**
 * Picks the data store: Supabase when configured, in-memory otherwise.
 */
import { integrationFlags } from '../config.js';
import { createMemoryStore } from './memoryStore.js';

export async function createStore({ config, logger }) {
  if (integrationFlags(config).supabase) {
    const { createSupabaseStore } = await import('./supabaseStore.js');
    return createSupabaseStore({ config, logger });
  }
  return createMemoryStore();
}
