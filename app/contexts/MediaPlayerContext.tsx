/**
 * MediaPlayerContext — v4
 *
 * O app é APENAS o motor de vídeo. A extensão tem 100% do controle do layout.
 *
 * A extensão passa renderControls: (api) => ReactNode
 * O app fornece:
 *   - O Video component real (expo-av) em tela cheia
 *   - A API de controle (VideoControlsAPI) com estado e ações
 *   - Orientação landscape automática
 *
 * Se renderControls não for passado, mostra só o vídeo sem nenhuma UI.
 *
 * VideoControlsAPI = {
 *   isPlaying, duration, position, buffered, isBuffering, isEnded, uri, title,
 *   play(), pause(), togglePlay(), seek(seconds), skip(seconds), close()
 * }
 */

import React, {
  createContext, useContext, useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  Platform, View, Text, StyleSheet, StatusBar, ActivityIndicator, NativeModules,
} from 'react-native';

// ─── Music types ──────────────────────────────────────────────────────────────

export interface MusicNotificationInfo {
  title: string; artist: string; artwork?: string; album?: string;
  isPlaying: boolean; duration: number; position: number;
}
export interface MusicNotificationHandlers {
  onPlay?: () => void; onPause?: () => void; onNext?: () => void;
  onPrev?: () => void; onSeek?: (s: number) => void; onStop?: () => void;
}
export interface MusicNotificationAPI {
  update: (info: MusicNotificationInfo) => void;
  setHandlers: (h: MusicNotificationHandlers) => void;
  clear: () => void;
  current: MusicNotificationInfo | null;
}

// ─── Video types ──────────────────────────────────────────────────────────────

/** API completa passada ao renderControls — extensão tem controle total */
export interface VideoControlsAPI {
  // Estado reativo
  isPlaying:   boolean;
  duration:    number;   // segundos
  position:    number;   // segundos
  buffered:    number;   // segundos
  isBuffering: boolean;
  isEnded:     boolean;
  uri:         string;
  title:       string;
  // Ações de playback
  play:        () => void;
  pause:       () => void;
  togglePlay:  () => void;
  seek:        (seconds: number) => void;
  skip:        (seconds: number) => void;
  close:       () => void;
}

export interface VideoPlayerOptions {
  uri:             string;
  title?:          string;
  startPosition?:  number;
  loop?:           boolean;
  headers?:        Record<string, string>;
  onEnd?:          () => void;
  onClose?:        () => void;
  /** A extensão renderiza 100% do overlay — recebe VideoControlsAPI */
  renderControls?: (api: VideoControlsAPI) => React.ReactNode;
}

export interface VideoPlayerAPI {
  open:   (options: VideoPlayerOptions) => void;
  close:  () => void;
  isOpen: boolean;
}

interface MediaPlayerContextValue {
  musicNotification: MusicNotificationAPI;
  videoPlayer:       VideoPlayerAPI;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const MediaPlayerContext = createContext<MediaPlayerContextValue>({
  musicNotification: { update: () => {}, setHandlers: () => {}, clear: () => {}, current: null },
  videoPlayer:       { open: () => {}, close: () => {}, isOpen: false },
});

export function useLhubMediaPlayer() { return useContext(MediaPlayerContext); }

// ─── Music helpers ────────────────────────────────────────────────────────────

function setupWebMediaSession(info: MusicNotificationInfo, h: MusicNotificationHandlers) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = (navigator as any).mediaSession;
  ms.metadata = new (window as any).MediaMetadata({ title: info.title, artist: info.artist, album: info.album || '', artwork: info.artwork ? [{ src: info.artwork, sizes: '512x512', type: 'image/jpeg' }] : [] });
  ms.playbackState = info.isPlaying ? 'playing' : 'paused';
  const s = (fn?: () => void) => fn ? () => fn() : undefined;
  if (h.onPlay)  ms.setActionHandler('play', s(h.onPlay));
  if (h.onPause) ms.setActionHandler('pause', s(h.onPause));
  if (h.onNext)  ms.setActionHandler('nexttrack', s(h.onNext));
  if (h.onPrev)  ms.setActionHandler('previoustrack', s(h.onPrev));
  if (h.onSeek)  ms.setActionHandler('seekto', (d: any) => h.onSeek!(d.seekTime));
  try { ms.setPositionState({ duration: info.duration || 0, playbackRate: 1, position: Math.min(info.position, info.duration || 0) }); } catch (_) {}
}
function clearWebMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = (navigator as any).mediaSession;
  ms.metadata = null; ms.playbackState = 'none';
  for (const a of ['play','pause','nexttrack','previoustrack','seekto']) { try { ms.setActionHandler(a as any, null); } catch (_) {} }
}
async function setupNativeMediaNotification(info: MusicNotificationInfo, h: MusicNotificationHandlers) {
  try {
    const { Audio } = require('expo-av');
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: true, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
    try {
      const TP = require('react-native-track-player').default;
      const { Capability } = require('react-native-track-player');
      try { await TP.setupPlayer(); await TP.updateOptions({ capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.SeekTo, Capability.Stop], compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious] }); } catch (_) {}
      const q = await TP.getQueue();
      const track = { id: 'lhub_current', url: 'https://placeholder.local', title: info.title, artist: info.artist, album: info.album || '', artwork: info.artwork || '', duration: info.duration };
      if (q.length === 0) { await TP.add(track); } else { await TP.updateMetadataForTrack(0, track); }
    } catch (_) {}
  } catch (e) { console.warn('[MediaPlayer] native notif error:', e); }
}
async function clearNativeMediaNotification() {
  try { const TP = require('react-native-track-player').default; await TP.reset(); } catch (_) {}
}

