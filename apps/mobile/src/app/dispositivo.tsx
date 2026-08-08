import type { DeviceCheck, DeviceCheckStatus } from '@novashield/shared';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isDeviceScanAvailable, openSettingsFor, scanDevice } from '@/lib/device-scan';
import { useShield as useShieldStore } from '@/lib/store';

/**
 * Escáner del Dispositivo: revisa cómo está configurado el propio teléfono.
 *
 * El escaneo es 100% local — no hay ninguna llamada de red en esta pantalla ni
 * en device-scan.ts. Cada chequeo explica POR QUÉ importa y ofrece el botón que
 * lleva a la pantalla de Ajustes donde se arregla.
 */
export default function DispositivoScreen() {
  const theme = useTheme();
  const result = useShieldStore((s) => s.deviceScan);
  const recordDeviceScan = useShieldStore((s) => s.recordDeviceScan);
  const [scanning, setScanning] = useState(false);

  // Escanear es leer configuración local: sincrónico y barato. El resultado va
  // al store (sistema externo), no al estado de React, así que el efecto de
  // apertura no dispara renders en cascada.
  const scanIntoStore = useCallback(() => {
    const scan = scanDevice();
    if (scan) recordDeviceScan(scan);
  }, [recordDeviceScan]);

  // Un escaneo al abrir, y otro cada vez que la app vuelve al frente. Lo
  // segundo es lo que hace útil al botón "Abrir Ajustes": el usuario sale a
  // ponerse el PIN y vuelve — sin este listener la pantalla le seguiría
  // mostrando el problema como pendiente y el arreglo parecería no haber
  // servido. Apple además advierte que el resultado de canEvaluatePolicy no
  // debe cachearse porque cambia con el estado del sistema.
  useEffect(() => {
    if (!isDeviceScanAvailable) return;
    scanIntoStore();

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') scanIntoStore();
    });
    return () => sub.remove();
  }, [scanIntoStore]);

  const runScan = useCallback(() => {
    if (!isDeviceScanAvailable) return;
    setScanning(true);
    try {
      scanIntoStore();
    } finally {
      setScanning(false);
    }
  }, [scanIntoStore]);

  const scoreColor =
    result === null
      ? theme.textSecondary
      : result.score >= 80
        ? theme.accent
        : result.score >= 50
          ? theme.warn
          : theme.danger;

  const problems = result?.checks.filter((c) => c.status !== 'ok') ?? [];
  const fine = result?.checks.filter((c) => c.status === 'ok') ?? [];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Tu dispositivo</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Revisamos cómo está configurado tu teléfono. Todo el análisis pasa
              acá adentro: no mandamos nada a ningún servidor.
            </ThemedText>
          </View>

          {!isDeviceScanAvailable ? (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">No disponible en este build</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                El escáner del dispositivo necesita la app instalada desde una
                build nativa. En Expo Go no está disponible.
              </ThemedText>
            </ThemedView>
          ) : (
            <>
              <ThemedView type="backgroundElement" style={styles.scoreCard}>
                {scanning && result === null ? (
                  <ActivityIndicator color={theme.accent} />
                ) : (
                  <>
                    <ThemedText type="title" style={{ color: scoreColor }}>
                      {result?.score ?? '—'}
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {result === null
                        ? 'Todavía no escaneamos este teléfono.'
                        : problems.length === 0
                          ? 'Tu teléfono está bien configurado. Seguí así.'
                          : problems.length === 1
                            ? 'Encontramos 1 cosa para mejorar.'
                            : `Encontramos ${problems.length} cosas para mejorar.`}
                    </ThemedText>
                  </>
                )}
                <Pressable
                  onPress={runScan}
                  disabled={scanning}
                  style={({ pressed }) => [
                    styles.linkButton,
                    (pressed || scanning) && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" themeColor="accent">
                    {scanning ? 'Revisando…' : 'Volver a revisar'}
                  </ThemedText>
                </Pressable>
              </ThemedView>

              {problems.map((check) => (
                <CheckCard key={check.code} check={check} />
              ))}

              {fine.length > 0 && (
                <ThemedView type="backgroundElement" style={styles.card}>
                  <ThemedText type="smallBold">Lo que ya está bien</ThemedText>
                  {fine.map((check) => (
                    <View key={check.code} style={styles.okRow}>
                      <View style={[styles.dot, { backgroundColor: theme.accent }]} />
                      <ThemedText type="small" style={styles.okText}>
                        {check.title}
                      </ThemedText>
                    </View>
                  ))}
                </ThemedView>
              )}
            </>
          )}

          <ThemedText type="small" themeColor="textSecondary">
            Revisamos la configuración del sistema, no tus archivos ni tus apps.
            Nova Shield no puede leer el contenido de tu teléfono.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function CheckCard({ check }: { check: DeviceCheck }) {
  const theme = useTheme();
  const color = statusColor(check.status, theme);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardTitle}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <ThemedText type="smallBold" style={{ color }}>
          {check.title}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary">
        {check.detail}
      </ThemedText>
      {check.advice && (
        <ThemedText type="small">{check.advice}</ThemedText>
      )}
      {check.settingsSection && (
        <Pressable
          onPress={() => void openSettingsFor(check.settingsSection!)}
          style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
          <ThemedText type="smallBold" themeColor="accent">
            Abrir Ajustes →
          </ThemedText>
        </Pressable>
      )}
    </ThemedView>
  );
}

function statusColor(
  status: DeviceCheckStatus,
  theme: { accent: string; warn: string; danger: string; textSecondary: string },
): string {
  switch (status) {
    case 'critical':
      return theme.danger;
    case 'warning':
      return theme.warn;
    case 'info':
      return theme.textSecondary;
    default:
      return theme.accent;
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
  scoreCard: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.two,
    alignItems: 'center',
  },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  okRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  okText: { flexShrink: 1 },
  linkButton: { paddingVertical: Spacing.one },
  pressed: { opacity: 0.6 },
});
