import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useLhubMediaPlayer } from './MediaPlayerContext';

// ─── Navigation types exposed to extensions ───────────────────────────────────

export interface ExtNavigation {
  push: (screenName: string, params?: any) => void;
  pop: () => void;
  popToRoot: () => void;
  getParams: () => any;
}

// ─── Extension types ──────────────────────────────────────────────────────────

export interface ExtensionTab {
  id: string;
  label: string;
  icon: string;
  iconActive?: string;
  component: React.ComponentType<{ navigation: ExtNavigation }>;
  screens?: Record<string, React.ComponentType<{ navigation: ExtNavigation; params: any }>>;
}

export interface ExtensionManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  tabs: ExtensionTab[];
}

export interface InstalledExtension {
  manifest: ExtensionManifest;
  iconUri: string | null;
  installedAt: number;
}

interface ExtensionContextValue {
  extensions: InstalledExtension[];
  installFromFile: (file: File) => Promise<{ ok: boolean; error?: string }>;
  installFromNative: () => Promise<{ ok: boolean; error?: string }>;
  uninstallExtension: (id: string) => void;
  /** Referências às APIs de media player — preenchidas pelo Provider */
  _mediaPlayerRef: React.MutableRefObject<ReturnType<typeof useLhubMediaPlayer> | null>;
}

const ExtensionContext = createContext<ExtensionContextValue>({
  extensions: [],
  installFromFile: async () => ({ ok: false }),
  installFromNative: async () => ({ ok: false }),
  uninstallExtension: () => {},
  _mediaPlayerRef: { current: null },
});

export function useExtensions() {
  return useContext(ExtensionContext);
}

// ─── Media Player Sandbox Bridge ──────────────────────────────────────────────
// Singleton ref que ExtensionProvider popula após montar.
// buildAPI() lê daqui para injetar as APIs nas extensões.
let _globalMediaPlayerRef: ReturnType<typeof useLhubMediaPlayer> | null = null;

export function _setGlobalMediaPlayer(mp: ReturnType<typeof useLhubMediaPlayer>) {
  _globalMediaPlayerRef = mp;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@lhub_v3';

interface PersistedExt {
  mainJs: string;
  iconUri: string | null;
  installedAt: number;
}

async function storageSave(map: Record<string, PersistedExt>): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (e) {
    console.warn('[lhub] storageSave error:', e);
  }
}

async function storageLoad(): Promise<Record<string, PersistedExt>> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ─── JSZip loader (web only via CDN) ─────────────────────────────────────────

async function getJSZip(): Promise<any> {
  if ((window as any).JSZip) return (window as any).JSZip;
  console.log('[lhub] Loading JSZip from CDN...');
  await new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => { console.log('[lhub] JSZip loaded'); res(); };
    s.onerror = () => rej(new Error('Failed to load JSZip from CDN'));
    document.head.appendChild(s);
  });
  return (window as any).JSZip;
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload  = () => res(fr.result as ArrayBuffer);
    fr.onerror = () => rej(new Error(`FileReader failed on "${file.name}"`));
    fr.readAsArrayBuffer(file);
  });
}

// ─── Sandbox API ─────────────────────────────────────────────────────────────