// ─── HLS Proxy Cache ──────────────────────────────────────────────────────────
// Resolve qualquer URL de stream (HLS .m3u8, HLS disfarçado .txt, mp4, etc.)
// para um arquivo local no cache com extensão correta.
// O ExoPlayer recebe um file:// URI sem ambiguidade de formato.

async function resolveToLocalCache(
  uri: string,
  headers?: Record<string, string>
): Promise<string> {
  // Se for mp4 direto ou já for file://, não precisa de proxy
  const u = uri.toLowerCase();
  if (u.startsWith('file://')) return uri;
  if (u.match(/\.mp4(\?|#|$)/) && !u.includes('.txt')) return uri;

  // Detecta se é HLS (m3u8 ou txt disfarçado)
  const isHls = u.includes('.m3u8') || u.includes('.txt');
  if (!isHls) return uri; // outros formatos: mp4 direto, etc

  try {
    const FileSystem = require('expo-file-system/legacy');
    const cacheDir: string = FileSystem.cacheDirectory || '';
    if (!cacheDir) return uri;

    // Nome de arquivo único baseado na URL
    const hash = uri.replace(/[^a-zA-Z0-9]/g, '').slice(-40);
    const localPath = cacheDir + 'hls_proxy_' + hash + '.m3u8';

    // Fetch do manifesto com os headers corretos
    const fetchHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      ...(headers || {}),
    };

    const resp = await fetch(uri, { headers: fetchHeaders });
    if (!resp.ok) {
      console.warn('[HLSProxy] fetch status', resp.status, '— usando URL original');
      return uri;
    }

    const txt = await resp.text();

    // Verifica se é realmente um manifesto HLS
    if (!txt.includes('#EXTM3U') && !txt.includes('#EXT-X-')) {
      console.warn('[HLSProxy] conteúdo não parece HLS — usando URL original');
      return uri;
    }

    // Reescreve URLs relativas → absolutas
    const baseUrl = uri.substring(0, uri.lastIndexOf('/') + 1);
    const rewritten = txt.split('\n').map((line: string) => {
      const t = line.trim();
      if (!t) return line;
      // Linhas de comentário: reescreve apenas URI="..."
      if (t.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_m: string, relUri: string) => {
          if (relUri.startsWith('http') || relUri.startsWith('file')) return _m;
          return `URI="${baseUrl}${relUri}"`;
        });
      }
      // Linha de segmento ou variante: torna absoluta
      if (t.startsWith('http') || t.startsWith('file')) return line;
      return baseUrl + t;
    }).join('\n');

    // Salva no cache como .m3u8
    await FileSystem.writeAsStringAsync(localPath, rewritten, { encoding: 'utf8' });
    console.log('[HLSProxy] salvo em cache:', localPath);
    return localPath;

  } catch (e: any) {
    console.warn('[HLSProxy] erro, usando URL original:', e?.message);
    return uri;
  }
}

// ─── Motor de vídeo — zero UI própria ────────────────────────────────────────

