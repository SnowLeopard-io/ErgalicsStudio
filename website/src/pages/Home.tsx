import { Link } from 'react-router-dom';
import { useT } from '../i18n-react';
import { studioUrl } from '../studio-link';
import { GALLERY } from '../data/gallery';
import { CoverArt } from '../components/CoverArt';
import { pickLocal } from '../i18n';

export function Home() {
  const t = useT();
  const featured = GALLERY.slice(0, 4);
  const feats = [
    { k: 'f1', icon: 'M4 7h16M4 12h16M4 17h10' },
    { k: 'f2', icon: 'M3 3v18h18M8 14l3-4 3 2 4-6' },
    { k: 'f3', icon: 'M12 2l8 4.5v9L12 20l-8-4.5v-9ZM12 12l8-4.5M12 12v8M12 12L4 7.5' },
    { k: 'f4', icon: 'M13 2 3 14h7l-1 8 10-12h-7Z' },
  ];
  return (
    <div className="home">
      <section className="hero">
        <div className="hero-inner">
          <span className="hero-badge">{t('hero.badge')}</span>
          <h1 className="hero-title">{t('hero.title')}</h1>
          <p className="hero-desc">{t('hero.desc')}</p>
          <div className="hero-actions">
            <a href={studioUrl('/')} className="btn btn-primary btn-lg">{t('hero.cta')}</a>
            <Link to="/gallery" className="btn btn-ghost btn-lg">{t('hero.cta2')}</Link>
          </div>
          <div className="hero-stats">
            <div><b>15</b><span>{t('f2.t')}</span></div>
            <div><b>4</b><span>{t('f1.t')}</span></div>
            <div><b>1000+</b><span>Unit Tests</span></div>
            <div><b>0</b><span>{t('footer.license')}</span></div>
          </div>
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="console">
            <div className="console-bar"><i /><i /><i /></div>
            <div className="console-body">
              <div className="console-lines">
                <span className="cl-cl">studio</span><span className="cl-fn">.load</span>(<span className="cl-str">&quot;measurements.h5&quot;</span>)<br />
                <span className="cl-cl">studio</span><span className="cl-fn">.ttest</span>(a, b)&nbsp;&nbsp;<span className="cl-cm"># t(28)=2.31, p=.028</span><br />
                <span className="cl-cl">studio</span><span className="cl-fn">.plot</span>(<span className="cl-str">&quot;scatter&quot;</span>, x, y)<br />
                <span className="cl-cl">studio</span><span className="cl-fn">.repro</span>.<span className="cl-fn">lock</span>()&nbsp;<span className="cl-cm"># ✓ 6 dims</span>
              </div>
              <svg viewBox="0 0 200 80" className="console-plot">
                <path d="M5 60 C 40 55, 55 20, 90 30 S 150 60, 195 15" fill="none" stroke="var(--color-accent)" strokeWidth="2" />
                <path d="M5 68 C 45 62, 60 40, 95 44 S 155 66, 195 30" fill="none" stroke="var(--cat-fun)" strokeWidth="1.4" opacity="0.7" />
                <circle cx="90" cy="30" r="3" fill="var(--color-accent)" />
              </svg>
            </div>
          </div>
        </div>
      </section>

      <section className="features">
        <h2 className="section-title">{t('features.title')}</h2>
        <div className="feature-grid">
          {feats.map((f) => (
            <article key={f.k} className="feature-card">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={f.icon} /></svg>
              <h3>{t(`${f.k}.t`)}</h3>
              <p>{t(`${f.k}.d`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="featured">
        <div className="featured-head">
          <h2 className="section-title">{t('gallery.title')}</h2>
          <Link to="/gallery" className="btn btn-ghost">{t('hero.cta2')} →</Link>
        </div>
        <div className="gallery-grid">
          {featured.map((g) => (
            <Link key={g.id} to="/gallery" className="gallery-card">
              <CoverArt seed={g.seed} chartType={g.chartType} />
              <div className="card-body">
                <div className="card-tags">
                  <span className="tag">{g.subject}</span>
                  <span className="tag chart">{g.chartType}</span>
                </div>
                <h3>{pickLocal(g.title)}</h3>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
