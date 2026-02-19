/**
 * MediaPlayerContext — v2 Professional Player
 * Vídeo player com design profissional, controles customizados e gestos.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from 'react';
import {
  Platform,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  StyleSheet,
  Animated,
  PanResponder,
  Dimensions,
  StatusBar,
  ActivityIndicator,
} from 'react-native';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MusicNotificationInfo {
  title: string;
  artist: string;
  artwork?: string;
  album?: string;
  isPlaying: boolean;
  duration: number;
  position: number;
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
  startPosition?: number;
  loop?: boolean;
  onEnd?: () => void;
  onClose?: () => void;
}

export interface MusicNotificationAPI {
  update: (info: MusicNotificationInfo) => void;
  setHandlers: (handlers: MusicNotificationHandlers) => void;
  clear: () => void;
  current: MusicNotificationInfo | null;
}

export interface VideoPlayerAPI {
  open: (options: VideoPlayerOptions) => void;
  close: () => void;
  isOpen: boolean;
}

interface MediaPlayerContextValue {
  musicNotification: MusicNotificationAPI;
  videoPlayer: VideoPlayerAPI;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const MediaPlayerContext = createContext<MediaPlayerContextValue>({
  musicNotification: { update: () => {}, setHandlers: () => {}, clear: () => {}, current: null },
  videoPlayer: { open: () => {}, close: () => {}, isOpen: false },
});

export function useLhubMediaPlayer() {
  return useContext(MediaPlayerContext);
}

// ─── Music helpers (unchanged) ────────────────────────────────────────────────

function setupWebMediaSession(info: MusicNotificationInfo, handlers: MusicNotificationHandlers) {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = (navigator as any).mediaSession;
  ms.metadata = new (window as any).MediaMetadata({
    title: info.title, artist: info.artist, album: info.album || '',
    artwork: info.artwork ? [{ src: info.artwork, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
  ms.playbackState = info.isPlaying ? 'playing' : 'paused';
  const safe = (fn?: () => void) => fn ? () => fn() : undefined;
  if (handlers.onPlay)  ms.setActionHandler('play', safe(handlers.onPlay));
  if (handlers.onPause) ms.setActionHandler('pause', safe(handlers.onPause));
  if (handlers.onNext)  ms.setActionHandler('nexttrack', safe(handlers.onNext));
  if (handlers.onPrev)  ms.setActionHandler('previoustrack', safe(handlers.onPrev));
  if (handlers.onSeek)  ms.setActionHandler('seekto', (d: any) => handlers.onSeek!(d.seekTime));
  try { ms.setPositionState({ duration: info.duration || 0, playbackRate: 1, position: Math.min(info.position, info.duration || 0) }); } catch (_) {}
}

function clearWebMediaSession() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
  const ms = (navigator as any).mediaSession;
  ms.metadata = null; ms.playbackState = 'none';
  for (const a of ['play','pause','nexttrack','previoustrack','seekto']) { try { ms.setActionHandler(a as any, null); } catch (_) {} }
}

async function setupNativeMediaNotification(info: MusicNotificationInfo, handlers: MusicNotificationHandlers) {
  try {
    const { Audio } = require('expo-av');
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: true, playsInSilentModeIOS: true, shouldDuckAndroid: true, playThroughEarpieceAndroid: false });
    try {
      const TrackPlayer = require('react-native-track-player').default;
      const { State, Capability } = require('react-native-track-player');
      try { await TrackPlayer.setupPlayer(); await TrackPlayer.updateOptions({ capabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious, Capability.SeekTo, Capability.Stop], compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext, Capability.SkipToPrevious] }); } catch (_) {}
      const queue = await TrackPlayer.getQueue();
      const track = { id: 'lhub_current', url: 'https://placeholder.local', title: info.title, artist: info.artist, album: info.album || '', artwork: info.artwork || '', duration: info.duration };
      if (queue.length === 0) { await TrackPlayer.add(track); } else { await TrackPlayer.updateMetadataForTrack(0, track); }
    } catch (_) {}
  } catch (e) { console.warn('[MediaPlayer] setupNativeMediaNotification error:', e); }
}

async function clearNativeMediaNotification() {
  try { const TrackPlayer = require('react-native-track-player').default; await TrackPlayer.reset(); } catch (_) {}
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Professional Video Player ────────────────────────────────────────────────

function LhubVideoPlayer({ options, onClose }: { options: VideoPlayerOptions; onClose: () => void }) {
  const [VideoComp, setVideoComp] = useState<React.ComponentType<any> | null>(null);
  const [ResizeMode, setResizeMode] = useState<any>(null);
  const [error, setError] = useState('');
  const videoRef = useRef<any>(null);

  // Playback state
  const [isPlaying, setIsPlaying]       = useState(true);
  const [duration, setDuration]         = useState(0);
  const [position, setPosition]         = useState(0);
  const [buffered, setBuffered]         = useState(0);
  const [isBuffering, setIsBuffering]   = useState(true);
  const [isEnded, setIsEnded]           = useState(false);

  // UI state
  const [showControls, setShowControls] = useState(true);
  const [isSeeking, setIsSeeking]       = useState(false);
  const [seekPosition, setSeekPosition] = useState(0);
  const [showSkipFeedback, setShowSkipFeedback] = useState<null | 'back' | 'fwd'>(null);

  // Animations
  const controlsOpacity  = useRef(new Animated.Value(1)).current;
  const skipFeedbackAnim = useRef(new Animated.Value(0)).current;
  const hideTimer        = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { width: SW, height: SH } = Dimensions.get('window');
  const isLandscape = SW > SH;

  // ── Load expo-av ───────────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const av = require('expo-av');
      setVideoComp(() => av.Video);
      setResizeMode(av.ResizeMode ?? { CONTAIN: 'contain' });
    } catch (e) {
      setError('expo-av não instalado.');
    }
  }, []);

  // ── Screen orientation ────────────────────────────────────────────────────
  useEffect(() => {
    let didLock = false;
    try {
      const SO = require('expo-screen-orientation');
      SO.lockAsync(SO.OrientationLock.LANDSCAPE).catch(() => {});
      didLock = true;
    } catch (_) {}
    return () => {
      if (didLock) {
        try { const SO = require('expo-screen-orientation'); SO.lockAsync(SO.OrientationLock.PORTRAIT_UP).catch(() => {}); } catch (_) {}
      }
    };
  }, []);

  // ── Controls auto-hide ────────────────────────────────────────────────────
  const showControlsTemp = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    Animated.timing(controlsOpacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    setShowControls(true);
    hideTimer.current = setTimeout(() => {
      if (!isSeeking) {
        Animated.timing(controlsOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setShowControls(false));
      }
    }, 3500);
  }, [isSeeking]);

  useEffect(() => { showControlsTemp(); }, []);

  // ── Playback status ───────────────────────────────────────────────────────
  const onPlaybackStatusUpdate = useCallback((status: any) => {
    if (!status.isLoaded) { if (status.error) setError(status.error); return; }
    setIsPlaying(status.isPlaying ?? false);
    setDuration((status.durationMillis ?? 0) / 1000);
    setPosition((status.positionMillis ?? 0) / 1000);
    setIsBuffering(status.isBuffering ?? false);
    if (status.playableDurationMillis) setBuffered(status.playableDurationMillis / 1000);
    if (status.didJustFinish && !options.loop) { setIsEnded(true); setIsPlaying(false); options.onEnd?.(); }
  }, [options]);

  // ── Seek bar pan responder ─────────────────────────────────────────────────
  const seekBarRef  = useRef<View>(null);
  const seekBarLeft = useRef(0);
  const seekBarWidth = useRef(SW - 32);

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      setIsSeeking(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      const x = evt.nativeEvent.pageX - seekBarLeft.current;
      const pct = Math.max(0, Math.min(1, x / seekBarWidth.current));
      setSeekPosition(pct * (duration || 1));
    },
    onPanResponderMove: (evt) => {
      const x = evt.nativeEvent.pageX - seekBarLeft.current;
      const pct = Math.max(0, Math.min(1, x / seekBarWidth.current));
      setSeekPosition(pct * (duration || 1));
    },
    onPanResponderRelease: (evt) => {
      const x = evt.nativeEvent.pageX - seekBarLeft.current;
      const pct = Math.max(0, Math.min(1, x / seekBarWidth.current));
      const targetMs = pct * (duration || 1) * 1000;
      videoRef.current?.setPositionAsync(targetMs).catch(() => {});
      setIsSeeking(false);
      showControlsTemp();
    },
  })).current;

  // ── Actions ───────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    if (isEnded) {
      videoRef.current?.replayAsync(); setIsEnded(false); setIsPlaying(true);
    } else if (isPlaying) {
      videoRef.current?.pauseAsync();
    } else {
      videoRef.current?.playAsync();
    }
    showControlsTemp();
  }, [isPlaying, isEnded, showControlsTemp]);

  const skip = useCallback((seconds: number) => {
    const target = Math.max(0, Math.min(duration, position + seconds));
    videoRef.current?.setPositionAsync(target * 1000).catch(() => {});
    setShowSkipFeedback(seconds < 0 ? 'back' : 'fwd');
    Animated.sequence([
      Animated.timing(skipFeedbackAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
      Animated.delay(400),
      Animated.timing(skipFeedbackAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setShowSkipFeedback(null));
    showControlsTemp();
  }, [position, duration, showControlsTemp]);

  const handleClose = useCallback(() => { options.onClose?.(); onClose(); }, [options, onClose]);

  const displayPosition = isSeeking ? seekPosition : position;
  const progress = duration > 0 ? displayPosition / duration : 0;
  const bufferedPct = duration > 0 ? buffered / duration : 0;

  // ── Styles ────────────────────────────────────────────────────────────────
  const s = StyleSheet.create({
    root:         { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000', zIndex: 99999 },
    video:        { flex: 1 },
    overlay:      { ...StyleSheet.absoluteFillObject },
    // Top bar
    topBar:       { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 24, flexDirection: 'row', alignItems: 'center', gap: 14, zIndex: 10 },
    topGrad:      { position: 'absolute', top: 0, left: 0, right: 0, height: 110, zIndex: 0 },
    titleTxt:     { color: '#fff', fontSize: 16, fontWeight: '700', flex: 1, letterSpacing: 0.1, textShadowColor: 'rgba(0,0,0,0.9)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
    iconBtn:      { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' },
    // Center controls
    centerRow:    { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, zIndex: 5 },
    skipBtn:      { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.3)' },
    playBtn:      { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
    // Skip feedback
    skipFeedback: { position: 'absolute', top: '50%', alignItems: 'center', justifyContent: 'center', zIndex: 20, marginTop: -40 },
    skipFeedTxt:  { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 4, textAlign: 'center' },
    // Bottom bar
    bottomBar:    { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 20, paddingTop: 28, zIndex: 10 },
    bottomGrad:   { position: 'absolute', bottom: 0, left: 0, right: 0, height: 130, zIndex: 0 },
    timeRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    timeTxt:      { color: 'rgba(255,255,255,0.9)', fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] as any },
    // Seek bar
    seekWrap:     { height: 36, justifyContent: 'center', marginBottom: 4 },
    seekTrack:    { height: 3, backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: 2, overflow: 'visible' },
    seekBuffered: { position: 'absolute', top: 0, left: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.35)', borderRadius: 2 },
    seekFill:     { position: 'absolute', top: 0, left: 0, bottom: 0, backgroundColor: '#00E5FF', borderRadius: 2 },
    seekThumb:    { position: 'absolute', top: -6, width: 15, height: 15, borderRadius: 8, backgroundColor: '#00E5FF', shadowColor: '#00E5FF', shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
    // Bottom row
    bottomRow:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 2, gap: 8 },
    // Buffering
    bufferWrap:   { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 15 },
    // Error
    errWrap:      { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
    errTxt:       { color: '#fff', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  });

  const GradLayer = ({ from, height, style }: any) => (
    <View style={[style, { overflow: 'hidden' }]} pointerEvents="none">
      {[0.03,0.08,0.15,0.24,0.36,0.52,0.68,0.8].map((o, i, arr) => (
        <View key={i} style={{ position: 'absolute', [from === 'top' ? 'top' : 'bottom']: 0, left: 0, right: 0, height: `${Math.round((i+1)/arr.length*100)}%`, backgroundColor: `rgba(0,0,0,${o})` }} />
      ))}
    </View>
  );

  return (
    <View style={s.root}>
      <StatusBar hidden />

      {/* Video */}
      {error ? (
        <View style={s.errWrap}>
          <Text style={s.errTxt}>{error}</Text>
        </View>
      ) : VideoComp ? (
        <VideoComp
          ref={videoRef}
          source={{ uri: options.uri }}
          style={s.video}
          resizeMode={ResizeMode?.CONTAIN ?? 'contain'}
          shouldPlay
          isLooping={options.loop ?? false}
          positionMillis={(options.startPosition ?? 0) * 1000}
          onPlaybackStatusUpdate={onPlaybackStatusUpdate}
        />
      ) : (
        <View style={s.bufferWrap}><ActivityIndicator size="large" color="#00E5FF" /></View>
      )}

      {/* Tap zone — toggle controls */}
      <TouchableWithoutFeedback onPress={showControlsTemp}>
        <View style={s.overlay} />
      </TouchableWithoutFeedback>

      {/* Controls overlay */}
      <Animated.View style={[s.overlay, { opacity: controlsOpacity }]} pointerEvents={showControls ? 'box-none' : 'none'}>

        {/* Top gradient */}
        <GradLayer from="top" style={s.topGrad} />

        {/* Top bar */}
        <View style={s.topBar}>
          <TouchableOpacity style={s.iconBtn} onPress={handleClose} activeOpacity={0.75}>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '300' }}>✕</Text>
          </TouchableOpacity>
          {options.title ? (
            <Text style={s.titleTxt} numberOfLines={1}>{options.title}</Text>
          ) : <View style={{ flex: 1 }} />}
        </View>

        {/* Center controls */}
        <View style={s.centerRow} pointerEvents="box-none">
          <TouchableOpacity style={s.skipBtn} onPress={() => skip(-10)} activeOpacity={0.75}>
            <Text style={{ color: '#fff', fontSize: 26 }}>⏪</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.playBtn} onPress={togglePlay} activeOpacity={0.75}>
            {isEnded ? (
              <Text style={{ color: '#fff', fontSize: 32, marginLeft: 2 }}>↺</Text>
            ) : isPlaying ? (
              <Text style={{ color: '#fff', fontSize: 30, letterSpacing: 3, marginLeft: 2 }}>⏸</Text>
            ) : (
              <Text style={{ color: '#fff', fontSize: 32, marginLeft: 4 }}>▶</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={s.skipBtn} onPress={() => skip(10)} activeOpacity={0.75}>
            <Text style={{ color: '#fff', fontSize: 26 }}>⏩</Text>
          </TouchableOpacity>
        </View>

        {/* Skip feedback */}
        {showSkipFeedback === 'back' && (
          <Animated.View style={[s.skipFeedback, { left: SW * 0.18, opacity: skipFeedbackAnim }]}>
            <Text style={{ fontSize: 36 }}>⏪</Text>
            <Text style={s.skipFeedTxt}>-10s</Text>
          </Animated.View>
        )}
        {showSkipFeedback === 'fwd' && (
          <Animated.View style={[s.skipFeedback, { right: SW * 0.18, opacity: skipFeedbackAnim }]}>
            <Text style={{ fontSize: 36 }}>⏩</Text>
            <Text style={s.skipFeedTxt}>+10s</Text>
          </Animated.View>
        )}

        {/* Bottom gradient */}
        <GradLayer from="bottom" style={s.bottomGrad} />

        {/* Bottom bar */}
        <View style={s.bottomBar}>
          {/* Time */}
          <View style={s.timeRow}>
            <Text style={s.timeTxt}>{formatTime(displayPosition)}</Text>
            <Text style={s.timeTxt}>{formatTime(duration)}</Text>
          </View>

          {/* Seek bar */}
          <View
            style={s.seekWrap}
            ref={seekBarRef}
            onLayout={(e) => {
              seekBarRef.current?.measure((fx, fy, w, h, px) => {
                seekBarLeft.current = px;
                seekBarWidth.current = w;
              });
            }}
            {...panResponder.panHandlers}
          >
            <View style={s.seekTrack}>
              <View style={[s.seekBuffered, { width: `${bufferedPct * 100}%` }]} />
              <View style={[s.seekFill, { width: `${progress * 100}%` }]} />
              <View style={[s.seekThumb, { left: `${progress * 100}%`, transform: [{ translateX: -7 }, { scale: isSeeking ? 1.4 : 1 }] }]} />
            </View>
          </View>

          {/* Bottom row */}
          <View style={s.bottomRow}>
            <Text style={[s.timeTxt, { color: 'rgba(255,255,255,0.55)', fontSize: 11 }]}>
              {isBuffering ? 'Carregando…' : ''}
            </Text>
          </View>
        </View>
      </Animated.View>

      {/* Buffering spinner (independent of controls) */}
      {isBuffering && !isEnded && (
        <View style={[s.bufferWrap, { pointerEvents: 'none' }]}>
          <ActivityIndicator size="large" color="#00E5FF" />
        </View>
      )}
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

  const musicUpdate = useCallback((info: MusicNotificationInfo) => setNotifInfo(info), []);
  const musicSetHandlers = useCallback((handlers: MusicNotificationHandlers) => {
    handlersRef.current = handlers;
    if (notifInfo) {
      if (Platform.OS === 'web') setupWebMediaSession(notifInfo, handlers);
      else setupNativeMediaNotification(notifInfo, handlers);
    }
  }, [notifInfo]);
  const musicClear = useCallback(() => {
    setNotifInfo(null);
    if (Platform.OS === 'web') clearWebMediaSession();
    else clearNativeMediaNotification();
  }, []);

  const videoOpen  = useCallback((options: VideoPlayerOptions) => setVideoOptions(options), []);
  const videoClose = useCallback(() => setVideoOptions(null), []);

  const contextValue: MediaPlayerContextValue = {
    musicNotification: { update: musicUpdate, setHandlers: musicSetHandlers, clear: musicClear, current: notifInfo },
    videoPlayer: { open: videoOpen, close: videoClose, isOpen: videoOptions !== null },
  };

  return (
    <MediaPlayerContext.Provider value={contextValue}>
      {children}
      {videoOptions && <LhubVideoPlayer options={videoOptions} onClose={videoClose} />}
    </MediaPlayerContext.Provider>
  );
}