function LhubVideoPlayer({ options, onClose }: { options: VideoPlayerOptions; onClose: () => void }) {
  const [VideoComp, setVideoComp]   = useState<any>(null);
  const [ResizeMode, setResizeMode] = useState<any>(null);
  const [error, setError]           = useState('');
  const [resolvedUri, setResolvedUri] = useState<string | null>(null);
  const videoRef = useRef<any>(null);

  const [isPlaying,   setIsPlaying]   = useState(false);
  const [duration,    setDuration]    = useState(0);
  const [position,    setPosition]    = useState(0);
  const [buffered,    setBuffered]    = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [isEnded,     setIsEnded]     = useState(false);

  // Carrega expo-av
  useEffect(() => {
    try {
      const av = require('expo-av');
      setVideoComp(() => av.Video);
      setResizeMode(av.ResizeMode ?? { CONTAIN: 'contain' });
    } catch { setError('expo-av não disponível.'); }
  }, []);

  // Resolve a URI: baixa manifesto HLS (.txt, .m3u8), reescreve URLs relativas
  // para absolutas, salva como .m3u8 no cache e passa file:// ao ExoPlayer.
  // Para mp4 direto ou file:// existente, retorna a URI sem modificação.
  useEffect(() => {
    let cancelled = false;
    setResolvedUri(null);
    resolveToLocalCache(options.uri, options.headers)
      .then(local => { if (!cancelled) setResolvedUri(local); })
      .catch(() => { if (!cancelled) setResolvedUri(options.uri); });
    return () => { cancelled = true; };
  }, [options.uri]);

  // Força landscape + fullscreen imersivo sticky (esconde status bar + navigation bar Android)
  useEffect(() => {
    let locked = false;

    // 1. Landscape
    try {
      const SO = require('expo-screen-orientation');
      SO.lockAsync(SO.OrientationLock.LANDSCAPE).catch(() => {});
      locked = true;
    } catch (_) {}

    // 2. Fullscreen imersivo — três camadas para garantir em qualquer versão Android
    const enterImmersive = () => {
      // Camada A: expo-navigation-bar (Expo SDK 43+)
      try {
        const NB = require('expo-navigation-bar');
        NB.setVisibilityAsync('hidden').catch(() => {});
        // 'immersive-sticky' reesconde automaticamente após swipe do usuário
        NB.setBehaviorAsync('immersive-sticky').catch(() => {});
      } catch (_) {}

      // Camada B: NativeModules.ExpoNavigationBar direto (fallback)
      try {
        if (NativeModules.ExpoNavigationBar) {
          NativeModules.ExpoNavigationBar.setVisibilityAsync?.('hidden');
        }
      } catch (_) {}

      // Camada C: StatusBar oculta
      StatusBar.setHidden(true, 'none');
    };

    enterImmersive();

    // Re-aplica após 300ms (alguns dispositivos ignoram na primeira chamada)
    const t1 = setTimeout(enterImmersive, 300);
    // Re-aplica após 1s (garante após animações de transição de tela)
    const t2 = setTimeout(enterImmersive, 1000);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      // Restaura portrait
      if (locked) {
        try { const SO = require('expo-screen-orientation'); SO.lockAsync(SO.OrientationLock.PORTRAIT_UP).catch(() => {}); } catch (_) {}
      }
      // Restaura navigation bar
      try {
        const NB = require('expo-navigation-bar');
        NB.setVisibilityAsync('visible').catch(() => {});
      } catch (_) {}
      StatusBar.setHidden(false, 'none');
    };
  }, []);

  const handleClose = useCallback(() => { options.onClose?.(); onClose(); }, [options, onClose]);

  const onStatus = useCallback((st: any) => {
    if (!st.isLoaded) { if (st.error) setError(String(st.error)); return; }
    setIsPlaying(st.isPlaying ?? false);
    setDuration((st.durationMillis ?? 0) / 1000);
    setPosition((st.positionMillis ?? 0) / 1000);
    setIsBuffering(st.isBuffering ?? false);
    if (st.playableDurationMillis) setBuffered(st.playableDurationMillis / 1000);
    if (st.didJustFinish && !options.loop) { setIsEnded(true); options.onEnd?.(); }
  }, [options]);

  // API de controle passada à extensão
  const api: VideoControlsAPI = useMemo(() => ({
    isPlaying, duration, position, buffered, isBuffering, isEnded,
    uri:   options.uri,
    title: options.title ?? '',
    play:       () => videoRef.current?.playAsync().catch(() => {}),
    pause:      () => videoRef.current?.pauseAsync().catch(() => {}),
    togglePlay: () => {
      if (isEnded) { videoRef.current?.replayAsync().catch(() => {}); setIsEnded(false); }
      else if (isPlaying) videoRef.current?.pauseAsync().catch(() => {});
      else videoRef.current?.playAsync().catch(() => {});
    },
    seek: (s: number) => videoRef.current?.setPositionAsync(s * 1000).catch(() => {}),
    skip: (s: number) => {
      const t = Math.max(0, Math.min(duration, position + s));
      videoRef.current?.setPositionAsync(t * 1000).catch(() => {});
    },
    close: handleClose,
  }), [isPlaying, duration, position, buffered, isBuffering, isEnded, options, handleClose]);

  return (
    <View style={vs.root}>
      <StatusBar hidden />

      {/* Vídeo real — ocupa toda a tela */}
      {error ? (
        <View style={vs.err}>
          <Text style={vs.errTxt}>{error}</Text>
        </View>
      ) : VideoComp && resolvedUri ? (
        <VideoComp
          ref={videoRef}
          source={(() => {
            const src: any = { uri: resolvedUri };
            // Headers só para URLs remotas — file:// não precisa
            if (options.headers && !resolvedUri.startsWith('file://')) {
              src.headers = options.headers;
            }
            return src;
          })()}
          style={vs.video}
          resizeMode={ResizeMode?.CONTAIN ?? 'contain'}
          shouldPlay
          isLooping={options.loop ?? false}
          positionMillis={(options.startPosition ?? 0) * 1000}
          onPlaybackStatusUpdate={onStatus}
        />
      ) : (
        <View style={vs.err}>
          <ActivityIndicator size="large" color="#fff" />
          {!resolvedUri && <Text style={[vs.errTxt, {marginTop: 12, fontSize: 12, opacity: 0.6}]}>Preparando stream…</Text>}
        </View>
      )}

      {/* Overlay da extensão — 100% do controle */}
      {options.renderControls && (
        <View style={vs.overlay} pointerEvents="box-none">
          {options.renderControls(api)}
        </View>
      )}
    </View>
  );
}

