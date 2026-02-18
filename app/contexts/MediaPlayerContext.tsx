/**
 * MediaPlayerContext
 *
 * Fornece dois sistemas reutilizáveis por extensões:
 *
 *  1. Music Player Notification  — controla a notificação nativa de player de
 *     música (Media Session / lock-screen controls) via expo-av + expo-media-library.
 *     A notificação aparece na barra de status com botões pause/next/prev,
 *     artwork, título e artista — igual ao Spotify/YouTube Music.
 *
 *  2. Video Player  — registra um componente de vídeo que extensões podem
 *     montar em tela cheia ou embutido, com suporte a controles nativos.
 *
 * Como uma extensão usa:
 *
 *   // Music notification
 *   const { musicNotification } = useLhubMediaPlayer();
 *   musicNotification.update({ title, artist, artwork, isPlaying, duration, position });
 *   musicNotification.setHandlers({ onPlay, onPause, onNext, onPrev, onSeek });
 *   musicNotification.clear();
 *
 *   // Video player
 *   const { videoPlayer } = useLhubMediaPlayer();
 *   videoPlayer.open({ uri, title, startPosition });
 *   videoPlayer.close();
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import { Platform, View, StyleSheet } from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MusicNotificationInfo {
  title: string;
  artist: string;
  artwork?: string;       // URI da imagem (http ou data:)
  album?: string;
  isPlaying: boolean;
  duration: number;       // segundos
  position: number;       // segundos
}

export interface MusicNotificationHandlers {
  onPlay?:  () => void;
  onPause?: () => void;
  onNext?:  () => void;
  onPrev?:  () => void;
  onSeek?:  (positionSeconds: number) => void;
  onStop?:  () => void;
}

export interface VideoPlayerOptions {
  uri: string;
  title?: string;
  startPosition?: number; // segundos
  loop?: boolean;
  onEnd?: () => void;
  onClose?: () => void;
}

export interface MusicNotificationAPI {
  /** Atualiza os metadados e estado da notificação */
  update: (info: MusicNotificationInfo) => void;
  /** Define os handlers dos botões da notificação */
  setHandlers: (handlers: MusicNotificationHandlers) => void;
  /** Remove a notificação */
  clear: () => void;
  /** Estado atual */
  current: MusicNotificationInfo | null;
}

export interface VideoPlayerAPI {
  /** Abre o video player em tela cheia */
  open: (options: VideoPlayerOptions) => void;
  /** Fecha o video player */
  close: () => void;
  /** Se o player está aberto */
  isOpen: boolean;
}

interface MediaPlayerContextValue {
  musicNotification: MusicNotificationAPI;
  videoPlayer: VideoPlayerAPI;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const MediaPlayerContext = createContext<MediaPlayerContextValue>({
  musicNotification: {
    update: () => {},
    setHandlers: () => {},
    clear: () => {},
    current: null,
  },
  videoPlayer: {
    open: () => {},
    close: () => {},
    isOpen: false,
  },
});

export function useLhubMediaPlayer() {
  return useContext(MediaPlayerContext);
}

// ─── Native Media Session (expo-av + expo-notifications approach) ─────────────
//
// No Android/iOS, usamos:
//   - Audio.setAudioModeAsync({ staysActiveInBackground: true })  → já feito pela extensão
//   - expo-av Sound.setOnPlaybackStatusUpdate                     → progresso
//   - react-native-track-player (se disponível) ou
//     expo-notifications para lock-screen controls
//
// Como expo-track-player é pesado, usamos a API nativa via NativeModules
// com fallback para a Media Session Web API no browser.

function setupWebMediaSession(
  info: MusicNotificationInfo,
  handlers: MusicNotificationHandlers
) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

  const ms = (navigator as any).mediaSession;

  ms.metadata = new (window as any).MediaMetadata({
    title:  info.title,
    artist: info.artist,
    album:  info.album || '',
    artwork: info.artwork
      ? [{ src: info.artwork, sizes: '512x512', type: 'image/jpeg' }]
      : [],
  });

  ms.playbackState = info.isPlaying ? 'playing' : 'paused';

  const safe = (fn?: () => void) => fn ? () => fn() : undefined;

  if (handlers.onPlay)  ms.setActionHandler('play',  safe(handlers.onPlay));
  if (handlers.onPause) ms.setActionHandler('pause', safe(handlers.onPause));
  if (handlers.onNext)  ms.setActionHandler('nexttrack',     safe(handlers.onNext));
  if (handlers.onPrev)  ms.setActionHandler('previoustrack', safe(handlers.onPrev));
  if (handlers.onSeek)  ms.setActionHandler('seekto', (d: any) => handlers.onSeek!(d.seekTime));

