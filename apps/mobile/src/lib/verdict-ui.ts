import type { VerdictLevel } from '@novashield/shared';
import type { ThemeColor } from '@/constants/theme';

/** Textos y colores por veredicto — una sola fuente para todas las pantallas. */
export const VERDICT_UI: Record<
  VerdictLevel,
  {
    title: string;
    short: string;
    advice: string;
    color: ThemeColor;
    softColor: ThemeColor;
  }
> = {
  malicious: {
    title: 'Peligro detectado',
    short: 'Peligroso',
    advice: 'No abras este enlace ni cargues datos. Si ya lo abriste, no ingreses contraseñas y avisá a tu banco si compartiste algo.',
    color: 'danger',
    softColor: 'dangerSoft',
  },
  suspicious: {
    title: 'Enlace sospechoso',
    short: 'Sospechoso',
    advice: 'Hay señales de riesgo. Ante la duda, no lo abras: buscá el sitio oficial escribiendo la dirección vos mismo.',
    color: 'warn',
    softColor: 'warnSoft',
  },
  safe: {
    title: 'Sin señales de riesgo',
    short: 'Seguro',
    advice: 'No encontramos señales de amenaza. Igual, nunca ingreses claves que te pidan por mensajes inesperados.',
    color: 'accent',
    softColor: 'accentSoft',
  },
  unknown: {
    title: 'Sin datos suficientes',
    short: 'Sin datos',
    advice: 'No pudimos completar todas las verificaciones. Tratalo con cuidado hasta poder analizarlo de nuevo.',
    color: 'textSecondary',
    softColor: 'backgroundElement',
  },
};
