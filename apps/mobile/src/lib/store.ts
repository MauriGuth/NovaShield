import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AnalysisReason, AnalyzeResponse, VerdictLevel } from '@novashield/shared';
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
}

const MAX_ALERTS = 100;

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
 * Score de Seguridad del MVP: parte de una base y premia el hábito de
 * escanear; las alertas peligrosas sin resolver lo bajan. Cuando lleguen el
 * Escudo DNS y el escáner del dispositivo, sus chequeos suman acá.
 */
export function computeScore(state: {
  scansCount: number;
  alerts: StoredAlert[];
}): ScoreBreakdown {
  const pendingActions: string[] = [];
  let score = 70;

  if (state.scansCount === 0) {
    pendingActions.push('Analizá tu primer enlace para activar el escudo.');
  } else {
    score += 15;
  }
  if (state.scansCount >= 5) {
    score += 15;
  } else if (state.scansCount > 0) {
    pendingActions.push('Hacé del análisis un hábito: 5 escaneos suman puntos.');
  }

  const dangerous = state.alerts.filter((a) => a.verdict === 'malicious').length;
  if (dangerous > 0) {
    score -= Math.min(40, dangerous * 15);
    pendingActions.push(
      dangerous === 1
        ? 'Tenés 1 alerta peligrosa sin resolver: revisala y descartala.'
        : `Tenés ${dangerous} alertas peligrosas sin resolver: revisalas.`,
    );
  }

  return { score: Math.max(5, Math.min(100, score)), pendingActions };
}