  try {
    ms.setPositionState({
      duration: info.duration || 0,
      playbackRate: 1,
      position: Math.min(info.position, info.duration || 0),
    });
  } catch (_) {}
}

function clearWebMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = (navigator as any).mediaSession;
  ms.metadata = null;
  ms.playbackState = 'none';
  for (const action of ['play','pause','nexttrack','previoustrack','seekto']) {
    try { ms.setActionHandler(action as any, null); } catch (_) {}
  }
}

// Native: usa expo-av + NativeModules para Android/iOS media notification
async function setupNativeMediaNotification(
  info: MusicNotificationInfo,
  handlers: MusicNotificationHandlers
) {
  try {
    // expo-av Audio mode para background
    const { Audio } = require('expo-av');
    await Audio.setAudioModeAsync({
      allowsRecordingIOS:       false,
      staysActiveInBackground:  true,
      playsInSilentModeIOS:     true,
      shouldDuckAndroid:        true,
      playThroughEarpieceAndroid: false,
    });

    // Tenta react-native-track-player se instalado
    try {
      const TrackPlayer = require('react-native-track-player').default;
      const State       = require('react-native-track-player').State;
      const Capability  = require('react-native-track-player').Capability;

      // Setup se não inicializado
      try {
        await TrackPlayer.setupPlayer();
        await TrackPlayer.updateOptions({
          capabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
            Capability.Stop,
          ],
          compactCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
          ],
          notificationCapabilities: [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.SeekTo,
          ],
        });
      } catch (_) {
        // já inicializado
      }

      // Adiciona/atualiza a faixa
      const queue = await TrackPlayer.getQueue();
      const track = {
        id:      'lhub_current',
        url:     'https://placeholder.local', // URL real vem do player da extensão
        title:   info.title,
        artist:  info.artist,
        album:   info.album || '',
        artwork: info.artwork || '',
        duration: info.duration,
      };

      if (queue.length === 0) {
        await TrackPlayer.add(track);
      } else {
        await TrackPlayer.updateMetadataForTrack(0, track);
      }

      // Sincroniza estado play/pause
      const currentState = await TrackPlayer.getState();
      if (info.isPlaying && currentState !== State.Playing) {
        // Não chamamos play() aqui pois o áudio real é gerenciado pela extensão
        // só sincronizamos o estado da notificação
        await TrackPlayer.updateOptions({ playbackState: State.Playing });
      } else if (!info.isPlaying && currentState === State.Playing) {
        await TrackPlayer.updateOptions({ playbackState: State.Paused });
      }

      return; // sucesso via TrackPlayer
    } catch (e) {
      // react-native-track-player não disponível, usa fallback nativo
    }

    // Fallback: NativeModules do expo ou do React Native puro
    // Em última instância, o expo-av já deixa o áudio ativo em background
    // e a notificação básica do OS aparece automaticamente para streams ativos.
    console.log('[MediaPlayer] Using expo-av background audio (no lock-screen controls)');

  } catch (e) {
    console.warn('[MediaPlayer] setupNativeMediaNotification error:', e);
  }
}

async function clearNativeMediaNotification() {
  try {
    const TrackPlayer = require('react-native-track-player').default;
    await TrackPlayer.reset();
  } catch (_) {}
}

// ─── Video Player Component ───────────────────────────────────────────────────
//
// Renderizado como overlay por cima de tudo (zIndex alto).
// Extensões chamam videoPlayer.open({ uri, title }) para montar.

