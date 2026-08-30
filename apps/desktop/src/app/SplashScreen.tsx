import { motion } from 'framer-motion';
import { Logo, TemplePattern } from '@angkorgit/design-system';
import { useSettings } from '@/features/settings/store';

export function SplashScreen() {
  const reduceMotion = useSettings((s) => s.reduceMotion);
  return (
    <motion.div
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.4, ease: 'easeInOut' } }}
    >
      <TemplePattern className="[mask-image:radial-gradient(ellipse_at_center,transparent_35%,black_80%)]" />
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="text-foreground"
      >
        <Logo size={96} animated />
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7, duration: 0.5 }}
        className="text-center"
      >
        <h1 className="text-2xl font-semibold tracking-tight">
          AngKor<span className="text-primary">Git</span>
        </h1>
        <p className="mt-1 text-xs text-muted">Strength. Simplicity. Craftsmanship.</p>
      </motion.div>
    </motion.div>
  );
}
