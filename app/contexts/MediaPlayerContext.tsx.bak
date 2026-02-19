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
  Platform, View, Text, StyleSheet, StatusBar, ActivityIndicator,
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

// ─── Motor de vídeo — zero UI própria ────────────────────────────────────────

function LhubVideoPlayer({ options, onClose }: { options: VideoPlayerOptions; onClose: () => void }) {
  const [VideoComp, setVideoComp]   = useState<any>(null);
  const [ResizeMode, setResizeMode] = useState<any>(null);
  const [error, setError]           = useState('');
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

  // Força landscape + fullscreen imersivo (esconde barra de navegação Android)
  useEffect(() => {
    let locked = false;
    try { const SO = require('expo-screen-orientation'); SO.lockAsync(SO.OrientationLock.LANDSCAPE).catch(() => {}); locked = true; } catch (_) {}
    // Esconde navigation bar do Android (fullscreen imersivo)
    try {
      const NB = require('expo-navigation-bar');
      NB.setVisibilityAsync('hidden').catch(() => {});
      NB.setBehaviorAsync('overlay-swipe').catch(() => {});
    } catch (_) {}
    return () => {
      if (locked) { try { const SO = require('expo-screen-orientation'); SO.lockAsync(SO.OrientationLock.PORTRAIT_UP).catch(() => {}); } catch (_) {} }
      // Restaura navigation bar
      try { const NB = require('expo-navigation-bar'); NB.setVisibilityAsync('visible').catch(() => {}); } catch (_) {}
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
      ) : VideoComp ? (
        <VideoComp
          ref={videoRef}
          source={(() => {
            const src: any = { uri: options.uri };
            if (options.headers) src.headers = options.headers;
            // Se a URL não termina em .m3u8 mas é HLS (ex: master.txt),
            // passa o type explícito para o ExoPlayer não rejeitar
            const u = options.uri.toLowerCase();
            const looksLikeHls = u.includes('.m3u8') || u.includes('master.txt') ||
              (u.includes('.txt') && (u.includes('hls') || u.includes('urlset') || u.includes('master')));
            if (looksLikeHls && !u.includes('.mp4')) {
              src.type = 'application/x-mpegURL';
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