function LhubVideoPlayer({
  options,
  onClose,
}: {
  options: VideoPlayerOptions;
  onClose: () => void;
}) {
  // Importamos expo-av dinamicamente para não quebrar se não instalado
  const [VideoComp, setVideoComp] = useState<React.ComponentType<any> | null>(null);
  const [error, setError]         = useState('');

  useEffect(() => {
    try {
      const { Video, ResizeMode } = require('expo-av');
      setVideoComp(() => Video);
    } catch (e) {
      setError('expo-av não instalado. Rode: npx expo install expo-av');
    }
  }, []);

  // ── Força landscape ao abrir, restaura portrait ao fechar ────────────────
  useEffect(() => {
    let didLock = false;
    try {
      const SO = require('expo-screen-orientation');
      SO.lockAsync(SO.OrientationLock.LANDSCAPE).catch(() => {});
      didLock = true;
    } catch (e) {
      console.warn('[LhubVideoPlayer] expo-screen-orientation não disponível:', e);
    }
    return () => {
      if (didLock) {
        try {
          const SO = require('expo-screen-orientation');
          SO.lockAsync(SO.OrientationLock.PORTRAIT_UP).catch(() => {});
        } catch (e) {}
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    options.onClose?.();
    onClose();
  }, [options, onClose]);

  const { View: RNView, TouchableOpacity, Text, StyleSheet: SS, StatusBar } = require('react-native');

  const vs = SS.create({
    overlay:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 99999 },
    video:     { flex: 1 },
    closeBtn:  { position: 'absolute', top: 44, right: 16, zIndex: 100000, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 20, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    closeText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
    title:     { position: 'absolute', top: 44, left: 16, right: 64, color: '#fff', fontSize: 16, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.8)', textShadowOffset: {width:0,height:1}, textShadowRadius: 4 },
    errWrap:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    errText:   { color: '#fff', fontSize: 14, textAlign: 'center' },
  });

  return (
    <RNView style={vs.overlay}>
      <StatusBar hidden />

      {options.title ? (
        <Text style={vs.title} numberOfLines={1}>{options.title}</Text>
      ) : null}

      <TouchableOpacity style={vs.closeBtn} onPress={handleClose}>
        <Text style={vs.closeText}>✕</Text>
      </TouchableOpacity>

      {error ? (
        <RNView style={vs.errWrap}>
          <Text style={vs.errText}>{error}</Text>
        </RNView>
      ) : VideoComp ? (
        <VideoComp
          source={{ uri: options.uri }}
          style={vs.video}
          useNativeControls
          resizeMode="contain"
          shouldPlay
          positionMillis={(options.startPosition || 0) * 1000}
          isLooping={options.loop || false}
          onPlaybackStatusUpdate={(status: any) => {
            if (status.didJustFinish && !options.loop) {
              options.onEnd?.();
            }
          }}
        />
      ) : null}
    </RNView>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function MediaPlayerProvider({ children }: { children: React.ReactNode }) {
  // Music notification state
  const [notifInfo, setNotifInfo]     = useState<MusicNotificationInfo | null>(null);
  const handlersRef                   = useRef<MusicNotificationHandlers>({});

  // Video player state
  const [videoOptions, setVideoOptions] = useState<VideoPlayerOptions | null>(null);

  // ── Music notification: sincroniza com OS quando info muda ────────────────
  useEffect(() => {
    if (!notifInfo) return;

    if (Platform.OS === 'web') {
      setupWebMediaSession(notifInfo, handlersRef.current);
    } else {
      setupNativeMediaNotification(notifInfo, handlersRef.current);
    }
  }, [notifInfo]);

  // ── Music Notification API ────────────────────────────────────────────────
  const musicUpdate = useCallback((info: MusicNotificationInfo) => {
    setNotifInfo(info);
  }, []);

  const musicSetHandlers = useCallback((handlers: MusicNotificationHandlers) => {
    handlersRef.current = handlers;
    // Re-aplica handlers se já tem info ativa
    if (notifInfo) {
      if (Platform.OS === 'web') {
        setupWebMediaSession(notifInfo, handlers);
      } else {
        setupNativeMediaNotification(notifInfo, handlers);
      }
    }
  }, [notifInfo]);

  const musicClear = useCallback(() => {
    setNotifInfo(null);
    if (Platform.OS === 'web') {
      clearWebMediaSession();
    } else {
      clearNativeMediaNotification();
    }
  }, []);

  // ── Video Player API ──────────────────────────────────────────────────────
  const videoOpen = useCallback((options: VideoPlayerOptions) => {
    setVideoOptions(options);
  }, []);

  const videoClose = useCallback(() => {
    setVideoOptions(null);
  }, []);

  const contextValue: MediaPlayerContextValue = {
    musicNotification: {
      update:      musicUpdate,
      setHandlers: musicSetHandlers,
      clear:       musicClear,
      current:     notifInfo,
    },
    videoPlayer: {
      open:   videoOpen,
      close:  videoClose,
      isOpen: videoOptions !== null,
    },
  };

  return (
    <MediaPlayerContext.Provider value={contextValue}>
      {children}
      {videoOptions && (
        <LhubVideoPlayer
          options={videoOptions}
          onClose={videoClose}
        />
      )}
    </MediaPlayerContext.Provider>
  );
}
