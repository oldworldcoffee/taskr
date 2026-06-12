import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useMyTodos } from '../hooks/useMyTodos';
import { colors } from '../lib/theme';

export default function MyTodosScreen() {
  const { overdue, todayItems, upcoming, doneToday, todoById, toggle, loading, reload } =
    useMyTodos();

  const totalOpen = overdue.length + todayItems.length;
  const hasAny = totalOpen + upcoming.length + doneToday.length > 0;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Tasks</Text>
        {totalOpen > 0 && <Text style={styles.headerCount}>{totalOpen} due</Text>}
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={false} onRefresh={reload} />}
      >
        {loading && !hasAny && (
          <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
        )}

        {!loading && !hasAny && (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={40} color={colors.muted} />
            <Text style={styles.emptyText}>You're all caught up. No to-dos right now.</Text>
          </View>
        )}

        {overdue.length > 0 && (
          <Section
            label="Overdue"
            icon="alert-circle"
            tone={colors.destructive}
            items={overdue}
            todoById={todoById}
            onToggle={toggle}
          />
        )}
        {todayItems.length > 0 && (
          <Section
            label="Today"
            icon="time"
            tone={colors.primary}
            items={todayItems}
            todoById={todoById}
            onToggle={toggle}
          />
        )}
        {upcoming.length > 0 && (
          <Section
            label="Upcoming"
            icon="ellipse-outline"
            tone={colors.muted}
            items={upcoming}
            todoById={todoById}
            onToggle={toggle}
          />
        )}
        {doneToday.length > 0 && (
          <Section
            label="Completed today"
            icon="checkmark-circle"
            tone={colors.success}
            items={doneToday}
            todoById={todoById}
            onToggle={toggle}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ label, icon, tone, items, todoById, onToggle }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={14} color={tone} />
        <Text style={[styles.sectionLabel, { color: tone }]}>{label.toUpperCase()}</Text>
      </View>
      {items.map((occ) => {
        const todo = todoById[occ.todo_id];
        const done = occ.status === 'completed';
        return (
          <TouchableOpacity
            key={occ.id}
            style={styles.row}
            onPress={() => onToggle(occ)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={done ? 'checkmark-circle' : 'ellipse-outline'}
              size={24}
              color={done ? colors.success : colors.muted}
            />
            <View style={styles.rowBody}>
              <Text style={[styles.rowTitle, done && styles.rowTitleDone]}>
                {todo?.name || 'To-Do'}
              </Text>
              {!!todo?.description && (
                <Text style={styles.rowDesc} numberOfLines={1}>
                  {todo.description}
                </Text>
              )}
              <Text style={styles.rowMeta}>
                Due {occ.due_date}
                {occ.due_time ? ` · ${occ.due_time}` : ''}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: colors.foreground },
  headerCount: { fontSize: 14, color: colors.muted },
  scroll: { paddingHorizontal: 20, paddingBottom: 40 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 30 },
  emptyText: { color: colors.muted, marginTop: 10, textAlign: 'center' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 8, gap: 6 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 14,
    backgroundColor: colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 8,
  },
  rowBody: { flex: 1 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: colors.foreground },
  rowTitleDone: { textDecorationLine: 'line-through', color: colors.muted },
  rowDesc: { fontSize: 12, color: colors.muted, marginTop: 2 },
  rowMeta: { fontSize: 11, color: colors.muted, marginTop: 3 },
});
