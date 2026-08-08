import { FREE_LIMITS, PLAN_LABELS } from '@novashield/shared';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { PurchasesPackage } from 'react-native-purchases';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { availablePackages, isBillingAvailable, purchase } from '@/lib/purchases';
import { usePlan } from '@/lib/use-plan';

/**
 * Pantalla de planes.
 *
 * Reglas de tono, no negociables: nada de miedo para vender. El público de
 * esta app son personas que ya tienen miedo —muchas ya perdieron plata— y
 * apretar ahí para cobrar sería exactamente lo que hace un estafador. Se dice
 * qué hace cada plan, qué sigue siendo gratis, y se deja decidir.
 *
 * Requisitos de tienda que resuelve esta pantalla: precio y duración visibles
 * antes de comprar (Apple 3.1.2), botón de restaurar compras (3.1.1), y links
 * a términos y privacidad.
 */
export default function PlanesScreen() {
  const theme = useTheme();
  const { tier, restorePurchases } = usePlan();
  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const found = await availablePackages();
      if (!cancelled) setPackages(found);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const buy = async (pkg: PurchasesPackage) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await purchase(pkg);
      if (result.cancelled) return;
      if (result.error) setMessage(result.error);
      else setMessage('¡Listo! Ya tenés la protección completa activa.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Planes</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tu plan actual: {PLAN_LABELS[tier]}.
            </ThemedText>
          </View>

          {/* Lo gratuito, primero y sin letra chica. */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Gratis para siempre</ThemedText>
            <Item text={`Analizar enlaces y mensajes cuando vos lo pedís (hasta ${FREE_LIMITS.analysesPerDay} por día con todas las capas; después seguimos revisando con las listas de amenazas).`} />
            <Item text="El Centro de Alertas y tu Score de Seguridad." />
            <Item text="El escáner de tu teléfono, que funciona sin internet." />
            <ThemedText type="small" themeColor="textSecondary">
              Nunca vamos a cobrarte por avisarte de una estafa que ya
              detectamos. Eso no se cobra.
            </ThemedText>
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Con Premium</ThemedText>
            <Item text="Escudo DNS siempre activo: bloquea los sitios de estafa en todas tus apps, aunque no abras Nova Shield." />
            <Item text="Revisión automática de los mensajes que te llegan." />
            <Item text="Análisis sin tope diario." />
          </ThemedView>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Con Familia</ThemedText>
            <Item text="Todo lo de Premium, para hasta 10 personas." />
            <Item text="Ver si los tuyos están protegidos, sin espiarlos: solo su estado, nunca lo que hacen." />
          </ThemedView>

          {!isBillingAvailable ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="small" themeColor="textSecondary">
                Las suscripciones no están disponibles en esta versión de
                prueba. Todas las funciones están abiertas para que puedas
                probarlas.
              </ThemedText>
            </ThemedView>
          ) : packages === null ? (
            <ActivityIndicator color={theme.accent} />
          ) : packages.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No pudimos cargar los planes ahora. Revisá tu conexión y volvé a
              entrar.
            </ThemedText>
          ) : (
            packages.map((pkg) => (
              <Pressable
                key={pkg.identifier}
                onPress={() => void buy(pkg)}
                disabled={busy}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: theme.accent,
                    opacity: pressed || busy ? 0.7 : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.primaryButtonText}>
                  {pkg.product.title} · {pkg.product.priceString}
                </ThemedText>
                <ThemedText type="small" style={styles.primaryButtonText}>
                  {describePeriod(pkg)}
                </ThemedText>
              </Pressable>
            ))
          )}

          {message && (
            <ThemedText type="small" themeColor="accent">
              {message}
            </ThemedText>
          )}

          {isBillingAvailable && (
            <Pressable
              onPress={() => void restorePurchases()}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
              <ThemedText type="smallBold" themeColor="accent">
                Ya pagué en otro teléfono — restaurar mi compra
              </ThemedText>
            </Pressable>
          )}

          <ThemedText type="small" themeColor="textSecondary">
            La suscripción se renueva sola hasta que la cancelés, desde los
            ajustes de tu cuenta de App Store o Google Play. Podés cancelar
            cuando quieras.
          </ThemedText>

          <View style={styles.legalRow}>
            <Pressable onPress={() => void Linking.openURL('https://novashield.ar/terminos')}>
              <ThemedText type="small" themeColor="accent">
                Términos
              </ThemedText>
            </Pressable>
            <Pressable onPress={() => void Linking.openURL('https://novashield.ar/privacidad')}>
              <ThemedText type="small" themeColor="accent">
                Privacidad
              </ThemedText>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Item({ text }: { text: string }) {
  return (
    <View style={styles.itemRow}>
      <ThemedText type="small" themeColor="accent">
        ·
      </ThemedText>
      <ThemedText type="small" style={styles.itemText}>
        {text}
      </ThemedText>
    </View>
  );
}

/** Duración legible; Apple exige que se vea antes de comprar. */
function describePeriod(pkg: PurchasesPackage): string {
  switch (pkg.packageType) {
    case 'MONTHLY':
      return 'por mes';
    case 'ANNUAL':
      return 'por año';
    case 'WEEKLY':
      return 'por semana';
    default:
      return pkg.product.description || '';
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', justifyContent: 'center' },
  safeArea: { flex: 1, maxWidth: MaxContentWidth },
  content: {
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.three,
  },
  header: { gap: Spacing.two, marginBottom: Spacing.one },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  itemRow: { flexDirection: 'row', gap: Spacing.two },
  itemText: { flexShrink: 1 },
  primaryButton: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
    gap: Spacing.half,
  },
  primaryButtonText: { color: '#FFFFFF' },
  linkButton: { paddingVertical: Spacing.one },
  pressed: { opacity: 0.6 },
  legalRow: { flexDirection: 'row', gap: Spacing.four },
});
