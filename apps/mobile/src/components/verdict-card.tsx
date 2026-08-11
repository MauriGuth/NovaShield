import type {
  AnalysisReason,
  AnalyzeMessageResponse,
  AnalyzeResponse,
} from '@novashield/shared';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { VERDICT_UI } from '@/lib/verdict-ui';

/** Lista de razones educativas, compartida entre las dos tarjetas. */
function ReasonList({ reasons }: { reasons: AnalysisReason[] }) {
  const theme = useTheme();
  if (reasons.length === 0) return null;

  return (
    <View style={styles.reasons}>
      <ThemedText type="smallBold" themeColor="textSecondary">
        POR QUÉ
      </ThemedText>
      {reasons.map((reason, index) => (
        // Un mensaje puede repetir un código (varios links con la misma señal):
        // el código solo no alcanza como key.
        <ThemedView
          key={`${reason.code}-${index}`}
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
  );
}

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

      <ReasonList reasons={result.reasons} />

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

/**
 * Veredicto de un MENSAJE: mismo lenguaje visual que el de enlaces, pero el
 * protagonista es el consejo del backend ("no pases el código", "llamá al
 * número que ya tenías"), que viene priorizado según el patrón más grave.
 *
 * `degraded` viene de la app (que sabe qué pidió): el análisis corrió sin las
 * capas pagas por el tope diario del plan gratuito, y eso se dice — un
 * análisis recortado presentado como completo es una tranquilidad de más.
 */
export function MessageVerdictCard({
  result,
  degraded = false,
}: {
  result: AnalyzeMessageResponse;
  degraded?: boolean;
}) {
  const theme = useTheme();
  const ui = VERDICT_UI[result.verdict];
  const worst = result.worstLink;

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.banner,
          { backgroundColor: theme[ui.softColor], borderColor: theme[ui.color] },
        ]}>
        <ThemedText type="subtitle" style={{ color: theme[ui.color] }}>
          {ui.messageTitle}
        </ThemedText>
        <ThemedText type="small">{result.advice}</ThemedText>
      </View>

      {worst && (
        <ThemedView type="backgroundElement" style={styles.reason}>
          <ThemedText type="smallBold">
            Enlace del mensaje: {VERDICT_UI[worst.verdict].short.toLowerCase()}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            {worst.domain}
          </ThemedText>
        </ThemedView>
      )}

      <ReasonList reasons={result.reasons} />

      {degraded && (
        <ThemedText type="small" themeColor="textSecondary">
          Análisis con las capas locales (alcanzaste el tope diario del plan
          gratuito): sin verificación de Web Risk ni IA.
        </ThemedText>
      )}

      {/* La promesa es sobre lo que controlamos: nuestro backend analiza y
          descarta, no persiste mensajes. No afirma nada sobre terceros — si
          corrió la IA, eso ya se ve en la razón correspondiente. */}
      <ThemedText type="small" themeColor="textSecondary">
        Analizado en {result.durationMs} ms · No guardamos el texto de tu
        mensaje.
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
