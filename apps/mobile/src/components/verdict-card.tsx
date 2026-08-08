import type { AnalyzeResponse } from '@novashield/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { VERDICT_UI } from '@/lib/verdict-ui';

/** Tarjeta de veredicto: banner con nivel de riesgo + razones educativas. */
export function VerdictCard({ result }: { result: AnalyzeResponse }) {
  const theme = useTheme();
  const ui = VERDICT_UI[result.verdict];
  const wasRedirected = result.finalUrl !== result.submittedUrl;

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.banner,
          { backgroundColor: theme[ui.softColor], borderColor: theme[ui.color] },
        ]}>
        <ThemedText type="subtitle" style={{ color: theme[ui.color] }}>
          {ui.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {result.domain}
        </ThemedText>
        {wasRedirected && (
          <ThemedText type="small" themeColor="textSecondary">
            El enlace redirige a: {result.finalUrl}
          </ThemedText>
        )}
        <ThemedText type="small">{ui.advice}</ThemedText>
      </View>

      {result.reasons.length > 0 && (
        <View style={styles.reasons}>
          <ThemedText type="smallBold" themeColor="textSecondary">
            POR QUÉ
          </ThemedText>
          {result.reasons.map((reason) => (
            <ThemedView
              key={reason.code}
              type="backgroundElement"
              style={styles.reason}>
              <View style={styles.reasonHeader}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        reason.severity === 'critical'
                          ? theme.danger
                          : reason.severity === 'warning'
                            ? theme.warn
                            : theme.textSecondary,
                    },
                  ]}
                />
                <ThemedText type="smallBold">{reason.title}</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                {reason.detail}
              </ThemedText>
            </ThemedView>
          ))}
        </View>
      )}

      <ThemedText type="small" themeColor="textSecondary">
        Analizado en {result.durationMs} ms · Capas:{' '}
        {[
          result.checkedLayers.blocklists && 'listas de amenazas',
          result.checkedLayers.webrisk && 'Web Risk',
          result.checkedLayers.heuristics && 'heurísticas',
          result.checkedLayers.ai && 'IA',
        ]
          .filter(Boolean)
          .join(' · ')}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.three,
    alignSelf: 'stretch',
  },
  banner: {
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  reasons: {
    gap: Spacing.two,
  },
  reason: {
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  reasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