function buildAPI() {
  const RN  = require('react-native');
  const Rea = require('react-native-reanimated');
  const Ico = require('@expo/vector-icons');
  const AS  = require('@react-native-async-storage/async-storage');
  const AV  = require('expo-av');

  // WebView — importado condicionalmente para não quebrar se não instalado
  let WebViewComponent: any = null;
  try {
    WebViewComponent = require('react-native-webview').WebView;
  } catch (e) {
    console.warn('[lhub] react-native-webview não disponível:', e);
  }

  // ── Music Player Notification API ──────────────────────────────────────────
  // Extensões chamam: musicPlayer.update({ title, artist, artwork, isPlaying, duration, position })
  //                   musicPlayer.setHandlers({ onPlay, onPause, onNext, onPrev, onSeek })
  //                   musicPlayer.clear()
  const musicPlayer = {
    update: (info: any) => {
      _globalMediaPlayerRef?.musicNotification.update(info);
    },
    setHandlers: (handlers: any) => {
      _globalMediaPlayerRef?.musicNotification.setHandlers(handlers);
    },
    clear: () => {
      _globalMediaPlayerRef?.musicNotification.clear();
    },
    getCurrent: () => {
      return _globalMediaPlayerRef?.musicNotification.current ?? null;
    },
  };

  // ── Video Player API ────────────────────────────────────────────────────────
  // Extensões chamam: videoPlayer.open({ uri, title, startPosition, loop, onEnd, onClose, renderControls })
  //   renderControls: (api: VideoControlsAPI) => React.ReactNode
  //   VideoControlsAPI = { isPlaying, duration, position, buffered, isBuffering, isEnded,
  //                        uri, title, play(), pause(), togglePlay(), seek(s), skip(s), close() }
  //                   videoPlayer.close()
  //                   videoPlayer.isOpen()
  const videoPlayer = {
    open: (options: any) => {
      _globalMediaPlayerRef?.videoPlayer.open(options);
    },
    close: () => {
      _globalMediaPlayerRef?.videoPlayer.close();
    },
    isOpen: () => {
      return _globalMediaPlayerRef?.videoPlayer.isOpen ?? false;
    },
  };

  return {
    React,
    useState:               React.useState,
    useEffect:              React.useEffect,
    useCallback:            React.useCallback,
    useMemo:                React.useMemo,
    useRef:                 React.useRef,
    useContext:             React.useContext,
    createContext:          React.createContext,
    View:                   RN.View,
    Text:                   RN.Text,
    TextInput:              RN.TextInput,
    TouchableOpacity:       RN.TouchableOpacity,
    TouchableWithoutFeedback: RN.TouchableWithoutFeedback,
    Pressable:              RN.Pressable,
    PanResponder:           RN.PanResponder,
    ScrollView:             RN.ScrollView,
    FlatList:               RN.FlatList,
    Image:                  RN.Image,
    ActivityIndicator:      RN.ActivityIndicator,
    StyleSheet:             RN.StyleSheet,
    useColorScheme:         RN.useColorScheme,
    Platform:               RN.Platform,
    Linking:                RN.Linking,
    Alert:                  RN.Alert,
    Dimensions:             RN.Dimensions,
    StatusBar:              RN.StatusBar,
    Animated:               Rea.default ?? Rea,
    useSharedValue:         Rea.useSharedValue,
    useAnimatedStyle:       Rea.useAnimatedStyle,
    withSpring:             Rea.withSpring,
    withTiming:             Rea.withTiming,
    withSequence:           Rea.withSequence,
    interpolate:            Rea.interpolate,
    MaterialCommunityIcons: Ico.MaterialCommunityIcons,
    Ionicons:               Ico.Ionicons,
    FontAwesome:            Ico.FontAwesome,
    AsyncStorage:           AS.default ?? AS,
    Audio:                  AV.Audio,
    fetch:                  global.fetch.bind(global),
    console,
    // ── WebView — para extensões renderizarem embeds de player diretamente ──
    // Equivalente ao loadExtractor do Cloudstream: abre a URL do embed num
    // WebView em tela cheia que roda o JavaScript do player nativamente.
    WebView:               WebViewComponent,
    // ── Media Player APIs (para extensões) ──────────────────────────────────
    musicPlayer,   // notificação de player de música (lock-screen / barra)
    videoPlayer,   // player de vídeo em tela cheia
  };
}

// ─── Eval ─────────────────────────────────────────────────────────────────────

function evalMainJs(code: string): ExtensionManifest {
  console.log('[lhub] Evaluating main.js...');
  const api  = buildAPI();
  const keys = Object.keys(api);
  const vals = Object.values(api);
  const mod  = { exports: {} as any };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function('module', 'exports', ...keys, code);
    fn(mod, mod.exports, ...vals);
  } catch (e: any) {
    throw new Error(`JS error in main.js: ${e.message}`);
  }

  const exp = mod.exports;
  if (!exp || typeof exp !== 'object')
    throw new Error('main.js must assign module.exports = { id, name, tabs }');
  if (!exp.id)   throw new Error('Missing field: "id"');
  if (!exp.name) throw new Error('Missing field: "name"');
  if (!Array.isArray(exp.tabs) || exp.tabs.length === 0)
    throw new Error('Missing or empty "tabs" array');

  for (const tab of exp.tabs) {
    if (!tab.id)    throw new Error('Tab missing "id"');
    if (!tab.label) throw new Error(`Tab "${tab.id}" missing "label"`);
    if (!tab.icon)  throw new Error(`Tab "${tab.id}" missing "icon"`);
    if (typeof tab.component !== 'function')
      throw new Error(`Tab "${tab.id}": "component" must be a function (got ${typeof tab.component})`);
    if (tab.screens && typeof tab.screens !== 'object')
      throw new Error(`Tab "${tab.id}": "screens" must be an object`);
  }

  console.log('[lhub] Valid:', exp.id, exp.name, '- tabs:', exp.tabs.length);
  return exp as ExtensionManifest;
}

// ─── Parse zip buffer (lógica compartilhada) ─────────────────────────────────

