import { ENTITLEMENTS, type PlanTier } from '@novashield/shared';
import { Platform } from 'react-native';
import Purchases, {
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesPackage,
} from 'react-native-purchases';

/**
 * Suscripciones vía RevenueCat.
 *
 * Apple y Google OBLIGAN a cobrar las suscripciones digitales con su propio
 * sistema (App Store guideline 3.1.1, Play Payments policy): no se puede meter
 * Stripe ni un link de pago acá adentro. RevenueCat es una capa arriba de
 * StoreKit y Play Billing que unifica ambos y valida los recibos del lado del
 * servidor — nos evita implementar esa validación (y equivocarnos).
 *
 * Sin claves configuradas el módulo queda apagado y la app entera funciona en
 * plan gratuito. Eso es deliberado: durante el desarrollo y en Expo Go nadie
 * debería toparse con un paywall roto.
 */

const IOS_KEY = process.env.EXPO_PUBLIC_RC_IOS_KEY ?? '';
const ANDROID_KEY = process.env.EXPO_PUBLIC_RC_ANDROID_KEY ?? '';

const apiKey = Platform.select({ ios: IOS_KEY, android: ANDROID_KEY }) ?? '';

/** ¿Hay cobros configurados en este build? */
export const isBillingAvailable = apiKey.length > 0;

let configured = false;

export async function initPurchases(): Promise<void> {
  if (!isBillingAvailable || configured) return;
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);

  // Sin appUserID: RevenueCat usa un ID anónimo por dispositivo. No mandamos
  // ningún identificador propio porque no tenemos cuentas de usuario, y no
  // queremos empezar a tenerlas por el cobro.
  await Purchases.configure({ apiKey });
  configured = true;
}

/** Plan vigente según los entitlements activos. */
export function planFromCustomerInfo(info: CustomerInfo | null): PlanTier {
  if (!info) return 'free';
  const active = info.entitlements.active;
  if (active[ENTITLEMENTS.family]) return 'family';
  if (active[ENTITLEMENTS.premium]) return 'premium';
  return 'free';
}

export async function currentPlan(): Promise<PlanTier> {
  if (!isBillingAvailable) return 'free';
  try {
    await initPurchases();
    return planFromCustomerInfo(await Purchases.getCustomerInfo());
  } catch {
    // Si RevenueCat no responde, el usuario queda en gratuito y la app sigue
    // andando. Nunca al revés: un error de red no puede regalar Premium, pero
    // tampoco puede romper la pantalla.
    return 'free';
  }
}

/** Paquetes disponibles (la oferta "current" configurada en el panel). */
export async function availablePackages(): Promise<PurchasesPackage[]> {
  if (!isBillingAvailable) return [];
  try {
    await initPurchases();
    const offerings = await Purchases.getOfferings();
    return offerings.current?.availablePackages ?? [];
  } catch {
    return [];
  }
}

export interface PurchaseOutcome {
  plan: PlanTier;
  cancelled: boolean;
  error?: string;
}

export async function purchase(pkg: PurchasesPackage): Promise<PurchaseOutcome> {
  try {
    await initPurchases();
    const { customerInfo } = await Purchases.purchasePackage(pkg);
    return { plan: planFromCustomerInfo(customerInfo), cancelled: false };
  } catch (err) {
    // Cancelar no es un error que haya que mostrarle a nadie.
    if (isUserCancelled(err)) return { plan: 'free', cancelled: true };
    return {
      plan: 'free',
      cancelled: false,
      error: 'No pudimos completar la suscripción. Probá de nuevo en un rato.',
    };
  }
}

/**
 * Restaurar compras. Apple lo EXIGE (guideline 3.1.1): si alguien cambia de
 * teléfono o reinstala, tiene que poder recuperar lo que pagó sin pagar otra
 * vez y sin escribirnos.
 */
export async function restore(): Promise<PlanTier> {
  if (!isBillingAvailable) return 'free';
  try {
    await initPurchases();
    return planFromCustomerInfo(await Purchases.restorePurchases());
  } catch {
    return 'free';
  }
}

function isUserCancelled(err: unknown): boolean {
  const e = err as { userCancelled?: boolean; code?: string | number };
  return e?.userCancelled === true || e?.code === '1' || e?.code === 1;
}
