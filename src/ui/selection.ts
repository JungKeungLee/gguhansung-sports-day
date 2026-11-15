// 참가 캐릭터 선택 로직 (순수 함수)
import type { CharId } from '../game/types';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;

export function toggleSelect(selected: CharId[], id: CharId): CharId[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  if (selected.length >= MAX_PLAYERS) return selected;
  return [...selected, id];
}

export const canStart = (selected: CharId[]) =>
  selected.length >= MIN_PLAYERS && selected.length <= MAX_PLAYERS && new Set(selected).size === selected.length;
