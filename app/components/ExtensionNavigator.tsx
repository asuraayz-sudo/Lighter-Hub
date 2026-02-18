import React, { useState, useCallback, useRef } from 'react';
import {
  View, TouchableOpacity, Text, StyleSheet, useColorScheme, Platform,
} from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle, withSpring, withTiming, runOnJS, Easing,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ExtensionTab, ExtNavigation } from '../contexts/ExtensionContext';

const MD3 = {
  light: {
    surface: '#FFFBFE', onSurface: '#1C1B1F', onSurfaceVariant: '#49454F',
    surfaceVariant: '#E7E0EC', primary: '#6750A4', outlineVariant: '#CAC4D0',
  },
  dark: {
    surface: '#1C1B1F', onSurface: '#E6E1E5', onSurfaceVariant: '#CAC4D0',
    surfaceVariant: '#2B2930', primary: '#D0BCFF', outlineVariant: '#49454F',
  },
};

interface StackEntry {
  screenName: string;
  params: any;
}

interface Props {
  tab: ExtensionTab;
}

export default function ExtensionNavigator({ tab }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const colors = MD3[scheme];

  // Stack de navegação
  const [stack, setStack] = useState<StackEntry[]>([{ screenName: '__root__', params: {} }]);
  const current = stack[stack.length - 1];
  const canGoBack = stack.length > 1;

  // Animação de slide
  const translateX = useSharedValue(0);
  const opacity    = useSharedValue(1);

  const animateTransition = useCallback((direction: 'push' | 'pop', onMid: () => void) => {
    'worklet';
    const outX = direction === 'push' ? -30 : 30;
    const inX  = direction === 'push' ?  30 : -30;
    opacity.value = withTiming(0, { duration: 100, easing: Easing.out(Easing.ease) }, () => {
      runOnJS(onMid)();
      translateX.value = inX;
      opacity.value    = withTiming(1, { duration: 180, easing: Easing.out(Easing.ease) });
      translateX.value = withSpring(0, { damping: 22, stiffness: 220 });
    });
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    flex: 1,
    opacity:   opacity.value,
    transform: [{ translateX: translateX.value }],
  }));

  // Objeto de navegação passado ao componente
  const navigation: ExtNavigation = {
    push: (screenName: string, params?: any) => {
      animateTransition('push', () => {
        setStack(prev => [...prev, { screenName, params: params ?? {} }]);
      });
    },
    pop: () => {
      if (stack.length <= 1) return;
      animateTransition('pop', () => {
        setStack(prev => prev.slice(0, -1));
      });
    },
    popToRoot: () => {
      animateTransition('pop', () => {
        setStack([{ screenName: '__root__', params: {} }]);
      });
    },
    getParams: () => current.params,
  };

  // Qual componente renderizar
  let ScreenComponent: React.ComponentType<any> | null = null;
  let screenTitle = tab.label;

  if (current.screenName === '__root__') {
    ScreenComponent = tab.component;
  } else if (tab.screens && tab.screens[current.screenName]) {
    ScreenComponent = tab.screens[current.screenName];
    screenTitle = current.params?._title ?? current.screenName;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      {/* Top bar com back button — só aparece quando tem histórico */}
      {canGoBack && (
        <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.outlineVariant }]}>
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.pop()}
            activeOpacity={0.7}
            hitSlop={8}>
            <MaterialCommunityIcons name="arrow-left" size={24} color={colors.onSurface} />
          </TouchableOpacity>
          <Text style={[styles.topBarTitle, { color: colors.onSurface }]} numberOfLines={1}>
            {screenTitle}
          </Text>
          <View style={styles.backBtnPlaceholder} />
        </View>
      )}

      <Animated.View style={animStyle}>
        {ScreenComponent
          ? <ScreenComponent navigation={navigation} params={current.params} />
          : <View style={styles.notFound}>
              <Text style={{ color: colors.onSurfaceVariant }}>
                Screen "{current.screenName}" not found.
              </Text>
            </View>
        }
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    borderBottomWidth: 1,
  },
  backBtn:            { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  backBtnPlaceholder: { width: 40 },
  topBarTitle:        { flex: 1, fontSize: 18, fontWeight: '600', textAlign: 'center', letterSpacing: 0.15 },
  notFound:           { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
