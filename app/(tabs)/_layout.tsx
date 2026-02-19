import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, useColorScheme,
  Platform, Image, StatusBar, Pressable, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withTiming, runOnJS,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useExtensions, InstalledExtension } from '../contexts/ExtensionContext';
import ExtensionNavigator from '../components/ExtensionNavigator';

const MD3 = {
  light: {
    primary: '#6750A4', primaryContainer: '#EADDFF', onPrimary: '#FFFFFF',
    surface: '#FFFBFE', surfaceVariant: '#E7E0EC',
    onSurface: '#1C1B1F', onSurfaceVariant: '#49454F',
    navBackground: '#FFFBFE', outlineVariant: '#CAC4D0',
    scrim: 'rgba(0,0,0,0.35)', drawerBg: '#F6F0FF',
    error: '#B3261E', success: '#1B6B3A',
    successContainer: '#C8F5D8', errorContainer: '#F9DEDC',
  },
  dark: {
    primary: '#D0BCFF', primaryContainer: '#4F378B', onPrimary: '#381E72',
    surface: '#1C1B1F', surfaceVariant: '#2B2930',
    onSurface: '#E6E1E5', onSurfaceVariant: '#CAC4D0',
    navBackground: '#2B2930', outlineVariant: '#49454F',
    scrim: 'rgba(0,0,0,0.55)', drawerBg: '#211F26',
    error: '#F2B8B5', success: '#6DD58C',
    successContainer: '#0D4A22', errorContainer: '#8C1D18',
  },
};



function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const show = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };
  return { toast, show };
}

function pickLhubFile(): Promise<File | null> {
  if (Platform.OS !== 'web') return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(input);
    let resolved = false;
    const done = (file: File | null) => {
      if (resolved) return;
      resolved = true;
      try { document.body.removeChild(input); } catch {}
      resolve(file);
    };
    input.addEventListener('change', () => done(input.files?.[0] ?? null));
    const onDocInteract = () => { setTimeout(() => { if (!resolved) done(null); }, 200); };
    document.addEventListener('mousedown', onDocInteract, { once: true });
    document.addEventListener('keydown', onDocInteract, { once: true });
    input.click();
  });
}

