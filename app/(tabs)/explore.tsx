import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, useColorScheme,
  StatusBar, FlatList, Image, Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useExtensions, InstalledExtension } from '../contexts/ExtensionContext';

const MD3 = {
  light: {
    primary: '#6750A4', onPrimary: '#FFFFFF', primaryContainer: '#EADDFF',
    surface: '#FFFBFE', surfaceVariant: '#E7E0EC',
    onSurface: '#1C1B1F', onSurfaceVariant: '#49454F',
    outlineVariant: '#CAC4D0', error: '#B3261E', errorContainer: '#F9DEDC',
    success: '#1B6B3A', successContainer: '#C8F5D8',
  },
  dark: {
    primary: '#D0BCFF', onPrimary: '#381E72', primaryContainer: '#4F378B',
    surface: '#1C1B1F', surfaceVariant: '#2B2930',
    onSurface: '#E6E1E5', onSurfaceVariant: '#CAC4D0',
    outlineVariant: '#49454F', error: '#F2B8B5', errorContainer: '#8C1D18',
    success: '#6DD58C', successContainer: '#0D4A22',
  },
};

// Toast simples substituindo Alert
function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const show = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };
  return { toast, show };
}

// Picker robusto — sem listener de focus que dispara antes da hora
function pickLhubFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Sem accept — .lhub é extensão desconhecida e browsers a escondem quando filtrada
    input.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
    document.body.appendChild(input);

    let resolved = false;
    const done = (file: File | null) => {
      if (resolved) return;
      resolved = true;
      try { document.body.removeChild(input); } catch {}
      resolve(file);
    };

    input.addEventListener('change', () => {
      done(input.files?.[0] ?? null);
    });

    // Fallback: se o usuário cancelar sem selecionar nada
    // Usamos mousedown/keydown no documento para detectar interação após o picker fechar
    const onDocInteract = () => {
      setTimeout(() => {
        if (!resolved) done(null);
      }, 200);
    };
    document.addEventListener('mousedown', onDocInteract, { once: true });
    document.addEventListener('keydown', onDocInteract, { once: true });

    input.click();
  });
}

