/**
 * MediaPlayerContext — v3
 *
 * Arquitetura de player extensível:
 *
 *  O backend gerencia o expo-av (Video component real).
 *  A extensão passa um componente React customizado (renderControls) que recebe
 *  uma API de controle (VideoControlsAPI) e renderiza os controles como quiser.
 *
 *  videoPlayer.open({
 *    uri,
 *    title?,
 *    startPosition?,
 *    loop?,
 *    onEnd?,
 *    onClose?,
 *    renderControls?: (api: VideoControlsAPI) => React.ReactNode,
 *  });
 *
 *  VideoControlsAPI = {
 *    // Estado
 *    isPlaying, duration, position, buffered, isBuffering, isEnded,
 *    // Ações
 *    play(), pause(), togglePlay(), seek(seconds), skip(seconds), close(),
 *    // Metadados
 *    uri, title,
 *  }
 *
 *  Se renderControls não for passado, usa o DefaultControls embutido no backend.
 */

import React, {
  createContext, useContext, useState, useEffect, useRef, useCallback, useMemo,
} from 'react';
import {
  Platform, View, Text, TouchableOpacity, TouchableWithoutFeedback,
  StyleSheet, Animated, PanResponder, Dimensions, StatusBar, ActivityIndicator,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

// ─── Music types (unchanged) ──────────────────────────────────────────────────

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

/** API passada ao renderControls da extensão */
export interface VideoControlsAPI {
  // Estado (readonly)
  isPlaying:   boolean;
  duration:    number;   // segundos
  position:    number;   // segundos
  buffered:    number;   // segundos
  isBuffering: boolean;
  isEnded:     boolean;
  uri:         string;
  title:       string;
  // Ações
  play:        () => void;
  pause:       () => void;
  togglePlay:  () => void;
  seek:        (seconds: number) => void;   // posição absoluta
  skip:        (seconds: number) => void;   // relativo (+/- N segundos)
  close:       () => void;
}

export interface VideoPlayerOptions {
  uri:            string;
  title?:         string;
  startPosition?: number;
  loop?:          boolean;
  onEnd?:         () => void;
  onClose?:       () => void;
  /** Headers HTTP para o ExoPlayer (Referer, Origin, User-Agent, etc.) */
  headers?:       Record<string, string>;
  /** Componente customizado de controles. Recebe VideoControlsAPI. */
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

// ─── Music helpers (unchanged) ────────────────────────────────────────────────

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

// ─── Format helper ────────────────────────────────────────────────────────────

function fmt(s: number): string {
  if (!s || isNaN(s)) return '0:00';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${m}:${String(ss).padStart(2,'0')}`;
}

// ─── Default Controls (backend, usa MaterialCommunityIcons) ───────────────────

function DefaultControls({ api }: { api: VideoControlsAPI }) {
  const { width: W } = Dimensions.get('window');
  const [seeking, setSeeking]       = useState(false);
  const [seekPos, setSeekPos]       = useState(0);
  const [showCtrl, setShowCtrl]     = useState(true);
  const ctrlOpacity  = useRef(new Animated.Value(1)).current;
  const hideTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barLeft      = useRef(0);
  const barWidth     = useRef(W - 32);
  const barRef       = useRef<View>(null);

  const resetHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(ctrlOpacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    setShowCtrl(true);
    hideTimer.current = setTimeout(() => {
      if (!seeking) {
        Animated.timing(ctrlOpacity, { toValue: 0, duration: 280, useNativeDriver: true }).start(() => setShowCtrl(false));
      }
    }, 3500);
  }, [seeking]);

  useEffect(() => { resetHide(); }, []);

  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder:  () => true,
    onPanResponderGrant: (e) => {
      setSeeking(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      const x = Math.max(0, Math.min(barWidth.current, e.nativeEvent.pageX - barLeft.current));
      setSeekPos((x / barWidth.current) * (api.duration || 1));
    },
    onPanResponderMove: (e) => {
      const x = Math.max(0, Math.min(barWidth.current, e.nativeEvent.pageX - barLeft.current));
      setSeekPos((x / barWidth.current) * (api.duration || 1));
    },
    onPanResponderRelease: (e) => {
      const x = Math.max(0, Math.min(barWidth.current, e.nativeEvent.pageX - barLeft.current));
      api.seek((x / barWidth.current) * (api.duration || 1));
      setSeeking(false);
      resetHide();
    },
  })).current;

  const pos  = seeking ? seekPos : api.position;
  const prog = api.duration > 0 ? pos / api.duration : 0;
  const buf  = api.duration > 0 ? api.buffered / api.duration : 0;

  const S = useMemo(() => StyleSheet.create({
    root:      { flex: 1 },
    // top gradient overlay
    topGrad:   { position: 'absolute', top: 0, left: 0, right: 0, height: 120 },
    topBar:    { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingHorizontal: 12, gap: 8 },
    closeBtn:  { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center' },
    titleTxt:  { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
    // bottom
    botGrad:   { position: 'absolute', bottom: 0, left: 0, right: 0, height: 140 },
    botBar:    { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 22 },
    timeRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
    timeTxt:   { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
    seekWrap:  { height: 32, justifyContent: 'center', marginBottom: 2 },
    seekTrack: { height: 3, backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 2 },
    seekBuf:   { position: 'absolute', top: 0, left: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.32)', borderRadius: 2 },
    seekFill:  { position: 'absolute', top: 0, left: 0, bottom: 0, backgroundColor: '#00E5FF', borderRadius: 2 },
    seekThumb: { position: 'absolute', top: -6, width: 15, height: 15, borderRadius: 8, backgroundColor: '#00E5FF', elevation: 4, shadowColor: '#00E5FF', shadowOpacity: 0.7, shadowRadius: 5, shadowOffset: { width: 0, height: 0 } },
    // center
    center:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 36 },
    skipBtn:   { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    playBtn:   { width: 68, height: 68, borderRadius: 34, backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
    // buf spinner
    bufWrap:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  }), []);

  // Gradient layers (top-to-transparent or bottom-to-transparent)
  const Grad = ({ style, dir }: { style: any; dir: 'down' | 'up' }) =>
    <View style={[style, { overflow: 'hidden' }]} pointerEvents="none">
      {[.05,.12,.21,.32,.44,.55,.63,.7].map((o,i,a) => (
        <View key={i} style={{ position: 'absolute', [dir==='down'?'top':'bottom']: 0, left: 0, right: 0, height: `${Math.round((i+1)/a.length*100)}%`, backgroundColor: `rgba(0,0,0,${o})` }} />
      ))}
    </View>;

  const iconColor = '#ffffff';
  const iconSize  = 28;

  return (
    <View style={S.root} pointerEvents="box-none">
      {/* Tap to toggle */}
      <TouchableWithoutFeedback onPress={resetHide}>
        <View style={StyleSheet.absoluteFill} />
      </TouchableWithoutFeedback>

      {/* Buffering spinner — always visible */}
      {api.isBuffering && !api.isEnded && (
        <View style={S.bufWrap} pointerEvents="none">
          <ActivityIndicator size="large" color="#00E5FF" />
        </View>
      )}

      <Animated.View style={[StyleSheet.absoluteFill, { opacity: ctrlOpacity }]} pointerEvents={showCtrl ? 'box-none' : 'none'}>

        {/* TOP */}
        <Grad style={S.topGrad} dir="down" />
        <View style={S.topBar}>
          <TouchableOpacity style={S.closeBtn} onPress={() => { api.close(); }} activeOpacity={0.75}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={iconColor} />
          </TouchableOpacity>
          {!!api.title && <Text style={S.titleTxt} numberOfLines={1}>{api.title}</Text>}
        </View>

        {/* CENTER */}
        <View style={S.center} pointerEvents="box-none">
          <TouchableOpacity style={S.skipBtn} onPress={() => { api.skip(-10); resetHide(); }} activeOpacity={0.75}>
            <MaterialCommunityIcons name="rewind-10" size={iconSize} color={iconColor} />
          </TouchableOpacity>

          <TouchableOpacity style={S.playBtn} onPress={() => { api.togglePlay(); resetHide(); }} activeOpacity={0.75}>
            {api.isEnded
              ? <MaterialCommunityIcons name="replay" size={32} color={iconColor} />
              : api.isPlaying
                ? <MaterialCommunityIcons name="pause" size={32} color={iconColor} />
                : <MaterialCommunityIcons name="play" size={32} color={iconColor} style={{ marginLeft: 3 }} />
            }
          </TouchableOpacity>

          <TouchableOpacity style={S.skipBtn} onPress={() => { api.skip(10); resetHide(); }} activeOpacity={0.75}>
            <MaterialCommunityIcons name="fast-forward-10" size={iconSize} color={iconColor} />
          </TouchableOpacity>
        </View>

        {/* BOTTOM */}
        <Grad style={S.botGrad} dir="up" />
        <View style={S.botBar}>
          <View style={S.timeRow}>
            <Text style={S.timeTxt}>{fmt(pos)}</Text>
            <Text style={S.timeTxt}>{fmt(api.duration)}</Text>
          </View>
          <View
            style={S.seekWrap}
            ref={barRef}
            onLayout={() => {
              barRef.current?.measure((_, __, w, ___, px) => {
                barLeft.current  = px;
                barWidth.current = w;
              });
            }}
            {...pan.panHandlers}
          >
            <View style={S.seekTrack}>
              <View style={[S.seekBuf,   { width: `${buf  * 100}%` }]} />
              <View style={[S.seekFill,  { width: `${prog * 100}%` }]} />
              <View style={[S.seekThumb, { left: `${prog * 100}%`, marginLeft: -7, transform: [{ scale: seeking ? 1.4 : 1 }] }]} />
            </View>
          </View>
          {api.isBuffering && <Text style={[S.timeTxt, { color: 'rgba(255,255,255,0.4)', fontSize: 11, marginTop: 2 }]}>Carregando…</Text>}
        </View>

      </Animated.View>
    </View>
  );
}

// ─── LhubVideoPlayer — backend, gerencia expo-av + overlay ───────────────────

function LhubVideoPlayer({ options, onClose }: { options: VideoPlayerOptions; onClose: () => void }) {
  const [VideoComp, setVideoComp] = useState<any>(null);
  const [ResizeMode, setResizeMode] = useState<any>(null);
  const [error, setError]         = useState('');
  const videoRef = useRef<any>(null);

  // Playback state
  const [isPlaying, setIsPlaying]     = useState(false);
  const [duration, setDuration]       = useState(0);
  const [position, setPosition]       = useState(0);
  const [buffered, setBuffered]       = useState(0);
  const [isBuffering, setIsBuffering] = useState(true);
  const [isEnded, setIsEnded]         = useState(false);

  // Load expo-av
  useEffect(() => {
    try {
      const av = require('expo-av');
      setVideoComp(() => av.Video);
      setResizeMode(av.ResizeMode ?? { CONTAIN: 'contain' });
    } catch { setError('expo-av não disponível.'); }
  }, []);

  // Screen orientation
  useEffect(() => {
    let locked = false;
    try { const SO = require('expo-screen-orientation'); SO.lockAsync(SO.OrientationLock.LANDSCAPE).catch(() => {}); locked = true; } catch (_) {}
    return () => { if (locked) { try { const SO = require('expo-screen-orientation'); SO.lockAsync(SO.OrientationLock.PORTRAIT_UP).catch(() => {}); } catch (_) {} } };
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

  // ── Controls API exposed to renderControls ────────────────────────────────
  const api: VideoControlsAPI = useMemo(() => ({
    isPlaying, duration, position, buffered, isBuffering, isEnded,
    uri: options.uri, title: options.title ?? '',
    play:       () => videoRef.current?.playAsync().catch(() => {}),
    pause:      () => videoRef.current?.pauseAsync().catch(() => {}),
    togglePlay: () => {
      if (isEnded) { videoRef.current?.replayAsync().catch(() => {}); setIsEnded(false); }
      else if (isPlaying) videoRef.current?.pauseAsync().catch(() => {});
      else videoRef.current?.playAsync().catch(() => {});
    },
    seek:  (s: number) => videoRef.current?.setPositionAsync(s * 1000).catch(() => {}),
    skip:  (s: number) => {
      const t = Math.max(0, Math.min(duration, position + s));
      videoRef.current?.setPositionAsync(t * 1000).catch(() => {});
    },
    close: handleClose,
  }), [isPlaying, duration, position, buffered, isBuffering, isEnded, options, handleClose]);

  const vs = StyleSheet.create({
    root:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 99999 },
    video:  { flex: 1 },
    err:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    errTxt: { color: '#fff', fontSize: 14, textAlign: 'center', lineHeight: 22 },
    overlay:{ ...StyleSheet.absoluteFillObject },
  });

  const ControlsComponent = options.renderControls
    ? () => options.renderControls!(api)
    : () => <DefaultControls api={api} />;

  return (
    <View style={vs.root}>
      <StatusBar hidden />

      {error ? (
        <View style={vs.err}><Text style={vs.errTxt}>{error}</Text></View>
      ) : VideoComp ? (
        <VideoComp
          ref={videoRef}
          source={options.headers
            ? { uri: options.uri, headers: options.headers }
            : { uri: options.uri }
          }
          style={vs.video}
          resizeMode={ResizeMode?.CONTAIN ?? 'contain'}
          shouldPlay
          isLooping={options.loop ?? false}
          positionMillis={(options.startPosition ?? 0) * 1000}
          onPlaybackStatusUpdate={onStatus}
        />
      ) : (
        <View style={[vs.err]}><ActivityIndicator size="large" color="#00E5FF" /></View>
      )}

      {/* Controls overlay */}
      <View style={vs.overlay} pointerEvents="box-none">
        <ControlsComponent />
      </View>
    </View>
  );
}

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

  const musicUpdate = useCallback((i: MusicNotificationInfo) => setNotifInfo(i), []);
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
