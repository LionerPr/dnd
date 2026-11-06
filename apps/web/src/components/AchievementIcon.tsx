import { Award, Crown, Flame, Gem, Ghost, Heart, Shield, Skull, Sparkles, Star, Swords, Trophy, Wine, Zap, Feather, Footprints } from 'lucide-react';

export const ACHIEVEMENT_ICONS = {
  star: Star, trophy: Trophy, crown: Crown, swords: Swords, skull: Skull, shield: Shield, flame: Flame,
  heart: Heart, gem: Gem, ghost: Ghost, wine: Wine, zap: Zap, sparkles: Sparkles, award: Award, feather: Feather, footprints: Footprints,
} as const;

export function AchievementIcon({ name, size = 20 }: { name: string; size?: number }) {
  const Icon = ACHIEVEMENT_ICONS[name as keyof typeof ACHIEVEMENT_ICONS] ?? Star;
  return <Icon size={size} strokeWidth={1.6} />;
}
