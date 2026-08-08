import type { FamilyMember } from '@novashield/shared';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useFamilyController } from '@/lib/use-family';

/**
 * Modo Familia: ver de un vistazo si los tuyos están protegidos.
 *
 * La pantalla dice explícitamente qué se comparte y qué no, porque es la única
 * forma honesta de pedirle a alguien que se sume — y porque la política de
 * Google Play sobre apps de monitoreo exige que el monitoreado sepa
 * exactamente qué se ve de él.
 */
export default function FamiliaScreen() {
  const { session, overview, busy, error, create, join, leave, share } =
    useFamilyController();
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  // Publica el estado propio al abrir y cada vez que la app vuelve al frente:
  // sin esto la pantalla queda congelada mostrando la foto del primer render, y
  // en una pantalla que dice "tu mamá está protegida" el dato viejo engaña.
  useEffect(() => {
    if (!session) return;
    void share();

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void share();
    });
    return () => sub.remove();
  }, [session, share]);

  if (!session) return <SinFamilia busy={busy} error={error} onCreate={create} onJoin={join} />;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="subtitle">{overview?.name ?? 'Tu familia'}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              El estado de protección de cada uno. Nada más que eso.
            </ThemedText>
          </View>

          {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}
          {!overview && busy && <ActivityIndicator />}

          {overview?.members.map((member) => (
            <MemberCard key={member.id} member={member} />
          ))}

          {overview && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Invitar a alguien</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Pasale este código. Lo tiene que escribir en Nova Shield desde su
                propio teléfono: nadie entra sin hacerlo él mismo.
              </ThemedText>
              <ThemedText type="title" style={styles.code}>
                {overview.inviteCode}
              </ThemedText>
              <Pressable
                onPress={() =>
                  void Share.share({
                    message: `Sumate a nuestra familia en Nova Shield con el código ${overview.inviteCode}`,
                  })
                }
                style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                <ThemedText type="smallBold" themeColor="accent">
                  Compartir el código →
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Qué ve tu familia</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Ven si tenés el escudo activo, el puntaje de tu teléfono y cuántas
              amenazas te frenamos.{'\n\n'}
              NO ven las páginas que visitás, ni tus mensajes, ni dónde estás.
              Nova Shield no lo manda a ningún lado — ni siquiera nosotros lo
              tenemos. Y vos ves de ellos exactamente lo mismo que ellos de vos.
            </ThemedText>
          </ThemedView>

          {/*
            Confirmación en dos toques en vez de Alert.alert: en react-native-web
            `Alert` es un no-op, así que el botón no hacía absolutamente nada al
            abrir la app en el navegador. Esto funciona igual en las tres
            plataformas.
          */}
          {!confirmingLeave ? (
            <Pressable
              onPress={() => setConfirmingLeave(true)}
              disabled={busy}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
              <ThemedText type="smallBold" style={styles.error}>
                Salir de la familia
              </ThemedText>
            </Pressable>
          ) : (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">¿Seguro que querés salir?</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Vas a dejar de compartir tu estado y no vas a ver el de los
                demás. Podés volver a entrar con el código.
              </ThemedText>
              <View style={styles.confirmRow}>
                <Pressable
                  onPress={() => setConfirmingLeave(false)}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                  <ThemedText type="smallBold" themeColor="accent">
                    Cancelar
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => void leave()}
                  disabled={busy}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                  <ThemedText type="smallBold" style={styles.error}>
                    {busy ? 'Saliendo…' : 'Sí, salir'}
                  </ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          )}
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

function MemberCard({ member }: { member: FamilyMember }) {
  const theme = useTheme();
  const status = member.status;

  const color = !status
    ? theme.textSecondary
    : status.shieldActive
      ? theme.accent
      : theme.warn;

  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <View style={styles.cardTitle}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <ThemedText type="smallBold">
          {member.displayName}
          {member.isYou ? ' (vos)' : ''}
        </ThemedText>
      </View>

      {!status ? (
        <ThemedText type="small" themeColor="textSecondary">
          Todavía no abrió la app desde que se sumó.
        </ThemedText>
      ) : (
        <>
          <ThemedText type="small" style={{ color }}>
            {status.shieldActive ? 'Escudo activo' : 'Escudo apagado'}
          </ThemedText>
          <View style={styles.statsRow}>
            {status.deviceScanScore !== null && (
              <Stat label="Teléfono" value={String(status.deviceScanScore)} />
            )}
            <Stat label="Bloqueos" value={String(status.blockedCount)} />
            <Stat label="Alertas" value={String(status.alertCount)} />
          </View>
          <ThemedText type="small" themeColor="textSecondary">
            Actualizado el{' '}
            {new Date(status.reportedAt).toLocaleDateString('es-AR')}
          </ThemedText>
        </>
      )}
    </ThemedView>
  );
}

