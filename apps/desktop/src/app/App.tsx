import { useEffect, useMemo, useState } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { Toaster } from 'sonner';
import { TooltipProvider } from '@angkorgit/design-system';
import { SplashScreen } from './SplashScreen';
import { WelcomePage } from '@/features/repository/WelcomePage';
import { RepositoryPage } from '@/features/repository/RepositoryPage';
import { useRepo } from '@/features/repository/store';
import { useSettings } from '@/features/settings/store';
import { useShortcuts } from '@/shared/useShortcuts';

function Shell() {
  const [splash, setSplash] = useState(true);
  const loadRecents = useRepo((s) => s.loadRecents);
  const navigate = useNavigate();

  // Zoom works everywhere, even while typing in an input.
  const zoomShortcuts = useMemo(
    () => [
      { combo: 'mod+=', handler: () => useSettings.getState().zoomIn(), allowInInput: true },
      { combo: 'mod+shift+=', handler: () => useSettings.getState().zoomIn(), allowInInput: true },
      { combo: 'mod+-', handler: () => useSettings.getState().zoomOut(), allowInInput: true },
      { combo: 'mod+0', handler: () => useSettings.getState().zoomReset(), allowInInput: true },
    ],
    [],
  );
  useShortcuts(zoomShortcuts);

  useEffect(() => {
    void loadRecents();
    const timer = setTimeout(() => {
      setSplash(false);
      navigate('/welcome', { replace: true });
    }, 1600);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AnimatePresence mode="wait">
      {splash ? (
        <SplashScreen key="splash" />
      ) : (
        <Routes key="app">
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/repo" element={<RepositoryPage />} />
          <Route path="*" element={<WelcomePage />} />
        </Routes>
      )}
    </AnimatePresence>
  );
}

export function App() {
  const theme = useSettings((s) => s.theme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  return (
    <TooltipProvider>
      <MemoryRouter initialEntries={['/']}>
        <div className="h-full">
          <Shell />
        </div>
      </MemoryRouter>
      <Toaster
        position="bottom-right"
        theme={theme}
        toastOptions={{
          style: {
            background: 'hsl(var(--surface-overlay))',
            border: '1px solid hsl(var(--border))',
            color: 'hsl(var(--foreground))',
          },
        }}
      />
    </TooltipProvider>
  );
}
