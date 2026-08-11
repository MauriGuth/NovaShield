import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { StoredAlert, useShield } from '@/lib/store';
import { VERDICT_UI } from '@/lib/verdict-ui';

export default function AlertsScreen() {
  const linkAlerts = useShield((s) => s.alerts);
  const messageAlerts = useShield((s) => s.messageAlerts);

  // Una sola línea de tiempo: las alertas de mensajes se guardaban en el store
  // pero ninguna pantalla las mostraba — un análisis que asustó al usuario
  // desaparecía de la app al salir del escáner. `kind` decide el descarte
  // (cada lista tiene el suyo) y la etiqueta de la tarjeta.
  const alerts = [
    ...linkAlerts.map((a) => ({ ...a, kind: 'link' as const })),
    ...messageAlerts.map((a) => ({ ...a, kind: 'message' as const })),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <FlatList
          data={alerts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.header}>
              <ThemedText type="subtitle">Centro de alertas</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Todo lo que el escudo detectó, en un solo lugar.
              </ThemedText>
            </View>
          }
          ListEmptyComponent={
            <ThemedView type="backgroundElement" style={styles.emptyCard}>
              <ThemedText type="smallBold">Sin alertas por ahora</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Cuando un análisis detecte algo riesgoso, va a aparecer acá con
                la explicación y los pasos a seguir.
              </ThemedText>
            </ThemedView>
          }
          renderItem={({ item }) => <AlertCard alert={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function AlertCard({
  alert,
}: {
  alert: StoredAlert & { kind: 'link' | 'message' };
}) {
  const theme = useTheme();
  const dismissAlert = useShield((s) => s.dismissAlert);
  const dismissMessageAlert = useShield((s) => s.dismissMessageAlert);
  const dismiss = alert.kind === 'message' ? dismissMessageAlert : dismissAlert;
  const ui = VERDICT_UI[alert.verdict];
  const date = new Date(alert.createdAt);

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardHeader}>
        <View
          style={[styles.chip, { backgroundColor: theme[ui.softColor] }]}>
          <ThemedText type="smallBold" style={{ color: theme[ui.color] }}>
            {ui.short}
          </ThemedText>
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {date.toLocaleDateString('es-AR')}{' '}
          {date.toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </ThemedText>
      </View>

      <ThemedText type="smallBold" numberOfLines={1}>
        {alert.kind === 'message'
          ? alert.domain
            ? `Mensaje · ${alert.domain}`
            : 'Mensaje analizado'
          : alert.domain}
      </ThemedText>
      {/* En un mensaje, `url` es el texto que se analizó (recortado). */}
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
        {alert.url}
      </ThemedText>

      {alert.reasons[0] && (
        <ThemedText type="small" themeColor="textSecondary">
          {alert.reasons[0].title}
          {alert.reasons.length > 1 &&
            ` (+${alert.reasons.length - 1} ${
              alert.reasons.length === 2 ? 'señal más' : 'señales más'
            })`}
        </ThemedText>
      )}

      <Pressable
        onPress={() => dismiss(alert.id)}
        style={({ pressed }) => pressed && styles.pressed}>
        <ThemedText type="small" themeColor="accent">
          Ya lo resolví · Descartar
        </ThemedText>
      </Pressable>
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
  },
  header: {
    gap: Spacing.two,
    marginBottom: Spacing.four,
  },
  emptyCard: {
    borderRadius: Spacing.three,
    padding: Spacing.four,
    gap: Spacing.two,
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chip: {
    borderRadius: 99,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.half,
  },
  separator: {
    height: Spacing.three,
  },
  pressed: {
    opacity: 0.6,
  },
});