async function parseZipBuffer(
  buffer: ArrayBuffer,
  JSZip: any
): Promise<{ manifest: ExtensionManifest; mainJs: string; iconUri: string | null }> {
  let zip: any;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (e: any) {
    throw new Error(`Not a valid zip/lhub file: ${e.message}`);
  }

  const files = Object.keys(zip.files);
  console.log('[lhub] Zip contents:', files);

  const mainFile = zip.file('main.js');
  if (!mainFile) throw new Error(`main.js not found. Found: ${files.join(', ')}`);

  const mainJs = await mainFile.async('string');
  console.log('[lhub] main.js length:', mainJs.length);

  let iconUri: string | null = null;
  const iconFile = zip.file('icon.png');
  if (iconFile) {
    const b64 = await iconFile.async('base64');
    iconUri = `data:image/png;base64,${b64}`;
  }

  const manifest = evalMainJs(mainJs);
  return { manifest, mainJs, iconUri };
}

// ─── Parse .lhub (web) ───────────────────────────────────────────────────────

async function parseLhubWeb(file: File) {
  console.log('[lhub] Parsing (web):', file.name);
  const JSZip = await getJSZip();
  const buf   = await readAsArrayBuffer(file);
  return parseZipBuffer(buf, JSZip);
}

// ─── Parse .lhub (native) ────────────────────────────────────────────────────

async function parseLhubNative(uri: string) {
  console.log('[lhub] Parsing (native):', uri);

  const FileSystem = require('expo-file-system/legacy');

  // Lê o arquivo como base64
  const b64: string = await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64',
  });

  // Converte base64 → ArrayBuffer
  const binary = atob(b64);
  const buf = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buf);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }

  // JSZip é puro JS, funciona no Hermes sem problemas
  let JSZip: any;
  try {
    JSZip = require('jszip');
  } catch {
    throw new Error('Pacote jszip não encontrado. Rode: npx expo install jszip');
  }

  return parseZipBuffer(buf, JSZip);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ExtensionProvider({ children }: { children: React.ReactNode }) {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);
  const mediaPlayer = useLhubMediaPlayer();
  const mediaPlayerRef = useRef<ReturnType<typeof useLhubMediaPlayer>>(mediaPlayer);

  // Mantém o ref e o global singleton sempre atualizados
  useEffect(() => {
    mediaPlayerRef.current = mediaPlayer;
    _setGlobalMediaPlayer(mediaPlayer);
  }, [mediaPlayer]);

  useEffect(() => {
    storageLoad().then(stored => {
      const ids = Object.keys(stored);
      if (!ids.length) return;
      const rehydrated: InstalledExtension[] = [];
      for (const [id, p] of Object.entries(stored)) {
        try {
          const manifest = evalMainJs(p.mainJs);
          rehydrated.push({ manifest, iconUri: p.iconUri, installedAt: p.installedAt });
        } catch (e) {
          console.warn(`[lhub] Failed to rehydrate "${id}":`, e);
        }
      }
      if (rehydrated.length) setExtensions(rehydrated);
    });
  }, []);

  // Web: recebe File object do input[type=file]
  const installFromFile = useCallback(async (file: File): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { manifest, mainJs, iconUri } = await parseLhubWeb(file);
      const installed: InstalledExtension = { manifest, iconUri, installedAt: Date.now() };
      setExtensions(prev => [...prev.filter(e => e.manifest.id !== manifest.id), installed]);
      const stored = await storageLoad();
      stored[manifest.id] = { mainJs, iconUri, installedAt: installed.installedAt };
      await storageSave(stored);
      return { ok: true };
    } catch (e: any) {
      console.error('[lhub] install error:', e);
      return { ok: false, error: e.message };
    }
  }, []);

  // Native: abre o document picker do sistema e instala
  const installFromNative = useCallback(async (): Promise<{ ok: boolean; error?: string }> => {
    try {
      const DocumentPicker = require('expo-document-picker');

      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) {
        return { ok: false, error: 'cancelled' };
      }

      const asset = result.assets[0];
      console.log('[lhub] Native picked:', asset.name, asset.uri);

      const { manifest, mainJs, iconUri } = await parseLhubNative(asset.uri);
      const installed: InstalledExtension = { manifest, iconUri, installedAt: Date.now() };
      setExtensions(prev => [...prev.filter(e => e.manifest.id !== manifest.id), installed]);
      const stored = await storageLoad();
      stored[manifest.id] = { mainJs, iconUri, installedAt: installed.installedAt };
      await storageSave(stored);
      return { ok: true };
    } catch (e: any) {
      console.error('[lhub] native install error:', e);
      return { ok: false, error: e.message };
    }
  }, []);

  const uninstallExtension = useCallback(async (id: string) => {
    setExtensions(prev => prev.filter(e => e.manifest.id !== id));
    const stored = await storageLoad();
    delete stored[id];
    await storageSave(stored);
  }, []);

  return (
    <ExtensionContext.Provider value={{ extensions, installFromFile, installFromNative, uninstallExtension, _mediaPlayerRef: mediaPlayerRef }}>
      {children}
    </ExtensionContext.Provider>
  );
}