function SinFamilia({
  busy,
  error,
  onCreate,
  onJoin,
}: {
  busy: boolean;
  error: string | null;
  onCreate: (name: string, displayName: string) => Promise<boolean>;
  onJoin: (code: string, displayName: string) => Promise<boolean>;
}) {
  const theme = useTheme();
  const [mode, setMode] = useState<'none' | 'create' | 'join'>('none');
  const [familyName, setFamilyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [code, setCode] = useState('');

  const inputStyle = [
    styles.input,
    { borderColor: theme.textSecondary, color: theme.text },
  ];

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Modo Familia</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Enterate si tus viejos o tus hijos están protegidos, sin espiarlos.
            </ThemedText>
          </View>

          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Cómo funciona</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Cada uno se suma escribiendo el código en su propio teléfono, y
              comparte solo tres cosas: si tiene el escudo activo, el puntaje de
              seguridad de su equipo y cuántas amenazas se le frenaron.
              {'\n\n'}
              Nadie ve las páginas que visita el otro, ni sus mensajes, ni su
              ubicación. Todos ven lo mismo de todos, y cualquiera puede salir
              cuando quiera.
            </ThemedText>
          </ThemedView>

          {/*
            Información previa al consentimiento (Ley 25.326, art. 6): quién es
            el responsable, para qué se usan los datos, quiénes los ven, que dar
            los datos es voluntario y cómo ejercer los derechos de acceso,
            rectificación y supresión. Tiene que estar ANTES de que la persona
            confirme, no escondida en un link.
          */}
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="smallBold">Antes de sumarte</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Responsable de los datos: Nova Solutions SAS, Neuquén, Argentina.
              {'\n\n'}
              Sumarte es voluntario y no hace falta para usar el resto de Nova
              Shield: el escáner, el escudo y las alertas funcionan igual sin
              Modo Familia.
              {'\n\n'}
              Los únicos datos que se comparten son los tres de arriba, y solo
              con los integrantes de tu grupo. Podés ver, corregir o borrar tus
              datos cuando quieras: al salir del grupo se elimina tu estado
              compartido.
            </ThemedText>
          </ThemedView>

          {error && <ThemedText type="small" style={styles.error}>{error}</ThemedText>}

          {mode === 'none' && (
            <>
              <Pressable
                onPress={() => setMode('create')}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
                ]}>
                <ThemedText type="smallBold" style={styles.primaryButtonText}>
                  Crear una familia
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setMode('join')}
                style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
                <ThemedText type="smallBold" themeColor="accent">
                  Ya tengo un código de invitación →
                </ThemedText>
              </Pressable>
            </>
          )}

          {mode === 'create' && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Crear una familia</ThemedText>
              <TextInput
                style={inputStyle}
                placeholder="Nombre de la familia (Los Pérez)"
                placeholderTextColor={theme.textSecondary}
                value={familyName}
                onChangeText={setFamilyName}
                maxLength={40}
              />
              <TextInput
                style={inputStyle}
                placeholder="Cómo te ven a vos (Mamá)"
                placeholderTextColor={theme.textSecondary}
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={30}
              />
              <Pressable
                onPress={() => void onCreate(familyName.trim(), displayName.trim())}
                disabled={busy || familyName.trim().length < 2 || displayName.trim().length < 2}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: theme.accent,
                    opacity:
                      pressed || busy || familyName.trim().length < 2 || displayName.trim().length < 2
                        ? 0.6
                        : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.primaryButtonText}>
                  {busy ? 'Creando…' : 'Crear'}
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {mode === 'join' && (
            <ThemedView type="backgroundElement" style={styles.card}>
              <ThemedText type="smallBold">Unirte con un código</ThemedText>
              <TextInput
                style={[...inputStyle, styles.codeInput]}
                placeholder="ABCD-2345"
                placeholderTextColor={theme.textSecondary}
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
              />
              <TextInput
                style={inputStyle}
                placeholder="Cómo te ven a vos (Papá)"
                placeholderTextColor={theme.textSecondary}
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={30}
              />
              <Pressable
                onPress={() => void onJoin(code.trim(), displayName.trim())}
                disabled={busy || code.trim().length < 6 || displayName.trim().length < 2}
                style={({ pressed }) => [
                  styles.primaryButton,
                  {
                    backgroundColor: theme.accent,
                    opacity:
                      pressed || busy || code.trim().length < 6 || displayName.trim().length < 2
                        ? 0.6
                        : 1,
                  },
                ]}>
                <ThemedText type="smallBold" style={styles.primaryButtonText}>
                  {busy ? 'Uniéndote…' : 'Unirme'}
                </ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {mode !== 'none' && (
            <Pressable
              onPress={() => setMode('none')}
              style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}>
              <ThemedText type="small" themeColor="textSecondary">
                ← Volver
              </ThemedText>
            </Pressable>
          )}
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
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  cardTitle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statsRow: { flexDirection: 'row', gap: Spacing.five, marginTop: Spacing.one },
  stat: { gap: Spacing.half },
  confirmRow: { flexDirection: 'row', gap: Spacing.five, alignItems: 'center' },
  code: { letterSpacing: 4, textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  codeInput: { letterSpacing: 3, textAlign: 'center' },
  primaryButton: {
    borderRadius: Spacing.three,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButtonText: { color: '#FFFFFF' },
  linkButton: { paddingVertical: Spacing.one },
  pressed: { opacity: 0.6 },
  error: { color: '#B8402B' },
});
