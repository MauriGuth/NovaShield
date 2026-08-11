import {
  scanInputKind,
  type AnalyzeMessageResponse,
  type AnalyzeResponse,
} from '@novashield/shared';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MessageVerdictCard, VerdictCard } from '@/components/verdict-card';
import { BottomTabInset, Fonts, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { analyzeMessage, analyzeUrl, ApiError } from '@/lib/api';
import { localDateKey, useRemainingAnalyses, usePlan } from '@/lib/use-plan';
import { useShield } from '@/lib/store';

const REQUEST_TIMEOUT_MS = 25_000;

/**
 * Un solo estado para los dos veredictos posibles. Discriminado por `kind`
 * para que TypeScript obligue a renderizar la tarjeta que corresponde: un
 * AnalyzeResponse no tiene `advice` y un AnalyzeMessageResponse no tiene
 * `finalUrl` — mezclarlos rompería en runtime.
 */
type ScanResult =
  | { kind: 'link'; data: AnalyzeResponse }
  | { kind: 'message'; data: AnalyzeMessageResponse };

export default function ScannerScreen() {
  const theme = useTheme();
  const recordScan = useShield((s) => s.recordScan);
  const recordMessageScan = useShield((s) => s.recordMessageScan);
  const countAnalysis = useShield((s) => s.countAnalysis);
  const { tier } = usePlan();
  const remaining = useRemainingAnalyses(tier);
  // null = plan pago, sin tope.
  const deepAllowed = remaining === null || remaining > 0;
  // Texto que llega desde el menú Compartir (lo pasa _layout por parámetro).
  const { shared } = useLocalSearchParams<{ shared?: string }>();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Controla el análisis en curso: un pedido nuevo aborta al anterior en vez
  // de descartarse, así un segundo link compartido nunca se pierde ni hereda
  // el veredicto del primero. Usamos flags propios (no signal.reason) porque
  // pasar un motivo a abort() no está garantizado en Hermes.
  type Pending = { ctrl: AbortController; superseded: boolean; timedOut: boolean };
  const pendingRef = useRef<Pending | null>(null);
  const lastSharedRef = useRef<string | null>(null);

  const runAnalysis = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (pendingRef.current) pendingRef.current.superseded = true;
      pendingRef.current?.ctrl.abort();

      const pending: Pending = {
        ctrl: new AbortController(),
        superseded: false,
        timedOut: false,
      };
      pendingRef.current = pending;
      const timer = setTimeout(() => {
        pending.timedOut = true;
        pending.ctrl.abort();
      }, REQUEST_TIMEOUT_MS);

      setLoading(true);
      setError(null);
      setResult(null);
      try {
        // El tope del plan gratuito NO bloquea el análisis: se le pide al
        // backend que use solo las capas locales (listas + heurísticas +
        // patrones), que son gratis para nosotros y atajan la mayoría del
        // phishing real. Lo que se apaga es Web Risk y la IA, que cuestan por
        // consulta. El usuario siempre recibe un veredicto — dejarlo sin
        // respuesta frente a un link o un mensaje concreto sería inaceptable
        // en una app de seguridad.
        //
        // Un link suelto va al analizador de URLs (muestra redirecciones y
        // capas); todo lo demás va al de mensajes, que además de analizar los
        // links que traiga busca los patrones de estafa en el texto. Mandar un
        // mensaje por el camino de URLs perdía esa segunda señal — o fallaba
        // directamente si el mensaje no traía ningún link.
        if (scanInputKind(trimmed) === 'link') {
          const response = await analyzeUrl(trimmed, pending.ctrl.signal, {
            deepAnalysis: deepAllowed,
          });
          setResult({ kind: 'link', data: response });
          recordScan(response);
        } else {
          const response = await analyzeMessage(
            {
              text: trimmed,
              source: 'manual',
              ...(deepAllowed ? {} : { deepAnalysis: false }),
            },
            pending.ctrl.signal,
          );
          setResult({ kind: 'message', data: response });
          recordMessageScan(response, trimmed);
        }
        if (deepAllowed) countAnalysis(localDateKey());
      } catch (err) {
        if (pending.superseded) return; // otro análisis lo reemplazó
        if (pending.timedOut) {
          setError('El análisis tardó demasiado. Probá de nuevo.');
          return;
        }
        setError(
          err instanceof ApiError
            ? err.message
            : 'El análisis falló. Probá de nuevo en unos segundos.',
        );
      } finally {
        clearTimeout(timer);
        if (pendingRef.current === pending) {
          pendingRef.current = null;
          setLoading(false);
        }
      }
    },
    [recordScan, recordMessageScan, countAnalysis, deepAllowed],
  );

  // Links compartidos: analizamos cada valor nuevo una sola vez.
  useEffect(() => {
    if (shared && shared !== lastSharedRef.current) {
      lastSharedRef.current = shared;
      setInput(shared);
      void runAnalysis(shared);
    }
  }, [shared, runAnalysis]);

  const pasteFromClipboard = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setInput(text);
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Escáner</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Pegá un link o el mensaje completo. Los links se chequean contra
              bases de amenazas; en los mensajes buscamos además las estafas
              típicas: el pedido del código, el familiar con número nuevo, el
              paquete retenido.
            </ThemedText>
          </View>

          <TextInput
            style={[
              styles.input,
              {
                color: theme.text,
                backgroundColor: theme.backgroundElement,
                borderColor: theme.backgroundSelected,
              },
            ]}
            multiline
            value={input}
            onChangeText={setInput}
            placeholder="https://… o el texto del mensaje sospechoso"
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.buttonRow}>
            <Pressable
              onPress={pasteFromClipboard}
              style={({ pressed }) => [
                styles.secondaryButton,
                { borderColor: theme.accent, opacity: pressed ? 0.7 : 1 },
              ]}>
              <ThemedText type="smallBold" themeColor="accent">
                Pegar
              </ThemedText>
            </Pressable>
            <Pressable
              onPress={() => void runAnalysis(input)}
              disabled={!input.trim() || loading}
              style={({ pressed }) => [
                styles.primaryButton,
                {
                  backgroundColor: theme.accent,
                  opacity: !input.trim() || loading ? 0.4 : pressed ? 0.85 : 1,
                },
              ]}>
              <ThemedText type="smallBold" style={styles.primaryButtonText}>
                {loading ? 'Analizando…' : 'Analizar'}
              </ThemedText>
            </Pressable>
          </View>

          {loading && (
            <View style={styles.loading}>
              <ActivityIndicator color={theme.accent} />
              <ThemedText type="small" themeColor="textSecondary">
                Consultando bases de amenazas…
              </ThemedText>
            </View>
          )}

          {error && (
            <ThemedView type="backgroundElement" style={styles.errorCard}>
              <ThemedText type="smallBold" style={{ color: theme.danger }}>
                No pudimos analizarlo
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {error}
              </ThemedText>
            </ThemedView>
          )}

          {result &&
            (result.kind === 'link' ? (
              <VerdictCard result={result.data} />
            ) : (
              <MessageVerdictCard result={result.data} />
            ))}
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
    gap: Spacing.two,
  },
  input: {
    minHeight: 96,
    borderRadius: Spacing.three,
    borderWidth: 1,
    padding: Spacing.three,
    fontFamily: Fonts.mono,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.three,
  },
  secondaryButton: {
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
  },
  primaryButton: {
    flex: 1,
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#FFFFFF',
  },
  loading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  errorCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
});
