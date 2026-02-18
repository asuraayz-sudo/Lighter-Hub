import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';

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
  uninstallExtension: (id: string) => void;
}

const ExtensionContext = createContext<ExtensionContextValue>({
  extensions: [],
  installFromFile: async () => ({ ok: false }),
  uninstallExtension: () => {},
});

export function useExtensions() {
  return useContext(ExtensionContext);
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = '@lhub_v3';

interface PersistedExt {
  mainJs: string;
  iconUri: string | null;
  installedAt: number;
}

function storageSave(map: Record<string, PersistedExt>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch (e) {
    console.warn('[lhub] storageSave error:', e);
  }
}

function storageLoad(): Record<string, PersistedExt> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

// ─── JSZip ────────────────────────────────────────────────────────────────────

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
    Pressable:              RN.Pressable,
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
    fetch:                  window.fetch.bind(window),
    console,
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
    const fn = new Function('module', 'exports', ...keys, code);
    fn(mod, mod.exports, ...vals);
  } catch (e: any) {
    throw new Error(`JS error in main.js: ${e.message}`);
  }

  const exp = mod.exports;
  console.log('[lhub] module.exports =', exp);

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
    // screens is optional but must be object if present
    if (tab.screens && typeof tab.screens !== 'object')
      throw new Error(`Tab "${tab.id}": "screens" must be an object`);
  }

  console.log('[lhub] Valid:', exp.id, exp.name, '- tabs:', exp.tabs.length);
  return exp as ExtensionManifest;
}

// ─── Parse .lhub ─────────────────────────────────────────────────────────────

async function parseLhub(file: File): Promise<{ manifest: ExtensionManifest; mainJs: string; iconUri: string | null }> {
  console.log('[lhub] Parsing:', file.name, 'size:', file.size);
  const JSZip = await getJSZip();
  const buf   = await readAsArrayBuffer(file);
  console.log('[lhub] ArrayBuffer:', buf.byteLength);

  let zip: any;
  try {
    zip = await JSZip.loadAsync(buf);
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

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ExtensionProvider({ children }: { children: React.ReactNode }) {
  const [extensions, setExtensions] = useState<InstalledExtension[]>([]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const stored = storageLoad();
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
  }, []);

  const installFromFile = useCallback(async (file: File): Promise<{ ok: boolean; error?: string }> => {
    try {
      const { manifest, mainJs, iconUri } = await parseLhub(file);
      const installed: InstalledExtension = { manifest, iconUri, installedAt: Date.now() };
      setExtensions(prev => [...prev.filter(e => e.manifest.id !== manifest.id), installed]);
      const stored = storageLoad();
      stored[manifest.id] = { mainJs, iconUri, installedAt: installed.installedAt };
      storageSave(stored);
      return { ok: true };
    } catch (e: any) {
      console.error('[lhub] install error:', e);
      return { ok: false, error: e.message };
    }
  }, []);

  const uninstallExtension = useCallback((id: string) => {
    setExtensions(prev => prev.filter(e => e.manifest.id !== id));
    const stored = storageLoad();
    delete stored[id];
    storageSave(stored);
  }, []);

  return (
    <ExtensionContext.Provider value={{ extensions, installFromFile, uninstallExtension }}>
      {children}
    </ExtensionContext.Provider>
  );
}
