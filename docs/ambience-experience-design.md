# Ergalics Studio Ambience Experience System Design

> Goal: Without compromising the seriousness of scientific work, use sound, motion, feedback, and light incentives to give users an emotional connection in which they feel “responded to, remembered, and respected” during long work sessions. The overall tone continues the project's existing **academically calm, low-saturation, restrained and refined** style.

---

## I. General design principles {#一、设计总原则}

| Principle | Description |
| --- | --- |
| Restraint first | All motion and sound are lightweight by default; less is better. A single action can disable them globally at any time. |
| Do not interrupt flow | Incentives (experience points, badges) never cover the canvas or block operations. |
| Theme consistency | All visual elements reuse the theme system's CSS variables and automatically adapt to light and dark themes. |
| Broad visual appeal | Rounded, soft, and low-saturation; no glaring highly saturated colors or emoji graphics. |
| Accessibility fallback | Respect the system's `prefers-reduced-motion` and `prefers-reduced-transparency`. |
| Local privacy | All progress data is stored in localStorage, without uploads or an account. |

---

## II. Sound system {#二、音效系统}

### 2.1 Implementation {#_2-1-实现方式}

Use **procedural synthesis with the Web Audio API** (OscillatorNode + GainNode envelope), without audio files:

- Zero asset size and available as soon as loaded.
- Timbres can be tuned consistently through parameters, producing a naturally consistent style.
- Lazily initialize AudioContext on first interaction (required by browser autoplay policy).

### 2.2 Sound inventory {#_2-2-音效清单}

| Event | Sound design | Volume |
| --- | --- | --- |
| Click/confirm | Extremely short sine “tick” (~40ms, 1200Hz decay) | Low |
| Switch/toggle | Two-tone “pop” (600→900Hz glide, 80ms) | Low |
| Notification toast appears | Soft ascending two-note phrase (C6→E6) | Medium-low |
| Computation complete | Soft three-note chord (a sense of success without exaggeration) | Medium |
| Computation fails | Single short descending low-frequency tone (not harsh or alarming) | Medium-low |
| Earn XP | Delicate short “shimmer” arpeggio | Medium-low |
| Earn badge | Four-note ascending arpeggio + light reverb (a one-time highlight) | Medium |
| Open project/plugin | Gentle “unboxing” glide | Low |
| Save succeeds | Very soft “beep” (optional; play only when saving takes >1s) | Low |

### 2.3 Ambient music (optional module) {#_2-3-环境音乐-可选模块}

- Provide a **“focus ambience”** switch: a procedurally generated minimalist ambient pad (low-frequency sine waves with slow LFO modulation), or very quiet synthesized white noise/rain.
- Seamless loop, very low volume (about 15–20%), optionally linked to the theme: warmer, deeper timbre in dark mode and clearer timbre in light mode.
- **Off by default**, with an entry in settings labeled “focus ambience.”

### 2.4 Master sound controls {#_2-4-音效总控}

- Settings provide: `Sound effects: on/off`, `Focus ambience: on/off`, and a `Master volume slider`.
- Before any sound is first played, show a one-time small top-bar notice, “Interface sounds enabled; adjust them in settings” (a toast that disappears after 5 seconds).
- Persist state to `localStorage('ergalics:ambience')`.

---

## III. Animation and micro-interactions {#三、动画与微交互}

### 3.1 Global transitions {#_3-1-全局过渡}

- Theme switching: add a soft radial transition expanding from the switch button to the existing transition (View Transitions API, falling back to a fade).
- Page/view switching: 120–180ms fade-in + 4px upward movement, consistently using `cubic-bezier(0.25, 0.8, 0.25, 1)` easing.
- Dialogs/drawers: scale 0.98→1 + fade-in, no longer than 200ms.

### 3.2 Component-level micro-motion {#_3-2-组件级微动效}

| Component | Motion |
| --- | --- |
| Button hover | 150ms background transition + slight upward movement (translateY -1px) |
| Card hover | Slightly brighter border + deeper shadow, no movement (scientific content stays still) |
| Switch/checkbox | Spring slide (180ms) |
| Toast | Slide in from the right + breathing progress bar; fade out and move upward on exit |
| Progress/loading | Add a soft breathing glow (low-saturation theme color) to the existing loader |
| Canvas node drag | Slight settling rebound on release (scale 1.01→1) |
| Long computation | Soft pulsing top-bar status dot (solid-color breathing, no rainbow spinner) |

### 3.3 Ambient motion (ambience layer) {#_3-3-环境动效-氛围层}

- Welcome page: very slowly drifting, low-saturation gradient light spots (2–3 radial-gradients, 60s cycle), reflecting the preference for an expansive atmosphere.
- On earning a badge/leveling up: one-time fullscreen effect of small rising particles (theme color, 1.5s, used only for this event, not routinely).
- Automatically disable all ambient motion under `prefers-reduced-motion`.

