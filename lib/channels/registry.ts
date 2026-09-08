/**
 * Provider lookup.
 *
 * The shared pipeline reaches a provider only through this map, which is what
 * keeps `if (provider === 'telegram')` out of the pipeline itself. Adding a
 * third channel means writing an adapter and adding a line here.
 */
import type { ChannelAdapter, ProviderName } from "./types";
import { telegramAdapter } from "./telegram/adapter";
import { slackAdapter } from "./slack/adapter";

const adapters: Record<ProviderName, ChannelAdapter> = {
    telegram: telegramAdapter,
    slack: slackAdapter,
};

export function adapterFor(provider: ProviderName): ChannelAdapter {
    const adapter = adapters[provider];

    if (!adapter) {
        throw new Error(`No adapter for provider ${provider}`);
    }

    return adapter;
}
