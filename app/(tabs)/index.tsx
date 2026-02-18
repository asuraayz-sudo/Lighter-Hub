import React, { useState } from 'react';
import {
  View,
  TextInput,
  StyleSheet,
  useColorScheme,
  StatusBar,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const MD3 = {
  light: {
    primary: '#6750A4',
    surface: '#FFFBFE',
    surfaceVariant: '#E7E0EC',
    onSurface: '#1C1B1F',
    onSurfaceVariant: '#49454F',
  },
  dark: {
    primary: '#D0BCFF',
    surface: '#1C1B1F',
    surfaceVariant: '#2B2930',
    onSurface: '#E6E1E5',
    onSurfaceVariant: '#CAC4D0',
  },
};

export default function HomeScreen() {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const scheme = useColorScheme() ?? 'light';
  const colors = MD3[scheme];

  return (
    <View style={[styles.container, { backgroundColor: colors.surface }]}>
      <StatusBar
        barStyle={scheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.surface}
      />

      <View style={styles.searchWrapper}>
        <View
          style={[
            styles.searchContainer,
            {
              backgroundColor: colors.surfaceVariant,
              borderWidth: focused ? 2 : 0,
              borderColor: focused ? colors.primary : 'transparent',
            },
          ]}>
          <MaterialCommunityIcons
            name="magnify"
            size={22}
            color={focused ? colors.primary : colors.onSurfaceVariant}
          />
          <TextInput
            style={[styles.searchInput, { color: colors.onSurface }]}
            placeholder="Search..."
            placeholderTextColor={colors.onSurfaceVariant}
            value={query}
            onChangeText={setQuery}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            returnKeyType="search"
            // @ts-ignore - web only: remove native browser outline
            outlineStyle={{ outline: 'none' }}
          />
          {query.length > 0 && (
            <MaterialCommunityIcons
              name="close-circle"
              size={18}
              color={colors.onSurfaceVariant}
              onPress={() => setQuery('')}
            />
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchWrapper: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 28,
    paddingHorizontal: 16,
    height: 56,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    letterSpacing: 0.15,
  },
});
