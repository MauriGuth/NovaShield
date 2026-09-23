import type { ShieldStatus } from '@novashield/shared';
import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking, Platform, Pressable, StyleSheet } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { NovaShield } from '@/lib/native-shield';
import {
  describeShieldTest,
  judgeShieldTest,
  shieldTestUrl,
  type ShieldTestVerdict,
  type TunnelCounters,
} from '@/lib/shield-test';

function readCounters(): TunnelCounters {
  const diagnostics = NovaShield?.getShieldDiagnostics?.();
  return {
    testHits: diagnostics?.testHits ?? 0,
    queries: diagnostics?.queries ?? 0,
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * "Probá tu escudo": abre una página de prueba en el navegador y, al volver,
 * dice si el escudo la frenó y, si no, exactamente dónde tocar. Ver
 * src/lib/shield-test.ts para qué mide y por qué desde el navegador.
 */
export function ShieldTestCard({ status }: { status: ShieldStatus }) {
  const theme = useTheme();
  const [pending, setPending] = useState<TunnelCounters | null>(null);
  const [checking, setChecking] = useState(false);
  const [verdict, setVerdict] = useState<ShieldTestVerdict | null>(null);

  const finish = useCallback(
    async (before: TunnelCounters) => {
      setChecking(true);
      // En iOS el contador lo escribe la extensión, en otro proceso: puede
      // tardar un instante en verse desde la app.
      let after = readCounters();
      for (let i = 0; i < 10 && after.testHits <= before.testHits; i++) {
        await sleep(300);
        after = readCounters();
      }
      setVerdict(judgeShieldTest(status, before, after));
      setPending(null);
      setChecking(false);
    },
    [status],
  );

  // Al volver del navegador, se mira el resultado solo.
  useEffect(() => {
    if (!pending) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void finish(pending);
    });
    return () => sub.remove();
  }, [pending, finish]);

  const start = useCallback(async () => {
    setVerdict(null);
    if (status !== 'active' && status !== 'bypassed') {
      setVerdict(judgeShieldTest(status, readCounters(), readCounters()));
      return;
    }
    const before = readCounters();
    setPending(before);
    const nonce = Math.random().toString(36).slice(2, 10);
    try {
      await Linking.openURL(shieldTestUrl(nonce));
    } catch {
      setPending(null);
    }
  }, [status]);

  const copy = verdict
    ? describeShieldTest(verdict, Platform.OS === 'ios' ? 'ios' : 'android')
    : null;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="smallBold">Probá tu escudo</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Te abrimos una página de prueba en el navegador. Si el escudo funciona,
        no carga y te llega un aviso de Nova Shield. Después volvé acá para ver
        el resultado. La página no existe: no hay ningún riesgo.
      </ThemedText>

      {!pending && (
        <Pressable
          onPress={() => void start()}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <ThemedText type="smallBold" themeColor="accent">
            {verdict ? 'Probar de nuevo →' : 'Probar el escudo →'}
          </ThemedText>
        </Pressable>
      )}

      {pending && (
        <Pressable
          disabled={checking}
          onPress={() => void finish(pending)}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <ThemedText type="smallBold" themeColor="accent">
            {checking ? 'Mirando el resultado…' : 'Ya volví, ver el resultado →'}
          </ThemedText>
        </Pressable>
      )}

      {copy && (
        <ThemedView type="background" style={styles.result}>
          <ThemedText
            type="smallBold"
            style={{ color: copy.ok ? theme.accent : theme.warn }}>
            {copy.title}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {copy.detail}
          </ThemedText>
          {copy.steps && <ThemedText type="small">{copy.steps}</ThemedText>}
        </ThemedView>
      )}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  result: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  button: { paddingVertical: Spacing.one },
  pressed: { opacity: 0.6 },
});
