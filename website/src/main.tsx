import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Route, Routes, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Home } from './pages/Home';
import { Gallery } from './pages/Gallery';
import { Themes } from './pages/Themes';
import { Plugins } from './pages/Plugins';
import './tokens.css';
import './site.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/gallery" element={<Gallery />} />
          <Route path="/themes" element={<Themes />} />
          <Route path="/plugins" element={<Plugins />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </HashRouter>
  </StrictMode>,
);
