import { STRIPE_PLUGIN } from './plugins/stripe';
import { BACS_PLUGIN } from './plugins/bacs';
import { CHEQUE_PLUGIN } from './plugins/cheque';
import { COD_PLUGIN } from './plugins/cod';
import type { PaymentPlugin } from './types';

/** The built-in plugins. Hosts add their own with `registerPaymentPlugin`. */
export const PAYMENT_PLUGIN_CATALOG: Record<'stripe' | 'bacs' | 'cheque' | 'cod', PaymentPlugin> = {
  stripe: STRIPE_PLUGIN as unknown as PaymentPlugin,
  bacs: BACS_PLUGIN as unknown as PaymentPlugin,
  cheque: CHEQUE_PLUGIN as unknown as PaymentPlugin,
  cod: COD_PLUGIN as unknown as PaymentPlugin,
};

const registered = new Map<string, PaymentPlugin>();

/**
 * Add a payment provider beyond the built-ins (v15.4.0). Call once at app
 * start, before rendering the store. The plugin then appears under Admin →
 * Plugins → Payments and, once enabled there, at checkout. Its
 * `startCheckout` talks to the host's own server; that server records the
 * paid order. Built-in ids cannot be replaced.
 */
export function registerPaymentPlugin(plugin: PaymentPlugin): void {
  if (plugin.id in PAYMENT_PLUGIN_CATALOG) {
    throw new Error(`Payment plugin "${plugin.id}" is built in and cannot be replaced.`);
  }
  registered.set(plugin.id, plugin);
}

/** Built-in plugins followed by registered ones. */
export function listPaymentPlugins(): PaymentPlugin[] {
  return [...Object.values(PAYMENT_PLUGIN_CATALOG), ...registered.values()];
}

export function getPaymentPlugin(id: string): PaymentPlugin | null {
  return (PAYMENT_PLUGIN_CATALOG as Record<string, PaymentPlugin>)[id] ?? registered.get(id) ?? null;
}
