import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { NovaShield } from '@/lib/native-shield';
import { computeScore, useShield } from '@/lib/store';
import { VERDICT_UI } from '@/lib/verdict-ui';

const TIPS = [
  'Los bancos nunca piden claves ni tokens por teléfono, mail o WhatsApp.',
  'Ante un premio inesperado, la pregunta correcta es: ¿participé de algo?',
  'Escribí vos mismo la dirección de tu banco en el navegador: no entres por links de mensajes.',
  'Activá la verificación en dos pasos de WhatsApp: Ajustes → Cuenta.',
  'Si un mensaje te apura ("tu cuenta será bloqueada HOY"), sospechá: la urgencia es el gancho.',
];

export default function HomeScreen() {
  const theme = useTheme();
  const scansCount = useShield((s) => s.scansCount);
  const alerts = useShield((s) => s.alerts);
  const shieldEnabled = useShield((s) => s.shieldEnabled);
  const totalBlocked = useShield((s) => s.totalBlocked);
  const messageProtectionEnabled =
    NovaShield?.isMessageProtectionEnabled() ?? false;
  const { score, pendingActions } = computeScore({
    scansCount,
    alerts,
    shieldEnabled,
    messageProtectionEnabled,
  });

  const scoreColor =
    score >= 80 ? theme.accent : score >= 50 ? theme.warn : theme.danger;
  const tip = TIPS[new Date().getDate() % TIPS.length];
  const recentAlerts = alerts.slice(0, 3);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="smallBold" themeColor="accent">
              NOVA SHIELD
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Tu escudo digital
            </ThemedText>
          </View>

          <View style={styles.scoreSection}>
            <View style={[styles.scoreRing, { borderColor: scoreColor }]}>
              <ThemedText type="title" style={{ color: scoreColor }}>
                {score}
              </ThemedText>
            </View>
            <ThemedText type="subtitle" style={styles.centered}>
              Score de Seguridad
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {scansCount} {scansCount === 1 ? 'análisis hecho' : 'análisis hechos'} ·{' '}
              {alerts.length} {alerts.length === 1 ? 'alerta activa' : 'alertas activas'}
            </ThemedText>
          </View>

          <Link href="/proteccion" asChild>
            <Pressable>
              <ThemedView type="backgroundElement" style={styles.shieldCard}>
                <View style={styles.shieldRow}>
                  <View
                    style={[
                      styles.shieldDot,
                      {
                        backgroundColor: shieldEnabled
                          ? theme.accent
                          : theme.textSecondary,
                      },
                    ]}
                  />
                  <ThemedText type="smallBold">
                    {shieldEnabled ? 'Escudo DNS activo' : 'Escudo DNS apagado'}
                  </ThemedText>
                </View>
                <ThemedText type="small" themeColor="textSecondary">
                  {shieldEnabled
                    ? `${totalBlocked} ${totalBlocked === 1 ? 'sitio bloqueado' : 'sitios bloqueados'} hasta ahora.`
                    : 'Bloquea sitios de estafa en todas tus apps, sin que hagas nada.'}
                </ThemedText>
              </ThemedView>
            </Pressable>
          </Link>

          <Link href="/scanner" asChild>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
              ]}>
              <ThemedText type="smallBold" style={styles.primaryButtonText}>
                Analizar un enlace
              </ThemedText>
            </Pressable>
          </Link>

          {pendingActions.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                PARA SUBIR TU PUNTAJE
              </ThemedText>
              {pendingActions.map((action) => (
                <ThemedText key={action} type="small">
                  · {action}
                </ThemedText>
              ))}
            </ThemedView>
          )}

          {recentAlerts.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold" themeColor="textSecondary">
                ÚLTIMAS ALERTAS
              </ThemedText>
              {recentAlerts.map((alert) => (
                <View key={alert.id} style={styles.alertRow}>
                  <ThemedText
                    type="smallBold"
                    style={{ color: theme[VERDICT_UI[alert.verdict].color] }}>
                    {VERDICT_UI[alert.verdict].short}
                  </ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={1}
                    style={styles.alertDomain}>
                    {alert.domain}
                  </ThemedText>
                </View>
              ))}
              <Link href="/alerts" asChild>
                <Pressable>
                  <ThemedText type="small" themeColor="accent">
                    Ver todas →
                  </ThemedText>
                </Pressable>
              </Link>
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              CONSEJO DE HOY
            </ThemedText>
            <ThemedText type="small">{tip}</ThemedText>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  content: {
    padding: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.four,
    gap: Spacing.four,
  },
  header: {
    gap: Spacing.half,
  },
  scoreSection: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  scoreRing: {
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  primaryButton: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  shieldCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  shieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  shieldDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  alertDomain: {
    flexShrink: 1,
  },
});
