import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Link } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { NovaShield, isShieldAvailable } from '@/lib/native-shield';
import { isUnlockedForTesting } from '@/lib/purchases';
import { useShield as useShieldStore } from '@/lib/store';
import { describeStatus, useShieldController } from '@/lib/use-shield';
import { usePlan } from '@/lib/use-plan';

/**
 * Las dos protecciones que corren solas: el Escudo DNS y la Protección de
 * Mensajes. Se muestran juntas porque comparten la promesa —cuidarte sin que
 * hagas nada— y porque ambas dependen de un permiso que el usuario debe dar.
 */
export default function ProteccionScreen() {
  const theme = useTheme();
  const { status, busy, lastSync, error, enable, disable, sync } =
    useShieldController();
  const info = describeStatus(status);
  const { can } = usePlan();
  const canUseShield = can('shield');
  const canUseMessageGuard = can('messageGuard');

  const domainCount = useShieldStore((s) => s.blocklistDomainCount);
  const checkedAt = useShieldStore((s) => s.blocklistCheckedAt);
  const totalBlocked = useShieldStore((s) => s.totalBlocked);
  const recentBlocks = useShieldStore((s) => s.recentBlocks);

  const [syncing, setSyncing] = useState(false);

  // Se relee al volver al frente: los contadores los actualiza la extensión,
  // que corre en otro proceso, así que no llega ningún evento.
  const [diagnostics, setDiagnostics] = useState(() =>
    NovaShield?.getShieldDiagnostics?.(),
  );
  useEffect(() => {
    const refresh = () => setDiagnostics(NovaShield?.getShieldDiagnostics?.());
    const timer = setInterval(refresh, 3000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
  const [messagesEnabled, setMessagesEnabled] = useState(
    () => NovaShield?.isMessageProtectionEnabled() ?? false,
  );

  const isActive = status === 'active';
  const isProblem = status === 'preempted';
  const statusColor = isActive
    ? theme.accent
    : isProblem
      ? theme.warn
      : theme.textSecondary;

  // Al abrir la pantalla revisamos si la lista quedó vieja.
  useEffect(() => {
    if (isShieldAvailable) void sync();
  }, [sync]);

  const refreshList = useCallback(async () => {
    setSyncing(true);
    try {
      await sync({ force: true });
    } finally {
      setSyncing(false);
    }
  }, [sync]);

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Protección</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Lo que te cuida solo, mientras usás el teléfono normalmente.
            </ThemedText>
          </View>

          {/* — Escudo DNS — */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitle}>
                <View style={[styles.dot, { backgroundColor: statusColor }]} />
                <ThemedText type="smallBold">Escudo DNS</ThemedText>
              </View>
              <Switch
                value={isActive}
                disabled={!isShieldAvailable || busy || !canUseShield}
                onValueChange={(next) => void (next ? enable() : disable())}
                trackColor={{ true: theme.accent }}
              />
            </View>

            {!canUseShield && (
              <Link href="/planes" asChild>
                <Pressable
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                  <ThemedText type="smallBold" themeColor="accent">
                    El escudo continuo viene con Premium — ver planes →
                  </ThemedText>
                </Pressable>
              </Link>
            )}

            <ThemedText type="smallBold" style={{ color: statusColor }}>
              {info.label}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {info.detail}
            </ThemedText>

            {status === 'needs_permission' && (
              <Pressable
                onPress={() => void enable()}
                style={({ pressed }) => [
                  styles.linkButton,
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="accent">
                  Completar la activación →
                </ThemedText>
              </Pressable>
            )}

            {busy && <ActivityIndicator color={theme.accent} />}

            {error && (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {error}
              </ThemedText>
            )}

            {isActive && (
              <View style={styles.statsRow}>
                <Stat label="Bloqueos" value={String(totalBlocked)} />
                <Stat
                  label="Dominios vigilados"
                  value={domainCount.toLocaleString('es-AR')}
                />
              </View>
            )}

            {/*
              Diagnóstico del túnel, solo en builds de prueba. Son contadores
              (nunca dominios) que dicen dónde se corta la cadena: sin esto hay
              que conectar el teléfono a una Mac y filtrar Consola.app, que no
              es un camino de soporte viable.
            */}
            {isActive && isUnlockedForTesting && diagnostics && (
              <ThemedText type="small" themeColor="textSecondary">
                {diagnostics.available
                  ? `Diagnóstico · paquetes: ${diagnostics.packets} · consultas: ${diagnostics.queries} · bloqueos: ${diagnostics.blocked} · lista: ${diagnostics.listCount}`
                  : 'Diagnóstico · el túnel todavía no reportó ningún paquete.'}
              </ThemedText>
            )}
          </ThemedView>

          {/* — Lista de bloqueo — */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Lista de amenazas</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {domainCount > 0
                ? `${domainCount.toLocaleString('es-AR')} dominios en el dispositivo. El chequeo se hace acá adentro: ninguna de tus consultas sale del teléfono.`
                : 'Todavía no descargamos la lista. Se baja una vez y se revisa cada semana.'}
            </ThemedText>
            {checkedAt !== null && (
              <ThemedText type="small" themeColor="textSecondary">
                Última actualización:{' '}
                {new Date(checkedAt).toLocaleDateString('es-AR')}
              </ThemedText>
            )}
            {lastSync?.status === 'failed' && (
              <ThemedText type="small" style={{ color: theme.danger }}>
                {lastSync.error}
              </ThemedText>
            )}
            <Pressable
              onPress={() => void refreshList()}
              disabled={syncing || !isShieldAvailable}
              style={({ pressed }) => [
                styles.linkButton,
                (pressed || syncing) && styles.pressed,
              ]}>
              <ThemedText type="smallBold" themeColor="accent">
                {syncing ? 'Actualizando…' : 'Actualizar ahora'}
              </ThemedText>
            </Pressable>
          </ThemedView>

          {/* — Protección de Mensajes — */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardTitle}>
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor: messagesEnabled
                        ? theme.accent
                        : theme.textSecondary,
                    },
                  ]}
                />
                <ThemedText type="smallBold">Protección de Mensajes</ThemedText>
              </View>
            </View>

            {/*
              iOS NO expone si tu filtro de SMS está seleccionado, y tampoco deja
              abrir esa pantalla de Ajustes desde la app. Así que acá no se
              afirma "está apagado" —no lo sabemos— ni se ofrece un botón que
              llevaría a la pantalla equivocada: se dan los pasos exactos.
              `messagesEnabled` en iOS solo se vuelve true cuando la extensión
              CORRIÓ de verdad, y eso sí es prueba de que quedó activa.
            */}
            {Platform.OS === 'ios' ? (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  {messagesEnabled
                    ? 'Está funcionando: ya revisamos mensajes en este teléfono.'
                    : 'Se activa desde los Ajustes del sistema, en tres pasos. Apple no permite que la app lo haga por vos, ni que sepa si ya lo hiciste.'}
                </ThemedText>
                {!messagesEnabled && (
                  <>
                    <ThemedText type="small">
                      1. Ajustes → Apps → Mensajes{'\n'}
                      2. Tocá “Filtro de mensajes de texto”{'\n'}
                      3. Elegí Nova Shield
                    </ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Solo revisa SMS de números que no tenés agendados: Apple no
                      da acceso a los mensajes de tus contactos ni a iMessage.
                    </ThemedText>
                  </>
                )}
              </>
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                {messagesEnabled
                  ? 'Revisamos los mensajes que te llegan y te avisamos si detectamos una estafa.'
                  : 'Necesitamos tu permiso para revisar los mensajes entrantes. El análisis se hace en el teléfono.'}
              </ThemedText>
            )}

            {canUseMessageGuard && Platform.OS !== 'ios' ? (
              <Pressable
                onPress={async () => {
                  await NovaShield?.openMessageProtectionSettings();
                  setMessagesEnabled(
                    NovaShield?.isMessageProtectionEnabled() ?? false,
                  );
                }}
                disabled={!isShieldAvailable}
                style={({ pressed }) => [
                  styles.linkButton,
                  pressed && styles.pressed,
                ]}>
                <ThemedText type="smallBold" themeColor="accent">
                  {messagesEnabled ? 'Ver ajustes' : 'Activar'} →
                </ThemedText>
              </Pressable>
            ) : !canUseMessageGuard ? (
              <Link href="/planes" asChild>
                <Pressable
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                  <ThemedText type="smallBold" themeColor="accent">
                    La revisión automática viene con Premium — ver planes →
                  </ThemedText>
                </Pressable>
              </Link>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              Podés pegar cualquier mensaje en el escáner y revisarlo gratis,
              siempre.
            </ThemedText>
          </ThemedView>

          {recentBlocks.length > 0 && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Últimos bloqueos</ThemedText>
              {recentBlocks.slice(0, 8).map((block) => (
                <View key={`${block.domain}-${block.at}`} style={styles.blockRow}>
                  <ThemedText
                    type="small"
                    numberOfLines={1}
                    style={styles.blockDomain}>
                    {block.domain}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {new Date(block.at).toLocaleTimeString('es-AR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </ThemedText>
                </View>
              ))}
            </ThemedView>
          )}

          <ThemedText type="small" themeColor="textSecondary">
            Nova Shield reduce mucho el riesgo, pero ninguna app bloquea el 100%
            de las estafas: el sistema operativo pone límites. Tu criterio sigue
            siendo la mejor defensa.
          </ThemedText>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <ThemedText type="smallBold">{value}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
    </View>
  );
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
  cardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statsRow: { flexDirection: 'row', gap: Spacing.five, marginTop: Spacing.one },
  stat: { gap: Spacing.half },
  linkButton: { paddingVertical: Spacing.one },
  pressed: { opacity: 0.6 },
  blockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  blockDomain: { flexShrink: 1 },
});
