import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AnalysisReason,
  AnalyzeMessageResponse,
  AnalyzeResponse,
  DeviceScanResult,
  VerdictLevel,
} from '@novashield/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Estado local del escudo: historial de escaneos, alertas y postura del
 * dispositivo. Todo vive en el teléfono (privacidad por diseño). Lo único que
 * puede salir es el resumen del Modo Familia, y solo si el usuario se unió a
 * una: contadores y el score, nunca los enlaces ni el contenido de mensajes.
 */

export interface StoredAlert {
  id: string;
  url: string;
  domain: string;
  verdict: VerdictLevel;
  riskScore: number;
  reasons: AnalysisReason[];
  createdAt: string;
}

interface ShieldState {
  scansCount: number;
  alerts: StoredAlert[];
  /** Registra un análisis; crea alerta si el veredicto no fue "safe". */
  recordScan: (result: AnalyzeResponse) => void;
  dismissAlert: (id: string) => void;

  // — Escudo DNS —
  /** Se guarda para saber si el usuario ya lo activó alguna vez. */
  shieldEnabled: boolean;
  blocklistVersion: string | null;
  blocklistDomainCount: number;
  blocklistCheckedAt: number | null;
  /** Bloqueos acumulados; el contador nativo se reinicia al reiniciar el servicio. */
  totalBlocked: number;
  recentBlocks: BlockedDomain[];
  setShieldEnabled: (enabled: boolean) => void;
  recordBlocklistSync: (info: {
    version: string;
    domainCount: number;
  }) => void;
  recordBlockedDomain: (domain: string, at: number) => void;

  // — Protección de Mensajes —
  messageAlerts: StoredAlert[];
  recordMessageScan: (result: AnalyzeMessageResponse, preview: string) => void;
  dismissMessageAlert: (id: string) => void;

  // — Escáner del Dispositivo —
  /** Último resultado del escaneo local. Las señales crudas no se persisten. */
  deviceScan: DeviceScanResult | null;
  recordDeviceScan: (result: DeviceScanResult) => void;

  // — Modo Familia —
  /** Credenciales del integrante en este dispositivo (null si no está en ninguna). */
  family: { familyId: string; memberId: string; memberToken: string } | null;
  setFamilySession: (
    session: { familyId: string; memberId: string; memberToken: string } | null,
  ) => void;
}

export interface BlockedDomain {
  domain: string;
  at: number;
}

const MAX_ALERTS = 100;
const MAX_RECENT_BLOCKS = 50;

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useShield = create<ShieldState>()(
  persist(
    (set) => ({
      scansCount: 0,
      alerts: [],

      recordScan: (result) =>
        set((state) => {
          const alerts =
            result.verdict === 'safe'
              ? state.alerts
              : [
                  {
                    id: newId(),
                    url: result.submittedUrl,
                    domain: result.domain,
                    verdict: result.verdict,
                    riskScore: result.riskScore,
                    reasons: result.reasons,
                    createdAt: result.analyzedAt,
                  },
                  ...state.alerts,
                ].slice(0, MAX_ALERTS);
          return { scansCount: state.scansCount + 1, alerts };
        }),

      dismissAlert: (id) =>
        set((state) => ({
          alerts: state.alerts.filter((a) => a.id !== id),
        })),

      shieldEnabled: false,
      blocklistVersion: null,
      blocklistDomainCount: 0,
      blocklistCheckedAt: null,
      totalBlocked: 0,
      recentBlocks: [],

      setShieldEnabled: (enabled) => set({ shieldEnabled: enabled }),

      recordBlocklistSync: ({ version, domainCount }) =>
        set({
          blocklistVersion: version,
          blocklistDomainCount: domainCount,
          blocklistCheckedAt: Date.now(),
        }),

      recordBlockedDomain: (domain, at) =>
        set((state) => ({
          totalBlocked: state.totalBlocked + 1,
          recentBlocks: [{ domain, at }, ...state.recentBlocks].slice(
            0,
            MAX_RECENT_BLOCKS,
          ),
        })),

      messageAlerts: [],

      recordMessageScan: (result, preview) =>
        set((state) => {
          if (result.verdict === 'safe') return state;
          return {
            messageAlerts: [
              {
                id: newId(),
                url: preview.slice(0, 200),
                domain: result.worstLink?.domain ?? 'Mensaje',
                verdict: result.verdict,
                riskScore: result.riskScore,
                reasons: result.reasons,
                createdAt: result.analyzedAt,
              },
              ...state.messageAlerts,
            ].slice(0, MAX_ALERTS),
          };
        }),

      dismissMessageAlert: (id) =>
        set((state) => ({
          messageAlerts: state.messageAlerts.filter((a) => a.id !== id),
        })),

      deviceScan: null,
      recordDeviceScan: (result) => set({ deviceScan: result }),

      family: null,
      setFamilySession: (session) => set({ family: session }),
    }),
    {
      name: 'novashield-store',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

export interface ScoreBreakdown {
  score: number;
  pendingActions: string[];
}

/**
 * Score de Seguridad: mide protección real, no uso de la app. Las protecciones
 * que corren solas (Escudo DNS, Protección de Mensajes) pesan mucho más que el
 * hábito de escanear a mano, porque cubren al usuario cuando no está mirando.
 */
export function computeScore(state: {
  scansCount: number;
  alerts: StoredAlert[];
  shieldEnabled?: boolean;
  messageProtectionEnabled?: boolean;
  deviceScan?: DeviceScanResult | null;
}): ScoreBreakdown {
  const pendingActions: string[] = [];
  let score = 30; // base: tener la app instalada ya es algo

  if (state.shieldEnabled) {
    score += 30;
  } else {
    pendingActions.push(
      'Activá el Escudo DNS: bloquea los sitios de estafa en todas tus apps, sin que hagas nada.',
    );
  }

  if (state.messageProtectionEnabled) {
    score += 15;
  } else {
    pendingActions.push(
      'Activá la Protección de Mensajes para que revisemos los mensajes sospechosos que te llegan.',
    );
  }

  // La configuración del propio teléfono aporta hasta 15 puntos, proporcional
  // al resultado del escaneo: de nada sirve el mejor escudo sobre un equipo sin
  // bloqueo de pantalla.
  if (state.deviceScan) {
    score += Math.round((state.deviceScan.score / 100) * 15);
    const urgent = state.deviceScan.checks.filter((c) => c.status === 'critical');
    for (const check of urgent) {
      pendingActions.push(check.advice ?? check.title);
    }
  } else {
    pendingActions.push(
      'Revisá la seguridad de tu teléfono: el escaneo es local y tarda unos segundos.',
    );
  }

  if (state.scansCount === 0) {
    pendingActions.push('Probá el escáner con un enlace que te haya llegado.');
  } else {
    score += 10;
  }

  const dangerous = state.alerts.filter((a) => a.verdict === 'malicious').length;
  if (dangerous > 0) {
    score -= Math.min(30, dangerous * 10);
    pendingActions.push(
      dangerous === 1
        ? 'Tenés 1 alerta peligrosa sin resolver: revisala y descartala.'
        : `Tenés ${dangerous} alertas peligrosas sin resolver: revisalas.`,
    );
  }

  return { score: Math.max(5, Math.min(100, score)), pendingActions };
}
