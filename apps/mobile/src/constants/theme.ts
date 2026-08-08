/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#1C2430',
    background: '#FAFBF9',
    backgroundElement: '#F0F3F0',
    backgroundSelected: '#E1E6E2',
    textSecondary: '#57636E',
    accent: '#0E7C6B',
    accentSoft: '#E2EFEC',
    danger: '#B8402B',
    dangerSoft: '#F7E8E4',
    warn: '#96690D',
    warnSoft: '#F5EDDA',
  },
  dark: {
    text: '#E6EBE8',
    background: '#131820',
    backgroundElement: '#1A212B',
    backgroundSelected: '#2A333C',
    textSecondary: '#9AA6A9',
    accent: '#45BFA7',
    accentSoft: '#17352F',
    danger: '#E07A5F',
    dangerSoft: '#3A211B',
    warn: '#D9A83F',
    warnSoft: '#362C15',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