export default function TabLayout() {
  const scheme = useColorScheme() ?? 'light';
  const colors = MD3[scheme];
  const insets = useSafeAreaInsets();

  const { extensions, installFromFile, installFromNative, uninstallExtension } = useExtensions();

  const [activeKey, setActiveKey] = useState('');
  const [renderedKey, setRenderedKey] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const { toast, show: showToast } = useToast();

  // Quando a primeira extensão é instalada, ativa automaticamente sua primeira aba
  React.useEffect(() => {
    if (!activeKey && extensions.length > 0) {
      const first = extensions[0];
      const key = `${first.manifest.id}__${first.manifest.tabs[0]?.id}`;
      setActiveKey(key);
      setRenderedKey(key);
    }
  }, [extensions]);

  const drawerTx = useSharedValue(-340);
  const scrimOp  = useSharedValue(0);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    drawerTx.value = withTiming(0, { duration: 240 });
    scrimOp.value  = withTiming(1, { duration: 220 });
  }, []);

  const closeDrawer = useCallback((cb?: () => void) => {
    drawerTx.value = withTiming(-340, { duration: 200 }, () => {
      runOnJS(setDrawerOpen)(false);
      if (cb) runOnJS(cb)();
    });
    scrimOp.value = withTiming(0, { duration: 200 });
  }, []);

  const drawerStyle = useAnimatedStyle(() => ({ transform: [{ translateX: drawerTx.value }] }));
  const scrimStyle  = useAnimatedStyle(() => ({ opacity: scrimOp.value }));

  const allExtTabs = extensions.flatMap(ext =>
    ext.manifest.tabs.map(t => ({
      key: `${ext.manifest.id}__${t.id}`,
      extId: ext.manifest.id,
      label: t.label,
      icon: t.icon,
      iconActive: t.iconActive,
      iconUri: ext.iconUri,
      tabObj: t,
    }))
  );

  const handleSelectTab = useCallback((key: string) => {
    if (key === activeKey) { closeDrawer(); return; }
    closeDrawer(() => {
      setActiveKey(key);
      setRenderedKey(key);
    });
  }, [activeKey, closeDrawer]);

  const handleImport = async () => {
    setImporting(true);
    try {
      if (Platform.OS === 'web') {
        const file = await pickLhubFile();
        if (!file) return;
        const result = await installFromFile(file);
        if (result.ok) showToast('Extension installed!', 'success');
        else showToast(result.error ?? 'Unknown error', 'error');
      } else {
        const result = await installFromNative();
        if (result.ok) showToast('Extension installed!', 'success');
        else if (result.error !== 'cancelled') showToast(result.error ?? 'Unknown error', 'error');
      }
    } catch (e: any) {
      showToast(e.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleUninstall = (ext: InstalledExtension) => {
    const doRemove = () => {
      uninstallExtension(ext.manifest.id);
      showToast(`"${ext.manifest.name}" removed.`, 'success');
      if (activeKey.startsWith(ext.manifest.id + '__')) {
        // tenta ir para primeira aba de outra extensão
        const next = allExtTabs.find(t => !t.key.startsWith(ext.manifest.id + '__'));
        setActiveKey(next?.key ?? '');
        setRenderedKey(next?.key ?? '');
      }
    };
    if (Platform.OS === 'web') {
      if ((window as any).confirm(`Remove "${ext.manifest.name}"?`)) doRemove();
    } else {
      Alert.alert('Remove Extension', `Remove "${ext.manifest.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: doRemove },
      ]);
    }
  };

  function renderScreen() {
    const t = allExtTabs.find(t => t.key === renderedKey);
    if (t?.tabObj) return <ExtensionNavigator tab={t.tabObj} />;
    // Nenhuma extensão instalada — tela vazia
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <MaterialCommunityIcons name="puzzle-outline" size={56} color={colors.onSurfaceVariant} style={{ opacity: 0.3 }} />
        <Text style={{ color: colors.onSurfaceVariant, fontSize: 15, fontWeight: '600', opacity: 0.5 }}>
          No extensions installed
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface, paddingTop: insets.top }}>
      <StatusBar
        translucent={false}
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.surface}
      />

      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <View style={{ flex: 1 }}>
          {renderScreen()}
        </View>

        {/* Navbar — single "Extensions" button */}
        <View style={[s.navWrapper, { paddingBottom: insets.bottom > 0 ? insets.bottom : 16 }]}>
          <View style={[s.navContainer, { backgroundColor: colors.navBackground }]}>
            <TouchableOpacity style={s.navBtn} onPress={openDrawer} activeOpacity={0.8}>
              <View style={s.iconRow}>
                <Animated.View style={[s.indicator, {
                  width: drawerOpen ? 56 : 32,
                  opacity: drawerOpen ? 1 : 0,
                  backgroundColor: colors.primaryContainer,
                  position: 'absolute', height: 34, borderRadius: 17,
                }]} />
                <MaterialCommunityIcons
                  name={drawerOpen ? 'puzzle' : 'puzzle-outline'}
                  size={22}
                  color={drawerOpen ? colors.primary : colors.onSurfaceVariant}
                />
                {extensions.length > 0 && (
                  <View style={[s.extBadge, { backgroundColor: colors.primary }]}>
                    <Text style={[s.extBadgeText, { color: colors.onPrimary }]}>
                      {extensions.length}
                    </Text>
                  </View>
                )}
              </View>
              <Text style={[s.label, { color: drawerOpen ? colors.primary : colors.onSurfaceVariant }]}>
                Extensions
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Drawer overlay */}
      {drawerOpen && (
        <>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }, scrimStyle]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => closeDrawer()} />
          </Animated.View>

          <Animated.View style={[dwr.panel, { backgroundColor: colors.drawerBg }, drawerStyle]}>
            {/* Drawer header */}
            <View style={[dwr.header, { paddingTop: insets.top + 14 }]}>
              <MaterialCommunityIcons name="puzzle" size={22} color={colors.primary} />
              <Text style={[dwr.headerTitle, { color: colors.onSurface }]}>Extensions</Text>
              <TouchableOpacity onPress={() => closeDrawer()} hitSlop={10} style={dwr.closeBtn}>
                <MaterialCommunityIcons name="close" size={20} color={colors.onSurfaceVariant} />
              </TouchableOpacity>
            </View>

            <View style={[dwr.divider, { backgroundColor: colors.outlineVariant }]} />

            {/* Extension tabs */}
            {extensions.length > 0 && (
              <>
                <Text style={[dwr.sectionLabel, { color: colors.onSurfaceVariant }]}>Installed</Text>
                {extensions.map(ext => (
                  <View key={ext.manifest.id}>
                    {/* Cabeçalho da extensão — só aparece se ela tiver mais de 1 tab */}
                    {ext.manifest.tabs.length > 1 && (
                      <View style={dwr.extGroup}>
                        <View style={dwr.extGroupLeft}>
                          {ext.iconUri
                            ? <Image source={{ uri: ext.iconUri }} style={dwr.extGroupIcon} />
                            : <View style={[dwr.extGroupIconFallback, { backgroundColor: colors.primaryContainer }]}>
                                <MaterialCommunityIcons name="puzzle" size={12} color={colors.primary} />
                              </View>
                          }
                          <Text style={[dwr.extGroupName, { color: colors.onSurfaceVariant }]} numberOfLines={1}>
                            {ext.manifest.name}
                          </Text>
                        </View>
                        <TouchableOpacity onPress={() => handleUninstall(ext)} hitSlop={8}>
                          <MaterialCommunityIcons name="trash-can-outline" size={15} color={colors.error} />
                        </TouchableOpacity>
                      </View>
                    )}
                    {ext.manifest.tabs.map((t, idx) => {
                      const key = `${ext.manifest.id}__${t.id}`;
                      // Extensão com 1 tab: mostrar lixeira inline no próprio item
                      const isSingle = ext.manifest.tabs.length === 1;
                      return (
                        <DrawerItem
                          key={key}
                          label={isSingle ? ext.manifest.name : t.label}
                          icon={t.icon}
                          iconActive={t.iconActive}
                          active={activeKey === key}
                          iconUri={ext.iconUri}
                          colors={colors}
                          onPress={() => handleSelectTab(key)}
                          onUninstall={isSingle ? () => handleUninstall(ext) : undefined}
                          indent={!isSingle}
                        />
                      );
                    })}
                  </View>
                ))}
              </>
            )}

            {extensions.length === 0 && (
              <View style={dwr.emptyArea}>
                <MaterialCommunityIcons name="puzzle-outline" size={36} color={colors.onSurfaceVariant} style={{ opacity: 0.45 }} />
                <Text style={[dwr.emptyText, { color: colors.onSurfaceVariant }]}>No extensions yet</Text>
                <Text style={[dwr.emptyHint, { color: colors.onSurfaceVariant }]}>
                  Import a <Text style={{ fontWeight: '700' }}>.lhub</Text> file below
                </Text>
              </View>
            )}

            <View style={{ flex: 1 }} />

            {/* Toast */}
            {toast && (
              <View style={[dwr.toast, {
                backgroundColor: toast.type === 'success' ? colors.successContainer : colors.errorContainer,
                marginHorizontal: 12, marginBottom: 8,
              }]}>
                <MaterialCommunityIcons
                  name={toast.type === 'success' ? 'check-circle' : 'alert-circle'}
                  size={14}
                  color={toast.type === 'success' ? colors.success : colors.error}
                />
                <Text style={[dwr.toastText, { color: toast.type === 'success' ? colors.success : colors.error }]} numberOfLines={2}>
                  {toast.msg}
                </Text>
              </View>
            )}

            {/* Import button */}
            <View style={[dwr.importArea, { paddingBottom: insets.bottom > 0 ? insets.bottom : 16 }]}>
              <TouchableOpacity
                style={[dwr.importBtn, { backgroundColor: importing ? colors.primaryContainer : colors.primary }]}
                onPress={handleImport}
                disabled={importing}
                activeOpacity={0.85}>
                <MaterialCommunityIcons
                  name="import"
                  size={17}
                  color={importing ? colors.primary : colors.onPrimary}
                />
                <Text style={[dwr.importBtnText, { color: importing ? colors.primary : colors.onPrimary }]}>
                  {importing ? 'Importing…' : 'Import .lhub'}
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </>
      )}
    </View>
  );
}

function DrawerItem({ label, icon, iconActive, active, iconUri, colors, onPress, onUninstall, indent }: {
  label: string; icon: string; iconActive?: string; active: boolean;
  iconUri?: string | null; colors: typeof MD3['light'];
  onPress: () => void; onUninstall?: () => void; indent?: boolean;
}) {
  const bg = useAnimatedStyle(() => ({
    backgroundColor: withTiming(active ? colors.primaryContainer + 'BB' : 'transparent', { duration: 180 }),
  }));
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75}
      style={[dwr.item, indent && dwr.itemIndent]}>
      <Animated.View style={[StyleSheet.absoluteFill, { borderRadius: 14 }, bg]} />
      {iconUri
        ? <Image source={{ uri: iconUri }} style={dwr.itemExtIcon} />
        : <MaterialCommunityIcons
            name={(active ? (iconActive ?? icon) : icon) as any}
            size={19}
            color={active ? colors.primary : colors.onSurfaceVariant}
          />
      }
      <Text style={[dwr.itemLabel, {
        color: active ? colors.primary : colors.onSurface,
        fontWeight: active ? '700' : '500',
      }]} numberOfLines={1}>
        {label}
      </Text>
      {active && <View style={[dwr.activeBar, { backgroundColor: colors.primary }]} />}
      {onUninstall && (
        <TouchableOpacity onPress={onUninstall} hitSlop={8} style={{ marginLeft: 4 }}>
          <MaterialCommunityIcons name="trash-can-outline" size={15} color={colors.error} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  navWrapper:    { paddingHorizontal: 20, paddingTop: 8 },
  navContainer:  {
    flexDirection: 'row', borderRadius: 28, paddingVertical: 10,
    paddingHorizontal: 8, shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15,
    shadowRadius: 16, elevation: 10, alignItems: 'center', justifyContent: 'center',
  },
  navBtn:        { alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 28 },
  iconRow:       { height: 34, alignItems: 'center', justifyContent: 'center' },
  indicator:     {},
  label:         { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  extBadge:      { position: 'absolute', top: -3, right: -10, borderRadius: 8, paddingHorizontal: 4, paddingVertical: 1, minWidth: 16, alignItems: 'center' },
  extBadgeText:  { fontSize: 9, fontWeight: '800' },
});

const dwr = StyleSheet.create({
  panel: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    width: '46%', maxWidth: 290,
    shadowColor: '#000', shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.25, shadowRadius: 24, elevation: 24, zIndex: 100,
  },
  header:               { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 12, gap: 10 },
  headerTitle:          { fontSize: 17, fontWeight: '700', flex: 1, letterSpacing: 0.2 },
  closeBtn:             { padding: 4 },
  divider:              { height: 1, marginHorizontal: 14, marginBottom: 6 },
  sectionLabel:         { fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 18, paddingTop: 10, paddingBottom: 2 },
  extGroup:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 5, gap: 8 },
  extGroupLeft:         { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  extGroupIcon:         { width: 16, height: 16, borderRadius: 4 },
  extGroupIconFallback: { width: 16, height: 16, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  extGroupName:         { fontSize: 10, fontWeight: '600', flex: 1 },
  item:                 { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 11, gap: 10, marginHorizontal: 8, borderRadius: 14, overflow: 'hidden' },
  itemIndent:           { paddingLeft: 24 },
  itemLabel:            { fontSize: 13, flex: 1 },
  itemExtIcon:          { width: 19, height: 19, borderRadius: 5 },
  activeBar:            { width: 3, height: 18, borderRadius: 2 },
  emptyArea:            { alignItems: 'center', paddingTop: 28, paddingHorizontal: 18, gap: 6 },
  emptyText:            { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  emptyHint:            { fontSize: 11, textAlign: 'center', opacity: 0.7 },
  toast:                { borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  toastText:            { fontSize: 11, fontWeight: '500', flex: 1 },
  importArea:           { padding: 12, paddingTop: 6 },
  importBtn:            { flexDirection: 'row', borderRadius: 22, height: 46, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6 },
  importBtnText:        { fontSize: 13, fontWeight: '600', letterSpacing: 0.1 },
});
