import type { AISettings } from '../profile';
import type { AIProvider } from './provider';
import { GeminiProvider } from './gemini';
import { OnDeviceProvider } from './onDevice';
import { ProxyProvider } from './proxy';

export { AIError } from './provider';
export type { AIProvider, GenerateInput } from './provider';
export { isOnDeviceAvailable } from './onDevice';

/** Selects the concrete provider from the user's settings. */
export function getProvider(settings: AISettings): AIProvider {
  switch (settings.provider) {
    case 'onDevice':
      return new OnDeviceProvider();
    case 'proxy':
      return new ProxyProvider(settings.proxyUrl, settings.proxyToken);
    case 'gemini':
    default:
      return new GeminiProvider(settings.apiKey, settings.model);
  }
}