### 3.4 Unified motion specification {#_3-4-动画规范统一}

- Extract `src/styles/motion.css`: define `--motion-fast: 120ms / --motion-base: 180ms / --motion-slow: 320ms` and unified easing-curve variables.
- Gradually bring existing scattered transitions into this specification (incremental adoption is acceptable; no need to change everything at once).

---

## IV. Experience point system (XP) {#四、经验值系统-xp}

### 4.1 Design concept {#_4-1-设计理念}

Reward “research behavior” rather than “game behavior” — encourage exploration, completing computations, and continued use rather than farming points.

### 4.2 XP earning rules {#_4-2-经验值获取规则}

| Action | XP |
| --- | --- |
| First open each day | +10 |
| Complete a simulation/computation | +15 |
| Complete a validation/coupling analysis | +20 |
| Import one's own data file | +10 |
| Complete onboarding | +30 (one-time) |
| Try a plugin not used before | +25 (once per plugin) |
| Consecutive days of use (streak) | +5 per day, capped at 30 consecutive days |

Anti-farming: actions of the same type count at most once per minute; XP only increases (failed computations also receive 5 points for trying, avoiding a sense of punishment).

### 4.3 Level system {#_4-3-等级体系}

- Use academic metaphors for level names to fit the project's character:

| Level range | Name | Cumulative XP |
| --- | --- | --- |
| Lv.1–3 | Trainee Researcher | 0–150 |
| Lv.4–6 | Assistant Researcher | 150–500 |
| Lv.7–9 | Researcher | 500–1200 |
| Lv.10–12 | Senior Researcher | 1200–2500 |
| Lv.13+ | Principal Researcher | 2500+ |

- XP required to level up follows a gently increasing curve (around `level × 80`), ensuring the first few levels can be reached within 10 minutes to establish positive feedback.

### 4.4 XP presentation in the UI {#_4-4-xp-的-ui-呈现}

- **Beside the project name on the left of the top bar or in the upper-right corner**: a slim XP bar + level badge (matching top-bar height, restrained and unobtrusive); hover opens a popover showing “XX XP until the next level” and recent awards.
- No popup when earning XP: small `+15` text floats from the end of the XP bar and fades out (1.5s).
- On leveling up: a one-time centered level-up card (theme-colored outline, badge image, new level name), dismissed by clicking anywhere, with an arpeggio sound; automatically fades after 10 seconds without interaction.
- On reaching a new level tier, the top-bar level badge changes style (small outline-color/texture adjustments only).

---

## V. Badge system {#五、徽章系统}

### 5.1 Badge inventory (12 at launch) {#_5-1-徽章清单-首发-12-枚}

| Badge | Name | Condition | Rarity |
| --- | --- | --- | --- |
| 1 | First Ignition | Open Ergalics Studio for the first time | Common |
| 2 | Pathfinder | Complete onboarding | Common |
| 3 | Data Hand | Import the first data file | Common |
| 4 | First Run | Complete the first simulation computation | Common |
| 5 | Five-Day Streak | Use the application for 5 consecutive days | Rare |
| 6 | Tempered | Complete 20 computations in total | Rare |
| 7 | Panoramic View | Use every plugin at least once | Epic |
| 8 | Proof of Rigor | Complete a validation benchmark analysis | Rare |
| 9 | Key to Coupling | Complete a coupling analysis | Rare |
| 10 | Thirty-Day Milestone | Use the application for 30 consecutive days | Epic |
| 11 | Late-Night Light | Complete a computation between 0:00 and 5:00 | Easter egg |
| 12 | Points Expert | Earn 2500 XP in total | Epic |

Future extensions: plugin-specific badges (achievement points instrumented within each plugin) and holiday Easter-egg badges.

### 5.2 Badge visuals {#_5-2-徽章视觉}

- **AI-generated badge images**: generate with a unified prompt template to keep the style consistent.
  - Style keywords: `flat vector badge, minimalist scientific emblem, low saturation deep blue and teal palette, subtle metallic line art, dark background compatible, circular badge, no text`
  - 512×512 PNG; uniformly apply a circular outline and inner shadow after generation.
  - Each badge has “normal/unlocked and lit” states: use CSS `grayscale + opacity 0.35` for the unearned state; two separate image sets are unnecessary.
- Store in `src/assets/badges/` and bundle with the frontend (12 total, manageable size).

### 5.3 Badge UI {#_5-3-徽章-ui}