export default function ExtensionsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const colors = MD3[scheme];
  const { extensions, installFromFile, uninstallExtension } = useExtensions();
  const [importing, setImporting] = useState(false);
  const { toast, show: showToast } = useToast();

  const handleImport = async () => {
    if (Platform.OS !== 'web') {
      showToast('Import is only supported on web.', 'error');
      return;
    }

    setImporting(true);
    try {
      console.log('[lhub] Opening file picker...');
      const file = await pickLhubFile();

      if (!file) {
        console.log('[lhub] No file selected.');
        return;
      }

      console.log('[lhub] File selected:', file.name, 'size:', file.size);
      const result = await installFromFile(file);
      console.log('[lhub] Install result:', result);

      if (result.ok) {
        showToast('Extension installed successfully!', 'success');
      } else {
        showToast(result.error ?? 'Unknown error', 'error');
      }
    } catch (e: any) {
      console.error('[lhub] Unexpected error:', e);
      showToast(e.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleUninstall = (ext: InstalledExtension) => {
    // Usar confirm nativo do browser no lugar de Alert
    const ok = window.confirm(`Remove "${ext.manifest.name}"?\nThis extension and its tabs will be removed.`);
    if (ok) {
      uninstallExtension(ext.manifest.id);
      showToast(`"${ext.manifest.name}" removed.`, 'success');
    }
  };

  return (
    <View style={[s.container, { backgroundColor: colors.surface }]}>
      <StatusBar barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'} backgroundColor={colors.surface} />

      {/* Toast */}
      {toast && (
        <View style={[s.toast, {
          backgroundColor: toast.type === 'success' ? colors.successContainer : colors.errorContainer,
        }]}>
          <MaterialCommunityIcons
            name={toast.type === 'success' ? 'check-circle' : 'alert-circle'}
            size={18}
            color={toast.type === 'success' ? colors.success : colors.error}
          />
          <Text style={[s.toastText, { color: toast.type === 'success' ? colors.success : colors.error }]}>
            {toast.msg}
          </Text>
        </View>
      )}

      <View style={s.header}>
        <Text style={[s.title, { color: colors.onSurface }]}>Extensions</Text>
        <Text style={[s.subtitle, { color: colors.onSurfaceVariant }]}>
          {extensions.length === 0 ? 'No extensions installed' : `${extensions.length} installed`}
        </Text>
      </View>

      <View style={[s.divider, { backgroundColor: colors.outlineVariant }]} />

      {extensions.length > 0 ? (
        <FlatList
          data={extensions}
          keyExtractor={e => e.manifest.id}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}
          renderItem={({ item }) => (
            <View style={[s.extCard, { backgroundColor: colors.surfaceVariant }]}>
              <View style={s.extLeft}>
                {item.iconUri
                  ? <Image source={{ uri: item.iconUri }} style={s.extIcon} />
                  : <View style={[s.extIconFallback, { backgroundColor: colors.primaryContainer }]}>
                      <MaterialCommunityIcons name="puzzle" size={20} color={colors.primary} />
                    </View>
                }
                <View style={{ flex: 1 }}>
                  <Text style={[s.extName, { color: colors.onSurface }]}>{item.manifest.name}</Text>
                  <Text style={[s.extMeta, { color: colors.onSurfaceVariant }]}>
                    v{item.manifest.version} · {item.manifest.tabs.length} tab{item.manifest.tabs.length > 1 ? 's' : ''}
                  </Text>
                  {item.manifest.description
                    ? <Text style={[s.extDesc, { color: colors.onSurfaceVariant }]} numberOfLines={2}>{item.manifest.description}</Text>
                    : null}
                </View>
              </View>
              <TouchableOpacity onPress={() => handleUninstall(item)} style={s.removeBtn} hitSlop={8}>
                <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </View>
          )}
        />
      ) : (
        <View style={s.emptyArea}>
          <View style={[s.emptyCard, { backgroundColor: colors.surfaceVariant, borderColor: colors.outlineVariant }]}>
            <MaterialCommunityIcons name="puzzle-outline" size={48} color={colors.onSurfaceVariant} />
            <Text style={[s.emptyTitle, { color: colors.onSurface }]}>No extensions yet</Text>
            <Text style={[s.emptyDesc, { color: colors.onSurfaceVariant }]}>
              Import a <Text style={{ fontWeight: '700' }}>.lhub</Text> file to get started
            </Text>
          </View>
        </View>
      )}

      <View style={s.importArea}>
        <TouchableOpacity
          style={[s.importBtn, { backgroundColor: importing ? colors.primaryContainer : colors.primary }]}
          onPress={handleImport}
          disabled={importing}
          activeOpacity={0.85}>
          <MaterialCommunityIcons
            name="import"
            size={20}
            color={importing ? colors.primary : colors.onPrimary}
          />
          <Text style={[s.importBtnText, { color: importing ? colors.primary : colors.onPrimary }]}>
            {importing ? 'Importing...' : 'Import Extension'}
          </Text>
          <View style={[s.badge, { backgroundColor: (importing ? colors.primary : colors.onPrimary) + '25' }]}>
            <Text style={[s.badgeText, { color: importing ? colors.primary : colors.onPrimary }]}>.lhub</Text>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1 },
  toast:           { marginHorizontal: 16, marginTop: 12, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  toastText:       { fontSize: 14, fontWeight: '500', flex: 1 },
  header:          { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16, gap: 4 },
  title:           { fontSize: 28, fontWeight: '700' },
  subtitle:        { fontSize: 14, letterSpacing: 0.25 },
  divider:         { height: 1, marginHorizontal: 24, marginBottom: 16 },
  emptyArea:       { flex: 1, paddingHorizontal: 16 },
  emptyCard:       { borderRadius: 20, borderWidth: 1, padding: 36, alignItems: 'center', gap: 10 },
  emptyTitle:      { fontSize: 18, fontWeight: '600' },
  emptyDesc:       { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  extCard:         { borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  extLeft:         { flex: 1, flexDirection: 'row', gap: 12, alignItems: 'center' },
  extIcon:         { width: 44, height: 44, borderRadius: 10 },
  extIconFallback: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  extName:         { fontSize: 15, fontWeight: '600' },
  extMeta:         { fontSize: 12, letterSpacing: 0.3, marginTop: 1 },
  extDesc:         { fontSize: 12, lineHeight: 16, marginTop: 3 },
  removeBtn:       { padding: 6 },
  importArea:      { padding: 16, paddingTop: 8 },
  importBtn:       { flexDirection: 'row', borderRadius: 28, height: 56, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.12, shadowRadius: 6 },
  importBtnText:   { fontSize: 16, fontWeight: '600', letterSpacing: 0.1 },
  badge:           { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText:       { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
});
