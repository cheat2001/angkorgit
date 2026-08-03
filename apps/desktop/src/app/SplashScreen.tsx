import { motion } from 'framer-motion';
import { Logo } from '@angkorgit/design-system';

/**
 * Splash: the AngKorGit mark draws itself from git branch strokes,
 * then the whole screen fades into the app.
 */
export function SplashScreen() {
  return (
    <motion.div
      className="flex h-full flex-col items-center justify-center gap-6 bg-background"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.4, ease: 'easeInOut' } }}
    >
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