- **When earned**: a badge card (image + name + one-sentence description) slides in at the upper right and automatically retracts after 4 seconds; click for details. Multiple badges earned at once are queued and shown in order.
- **Badge wall**: an “Achievements” tab embedded in settings shows all badges in a grid (lit/unlit); click for conditions and earning time. Show collection progress at the top (e.g. 7/12).
- When the badge-wall entry is first unlocked, show a small red dot on the top-bar achievements icon.

---

## VI. Adapting to the theme system {#六、与主题系统的适配}

### 6.1 Colors: all use CSS variables {#_6-1-颜色-全部走-css-变量}

Define new variables in `src/theme` (each of the three themes supplies its own values):

```css
:root[data-theme='dark'] {
  --xp-bar-fill: var(--accent);        /* 经验条填充：复用主题强调色 */
  --xp-bar-track: rgba(255,255,255,.08);
  --badge-glow: rgba(120, 180, 255, .25);
  --celebrate-particle: var(--accent-soft);
  --ambient-glow-1 / --ambient-glow-2; /* 欢迎页光斑色 */
}
```

- The same motion/badges automatically take on the appropriate appearance in dark and light themes: dark = faint luminous outlines and soft glows; light = light shadows and paler fills.
- Badge images are designed for dark backgrounds; add a thin white outer ring in the light theme so they do not blend into the background.

### 6.2 Sound and theme coordination (optional detail) {#_6-2-音效与主题联动-可选细节}

- Adjust focus-ambience timbre slightly with the theme (dark: stronger low-pass filtering, warmer; light: brighter and clearer); implementation cost is low and this is an enhancement.

### 6.3 System theme {#_6-3-system-主题}

- In `system` mode, follow the system in real time; all ambience elements respond automatically through CSS variables, with no additional JS handling.

---

## VII. Settings panel integration {#七、设置面板整合}

Add an “Experience and ambience” section to the existing settings page:

| Setting | Type | Default |
| --- | --- | --- |
| Interface sounds | Switch | On |
| Focus ambience sound | Switch | Off |
| Master volume | Slider | 70% |
| Interface motion | Full/reduced/off | Full |
| XP and achievements | Switch (when off, hide the XP bar and badge notices while continuing to record in the background) | On |
| Achievement wall | Entry | — |

- “Reduced” motion mode retains necessary transitions and removes ambient motion and particles.
- Persist all settings to `localStorage('ergalics:ambience')`.

---

## VIII. Accessibility and boundaries {#八、无障碍与边界}

- `prefers-reduced-motion: reduce` → automatically switch to “reduced” motion and disable particles.
- Avoid the main peaks in the ear-sensitive 2–5kHz range for sound frequencies (keep short sounds below 1kHz or above 4kHz with fast decay).
- Incentive overlays do not steal focus (`aria-live="polite"`, no alert).
- The canvas area (plugin workspace) is a **motion-free zone**: except for the node-settling rebound, add no ambience elements inside the canvas, preserving focus on research.
- Laboratory charts strictly retain existing conventions: no emoji or decorative animation.

---

## IX. Implementation plan {#九、实施计划}

| Phase | Content | Modules involved |
| --- | --- | --- |
| P1 Infrastructure | `ambienceStore` (zustand + localStorage), motion.css specification, settings section | stores / styles / settings page |
| P2 Sound | Web Audio synthesis engine, connect the sound inventory to interaction points, master controls | Global interaction points |
| P3 Motion | Unify micro-interactions, theme-switch transition, welcome-page light spots | Component layer / theme |
| P4 Incentives | XP instrumentation, XP bar UI, level-up flow | appStore instrumentation / top bar |
| P5 Badges | AI-generate 12 badge images, earning flow, achievement wall | assets / settings page |
| P6 Polish | reduced-motion, system-theme verification, volume balancing | Global |

### Instrumentation points (P4 dependency) {#埋点位置-p4-依赖}

- `appStore.notify()` / computation-completion callback → computation XP.
- File-import handler → import XP.
- `tourStore` completion callback → onboarding XP.
- Plugin-open handler → first-plugin-use XP.
- Consolidate everything into a single `awardXP(reason)` entry point to avoid scattering logic.

---

## X. Risks and mitigations {#十、风险与对策}

| Risk | Mitigation |
| --- | --- |
| Sound disturbs users | Low default volume, one-action master off, notice on first enablement |
| Incentives feel childish or conflict with the scientific positioning | Academic naming and visuals, reward exploration rather than points, place the achievement wall in settings instead of the main interface |
| Badge images are stylistically inconsistent | Unified prompt template + consistent post-processing (outline/inner shadow) |
| Progress is lost when localStorage is cleared | Provide JSON “export/import progress” buttons in settings (low priority, P6) |
| Motion causes performance problems | Ambient motion uses only CSS transform/opacity; particles use canvas and run only when triggered |
