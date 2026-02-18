import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { Platform } from 'react-native';
import { useEffect } from 'react';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { ExtensionProvider } from './contexts/ExtensionContext';
import { MediaPlayerProvider } from './contexts/MediaPlayerContext';
import { SafeAreaProvider } from 'react-native-safe-area-context';

// ✅ initialRouteName em vez do obsoleto anchor
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    let vp = document.querySelector('meta[name="viewport"]') as HTMLMetaElement | null;
    if (!vp) { vp = document.createElement('meta'); vp.name = 'viewport'; document.head.appendChild(vp); }
    vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1, user-scalable=no, viewport-fit=cover';

    const styleId = '__app_global_reset__';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        *, *::before, *::after { box-sizing: border-box; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
        html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; overscroll-behavior: none; -webkit-text-size-adjust: 100%; }
        *:focus, *:focus-visible { outline: none !important; box-shadow: none !important; }
        input, textarea, select, button { -webkit-appearance: none; appearance: none; outline: none !important; }
        ::-webkit-scrollbar { display: none; }
        * { scrollbar-width: none; -ms-overflow-style: none; }
      `;
      document.head.appendChild(style);
    }

    const blockCtrlScroll = (e: WheelEvent) => { if (e.ctrlKey) e.preventDefault(); };
    const blockMultiTouch = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    let lastTap = 0;
    const blockDoubleTap = (e: TouchEvent) => { const now = Date.now(); if (now - lastTap < 300) e.preventDefault(); lastTap = now; };

    window.addEventListener('wheel', blockCtrlScroll, { passive: false });
    window.addEventListener('touchmove', blockMultiTouch, { passive: false });
    window.addEventListener('touchend', blockDoubleTap, { passive: false });

    return () => {
      window.removeEventListener('wheel', blockCtrlScroll);
      window.removeEventListener('touchmove', blockMultiTouch);
      window.removeEventListener('touchend', blockDoubleTap);
    };
  }, []);

  return (
    <SafeAreaProvider>
    <MediaPlayerProvider>
    <ExtensionProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <StatusBar style="auto" />
      </ThemeProvider>
    </ExtensionProvider>
    </MediaPlayerProvider>
    </SafeAreaProvider>
  );
}
