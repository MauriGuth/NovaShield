import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  AnalysisReason,
  AnalyzeMessageResponse,
  AnalyzeResponse,
  VerdictLevel,
} from '@novashield/shared';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/**
 * Estado local del escudo: historial de escaneos y centro de alertas.
 * En el MVP las alertas viven solo en el dispositivo (privacidad por diseño);
 * la sincronización con el backend llega con cuentas y Modo Familia (Fase 3).
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
}): ScoreBreakdown {
  const pendingActions: string[] = [];
  let score = 40; // base: tener la app instalada ya es algo

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

  if (state.scansCount === 0) {
    pendingActions.push('Probá el escáner con un enlace que te haya llegado.');
  } else {
    score += 10;
  }
  if (state.scansCount >= 5) score += 5;

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