const vs = StyleSheet.create({
  root:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 99999 },
  video:   { flex: 1 },
  overlay: { ...StyleSheet.absoluteFillObject },
  err:     { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  errTxt:  { color: '#fff', fontSize: 14, textAlign: 'center', lineHeight: 22 },
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MediaPlayerProvider({ children }: { children: React.ReactNode }) {
  const [notifInfo, setNotifInfo]       = useState<MusicNotificationInfo | null>(null);
  const handlersRef                     = useRef<MusicNotificationHandlers>({});
  const [videoOptions, setVideoOptions] = useState<VideoPlayerOptions | null>(null);

  useEffect(() => {
    if (!notifInfo) return;
    if (Platform.OS === 'web') setupWebMediaSession(notifInfo, handlersRef.current);
    else setupNativeMediaNotification(notifInfo, handlersRef.current);
  }, [notifInfo]);

  const musicUpdate      = useCallback((i: MusicNotificationInfo) => setNotifInfo(i), []);
  const musicSetHandlers = useCallback((h: MusicNotificationHandlers) => {
    handlersRef.current = h;
    if (notifInfo) {
      if (Platform.OS === 'web') setupWebMediaSession(notifInfo, h);
      else setupNativeMediaNotification(notifInfo, h);
    }
  }, [notifInfo]);
  const musicClear = useCallback(() => {
    setNotifInfo(null);
    if (Platform.OS === 'web') clearWebMediaSession();
    else clearNativeMediaNotification();
  }, []);

  const videoOpen  = useCallback((o: VideoPlayerOptions) => setVideoOptions(o), []);
  const videoClose = useCallback(() => setVideoOptions(null), []);

  const value: MediaPlayerContextValue = {
    musicNotification: { update: musicUpdate, setHandlers: musicSetHandlers, clear: musicClear, current: notifInfo },
    videoPlayer:       { open: videoOpen, close: videoClose, isOpen: videoOptions !== null },
  };

  return (
    <MediaPlayerContext.Provider value={value}>
      {children}
      {videoOptions && <LhubVideoPlayer options={videoOptions} onClose={videoClose} />}
    </MediaPlayerContext.Provider>
  );
}
