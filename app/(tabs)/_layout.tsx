import React, { useState, useCallback, useRef } from 'react';
import {
  View, TouchableOpacity, StyleSheet, useColorScheme,
  Platform, Image, StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withSpring, withTiming, runOnJS, Easing,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useExtensions } from '../contexts/ExtensionContext';
import ExtensionNavigator from '../components/ExtensionNavigator';
import HomeScreen from './index';
import ExtensionsScreen from './explore';

const MD3 = {
  light: {
    primary: '#6750A4', primaryContainer: '#EADDFF',
    surface: '#FFFBFE', onSurface: '#1C1B1F',
    onSurfaceVariant: '#49454F', navBackground: '#FFFBFE',
  },
  dark: {
    primary: '#D0BCFF', primaryContainer: '#4F378B',
    surface: '#1C1B1F', onSurface: '#E6E1E5',
    onSurfaceVariant: '#CAC4D0', navBackground: '#2B2930',
  },
};

type BuiltinTab = { kind: 'builtin'; name: 'home' | 'extensions'; label: string; icon: string; iconActive: string };
type ExtTab     = { kind: 'ext'; extId: string; tabId: string; label: string; icon: string; iconActive?: string; iconUri?: string | null; tabObj: any };
type AnyTab = BuiltinTab | ExtTab;

function tabKey(t: AnyTab) {
  return t.kind === 'builtin' ? t.name : `${t.extId}__${t.tabId}`;
}

function usePageTransition() {
  const tx = useSharedValue(0);
  const op = useSharedValue(1);
  const transition = (right: boolean, onMid: () => void) => {
    'worklet';
    op.value = withTiming(0, { duration: 90, easing: Easing.out(Easing.ease) }, () => {
      runOnJS(onMid)();
      tx.value = right ? -18 : 18;
      op.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.ease) });
      tx.value = withSpring(0, { damping: 22, stiffness: 220 });
    });
  };
  const animStyle = useAnimatedStyle(() => ({ opacity: op.value, transform: [{ translateX: tx.value }] }));
  return { transition, animStyle };
}

export default function TabLayout() {
  const [activeKey, setActiveKey]     = useState('home');
  const [renderedKey, setRenderedKey] = useState('home');
  const scheme  = useColorScheme() ?? 'light';
  const colors  = MD3[scheme];
  const insets  = useSafeAreaInsets();
  const { transition, animStyle } = usePageTransition();
  const { extensions } = useExtensions();

  const tabs: AnyTab[] = [
    { kind: 'builtin', name: 'home',       label: 'Home',       icon: 'home-outline',   iconActive: 'home'   },
    ...extensions.flatMap(ext =>
      ext.manifest.tabs.map(t => ({
        kind:     'ext' as const,
        extId:    ext.manifest.id,
        tabId:    t.id,
        label:    t.label,
        icon:     t.icon,
        iconActive: t.iconActive,
        iconUri:  ext.iconUri,
        tabObj:   t,
      }))
    ),
    { kind: 'builtin', name: 'extensions', label: 'Extensions', icon: 'puzzle-outline', iconActive: 'puzzle' },
  ];

  const activeIndex = tabs.findIndex(t => tabKey(t) === activeKey);

  const handleTabPress = useCallback((tab: AnyTab) => {
    const key = tabKey(tab);
    if (key === activeKey) return;
    const newIdx = tabs.findIndex(t => tabKey(t) === key);
    setActiveKey(key);
    transition(newIdx > activeIndex, () => setRenderedKey(key));
  }, [activeKey, activeIndex, tabs]);

  function renderScreen() {
    if (renderedKey === 'home')       return <HomeScreen />;
    if (renderedKey === 'extensions') return <ExtensionsScreen />;
    const t = tabs.find(t => tabKey(t) === renderedKey) as ExtTab | undefined;
    if (t?.tabObj) return <ExtensionNavigator tab={t.tabObj} />;
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <StatusBar
        translucent={false}
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.surface}
      />
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <Animated.View style={[{ flex: 1 }, animStyle]}>
          {renderScreen()}
        </Animated.View>

        <View style={[s.navWrapper, { paddingBottom: insets.bottom > 0 ? insets.bottom : 16 }]}>
          <View style={[s.navContainer, { backgroundColor: colors.navBackground }]}>
            {tabs.map(tab => (
              <NavBtn key={tabKey(tab)} tab={tab} active={activeKey === tabKey(tab)}
                onPress={() => handleTabPress(tab)} colors={colors} />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
}

function NavBtn({ tab, active, onPress, colors }: {
  tab: AnyTab; active: boolean; onPress: () => void; colors: typeof MD3['light'];
}) {
  const indicatorStyle = useAnimatedStyle(() => ({
    width:   withSpring(active ? 56 : 28, { damping: 20, stiffness: 300 }),
    opacity: withTiming(active ? 1 : 0,  { duration: 180 }),
    backgroundColor: colors.primaryContainer,
  }));
  const iconScale  = useAnimatedStyle(() => ({ transform: [{ scale: withSpring(active ? 1.12 : 1, { damping: 15, stiffness: 300 }) }] }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: withTiming(active ? 1 : 0.5, { duration: 200 }), transform: [{ scale: withTiming(active ? 1 : 0.92, { duration: 200 }) }] }));

  const iconName = tab.kind === 'builtin'
    ? (active ? tab.iconActive : tab.icon)
    : (active ? (tab.iconActive ?? tab.icon) : tab.icon);

  return (
    <TouchableOpacity style={s.navBtn} onPress={onPress} activeOpacity={0.8}>
      <View style={s.iconRow}>
        <Animated.View style={[s.indicator, indicatorStyle]} />
        <Animated.View style={[s.iconAbsolute, iconScale]}>
          {tab.kind === 'ext' && tab.iconUri
            ? <Image source={{ uri: tab.iconUri }} style={s.extIcon} />
            : <MaterialCommunityIcons name={iconName as any} size={22} color={active ? colors.primary : colors.onSurfaceVariant} />
          }
        </Animated.View>
      </View>
      <Animated.Text numberOfLines={1} style={[s.label, { color: active ? colors.primary : colors.onSurfaceVariant }, labelStyle]}>
        {tab.label}
      </Animated.Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  navWrapper:   { paddingHorizontal: 20, paddingTop: 8 },
  navContainer: { flexDirection: 'row', borderRadius: 28, paddingVertical: 10, paddingHorizontal: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 16, elevation: 10, alignItems: 'center' },
  navBtn:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, minWidth: 0 },
  iconRow:      { height: 34, alignItems: 'center', justifyContent: 'center' },
  indicator:    { position: 'absolute', height: 34, borderRadius: 17 },
  iconAbsolute: { alignItems: 'center', justifyContent: 'center' },
  label:        { fontSize: 10, fontWeight: '600', letterSpacing: 0.3, maxWidth: 72, textAlign: 'center' },
  extIcon:      { width: 22, height: 22, borderRadius: 6 },
});
